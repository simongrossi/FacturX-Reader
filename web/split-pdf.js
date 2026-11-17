"use strict";

// Les changements de référence sont des suggestions ; la validation reste explicite.
function splitInvoiceReference(text) {
  return text.match(/(?:facture|invoice|avoir)\s*(?:n[°ºo.]?|number|no\.?|#|:)\s*[:.]?\s*([a-z0-9][a-z0-9/_-]*)/i)?.[1]?.toUpperCase() || null;
}
function currentSplitPdf() {
  const f = getFile(state.selected);
  const r = f?.result;
  return r && ((state.pdfSource === "xmlpdf" ? r.xml_pdf : r.pdf) || r.pdf || r.xml_pdf);
}
function openSplitPdf() {
  const pdf = currentSplitPdf();
  if (pdf) {
    const file = new File([Uint8Array.from(atob(pdf.base64), c => c.charCodeAt(0))], pdf.filename || "document.pdf", { type: "application/pdf" });
    reviewSplitPdf(file).catch(e => alert("Découpage impossible : " + (e.message || e)));
    return;
  }
  const input = document.createElement("input");
  input.type = "file"; input.accept = ".pdf,application/pdf";
  input.addEventListener("change", () => { if (input.files[0]) reviewSplitPdf(input.files[0]).catch(e => alert("Découpage impossible : " + (e.message || e))); });
  input.click();
}
async function reviewSplitPdf(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const info = await invoke("inspect_split_pdf", bytes);
  const dialog = document.createElement("dialog");
  dialog.style.cssText = "width:min(850px,90vw);max-height:85vh;overflow:auto;padding:24px";
  const title = document.createElement("h2"); title.textContent = "Découpage des factures"; dialog.append(title);
  const notice = document.createElement("p");
  notice.textContent = `${file.name} · ${info.pages} pages · ${info.xml.length} XML de facture intégrés. Vérifiez les séparations et associez chaque XML à sa facture. Les PDF dérivés ne conservent ni la conformité Factur-X/PDF-A ni les signatures. Les XML restent inchangés dans des fichiers séparés. Sans XML associé, le PDF sera uniquement exporté (aucune extraction comptable ni OCR).`;
  dialog.append(notice);
  for (const x of info.xml) {
    const details = document.createElement("details");
    const summary = document.createElement("summary"); summary.textContent = `${x.name} · ${x.invoice?.numero || "Référence non identifiée"} — consulter le XML`;
    const pre = document.createElement("pre"); pre.textContent = x.source; pre.style.cssText = "max-height:200px;overflow:auto;white-space:pre-wrap";
    details.append(summary, pre); dialog.append(details);
  }
  const progress = document.createElement("p"); progress.textContent = "Recherche des références de facture…"; dialog.append(progress);
  const cancel = document.createElement("button"); cancel.textContent = "Fermer"; cancel.onclick = () => dialog.close(); dialog.append(cancel);
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  document.body.append(dialog); dialog.showModal();
  let pdf;
  const task = loadPdfTask(bytes.slice());
  const starts = [1], excerpts = [];
  try {
    pdf = await task.promise;
    let previous = null;
    for (let p = 1; p <= info.pages; p++) {
      if (!dialog.open) return;
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      const text = content.items.map(x => x.str || "").join(" ");
      excerpts.push(text.slice(0, 350));
      const ref = splitInvoiceReference(text);
      if (ref && previous && ref !== previous) starts.push(p);
      if (ref) previous = ref;
      progress.textContent = `Analyse de la page ${p}/${info.pages}…`;
    }
  } finally {
    // Le nettoyage PDF.js peut attendre d’autres tâches : il ne doit pas bloquer la revue.
    await task.destroy().catch(() => {});
  }
  if (!dialog.open) return;
  progress.textContent = "Suggestions fondées sur les changements de numéro de facture. Vérifiez aussi les pages sans texte et les annexes.";
  const label = document.createElement("label"); label.textContent = "Pages de début des factures (séparées par des virgules) : ";
  const boundaries = document.createElement("input"); boundaries.value = starts.join(", "); label.append(boundaries); dialog.insertBefore(label, cancel);
  const rows = document.createElement("div"); dialog.insertBefore(rows, cancel);
  const error = document.createElement("p"); error.setAttribute("role", "alert"); dialog.insertBefore(error, cancel);
  let groups = [];
  function render() {
    rows.replaceChildren(); error.textContent = "";
    const tokens = boundaries.value.split(",").map(x => x.trim());
    const pages = tokens.map(Number);
    if (tokens.some(t => !/^\d+$/.test(t)) || pages[0] !== 1 || pages.some((p,i) => p > info.pages || p < 1 || (i && p <= pages[i-1]))) {
      groups = []; error.textContent = "Indiquez des pages croissantes, en commençant par 1."; return;
    }
    groups = pages.map((start,i) => ({ start, end: (pages[i+1] || info.pages+1)-1, xml:null }));
    groups.forEach((g,i) => {
      const section = document.createElement("section");
      const heading = document.createElement("h3"); heading.textContent = `Facture ${i+1} · pages ${g.start}–${g.end}`;
      const excerpt = document.createElement("p"); excerpt.textContent = excerpts[g.start-1] || "Page sans texte : vérification du PDF source nécessaire.";
      const label = document.createElement("label"); label.textContent = "XML associé : ";
      const select = document.createElement("select"); select.append(new Option("Aucun — PDF uniquement", ""));
      info.xml.forEach(x => select.append(new Option(`${x.name} — ${x.invoice?.numero || x.invoice?.format || "XML de facture"}`, String(x.index))));
      select.onchange = () => { g.xml = select.value === "" ? null : Number(select.value); };
      label.append(select); section.append(heading, excerpt, label); rows.append(section);
    });
  }
  boundaries.addEventListener("change", render); render();
  const submit = document.createElement("button"); submit.textContent = "Séparer et exporter…"; dialog.insertBefore(submit, cancel);
  submit.onclick = async () => {
    error.textContent = "";
    if (!groups.length) return;
    const assigned = groups.filter(g => g.xml !== null).map(g => g.xml);
    if (new Set(assigned).size !== assigned.length) { error.textContent = "Un même XML ne peut pas être attribué à plusieurs factures."; return; }
    if (assigned.length > 500-state.files.length) { error.textContent = "La session ne dispose pas d’assez de places pour importer ces factures."; return; }
    submit.disabled = boundaries.disabled = cancel.disabled = true;
    rows.querySelectorAll("select").forEach(s => { s.disabled = true; });
    try {
      const result = await invoke("split_pdf", bytes, { headers: { "x-split-groups": JSON.stringify(groups) } });
      if (!await api.saveBinary(file.name.replace(/\.pdf$/i, "") + "-factures.zip", result.bundle)) return;
      const files = result.imports.map(x => new File([Uint8Array.from(atob(x.base64), c => c.charCodeAt(0))], x.name, { type:"application/zip" }));
      if (files.length) await addFiles(files);
      dialog.close();
    } catch (e) { error.textContent = String(e.message || e); }
    finally { submit.disabled = boundaries.disabled = cancel.disabled = false; rows.querySelectorAll("select").forEach(s => { s.disabled = false; }); }
  };
}

document.addEventListener("DOMContentLoaded", () => {
  byId("btn-split-pdf").addEventListener("click", openSplitPdf);
});
