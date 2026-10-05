"use strict";

/* Impression groupée — factures cochées dans la liste des fichiers, choix du
   PDF à imprimer (XML / document), puis un seul job d'impression système pour
   toutes les factures sélectionnées. */

const PRINT_ICON_SVG =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" '
  + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
  + '<path d="M6 9V3h12v6"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>'
  + '<rect x="6" y="14" width="12" height="8" rx="1"/></svg>';

const BP_MAX_PAGES = 400; // plafond de confort mémoire pour un seul job
const BP_SCALE = 2;       // échelle de rendu (A4 ≈ 1587 × 2245 px)

let batchPrintBusy = false;

function plural(n, singulier, pluriel) { return n > 1 ? pluriel : singulier; }

function togglePrintSelection(id) {
  if (state.printSelection.has(id)) state.printSelection.delete(id);
  else state.printSelection.add(id);
  renderList(true);
  const dialog = byId("batch-print-dialog");
  if (dialog && dialog.open) refreshBatchPrintDialog();
}

function batchPrintMode() {
  const dialog = byId("batch-print-dialog");
  const el = dialog.querySelector('input[name="bp-mode"]:checked');
  return el ? el.value : "mixed";
}

/* Factures sélectionnées → PDFs à imprimer selon le mode :
   mixed : PDF du XML, sinon PDF du document ; xml : XML seul ; doc : document seul. */
function batchPrintJobs(mode) {
  const jobs = [];
  let skipped = 0;
  for (const f of state.files) {
    if (!state.printSelection.has(f.id)) continue;
    const r = f.result;
    let obj = null;
    if (mode === "xml") obj = (r && r.xml_pdf) || null;
    else if (mode === "doc") obj = (r && r.pdf) || null;
    else obj = (r && (r.xml_pdf || r.pdf)) || null;
    if (obj && obj.base64) jobs.push({ name: f.name, base64: obj.base64 });
    else skipped++;
  }
  return { jobs, skipped };
}

function refreshBatchPrintDialog() {
  const mode = batchPrintMode();
  const { jobs, skipped } = batchPrintJobs(mode);
  const selected = state.printSelection.size;
  const parts = [
    selected + " " + plural(selected, "facture sélectionnée", "factures sélectionnées"),
    jobs.length + " " + plural(jobs.length, "PDF imprimable", "PDF imprimables"),
  ];
  if (skipped) parts.push(skipped + " " + plural(skipped, "ignorée (PDF absent)", "ignorées (PDF absent)"));
  byId("batch-print-info").textContent = parts.join(" — ");
  const go = byId("batch-print-go");
  go.disabled = jobs.length === 0;
  go.textContent = "IMPRIMER " + jobs.length + " " + plural(jobs.length, "Fichier", "Fichiers") + " PDF ?";
}

function openBatchPrintDialog() {
  if (batchPrintBusy || document.body.classList.contains("batch-printing") || !state.printSelection.size) return;
  const dialog = byId("batch-print-dialog");
  const saved = dialog.querySelector('input[name="bp-mode"][value="' + (settings.printMode || "mixed") + '"]');
  if (saved) saved.checked = true;
  refreshBatchPrintDialog();
  if (!dialog.open) dialog.showModal();
}

function destroyQuietly(doc) {
  try { Promise.resolve(doc.destroy()).catch(() => {}); } catch (e) { /* déjà détruit */ }
}

async function launchBatchPrint() {
  if (batchPrintBusy || document.body.classList.contains("batch-printing")) return;
  batchPrintBusy = true;
  byId("batch-print-go").disabled = true;
  try { await prepareBatchPrint(); } finally {
    batchPrintBusy = false;
    refreshBatchPrintDialog();
  }
}

async function prepareBatchPrint() {
  const mode = batchPrintMode();
  const { jobs } = batchPrintJobs(mode);
  if (!jobs.length) return;
  const sheet = byId("batch-print-sheet");
  sheet.innerHTML = "";
  // 1) Chargement de tous les PDF et comptage des pages (plafond mémoire).
  const loaded = [];
  let total = 0;
  try {
    for (const job of jobs) {
      const doc = await pdfjsLib.getDocument({ data: b64toBytes(job.base64) }).promise;
      loaded.push({ job, doc });
      total += doc.numPages;
    }
  } catch (e) {
    loaded.forEach((l) => destroyQuietly(l.doc));
    alert("Impression impossible : " + ((e && e.message) || e));
    return;
  }
  if (total > BP_MAX_PAGES) {
    const ok = confirm("Ce lot compte " + total + " pages au total (plafond conseillé : " + BP_MAX_PAGES + "). Continuer ?");
    if (!ok) {
      loaded.forEach((l) => destroyQuietly(l.doc));
      return;
    }
  }
  // 2) Rendu de chaque page ; conversion en PNG pour alléger la mémoire du DOM.
  let rendered = 0;
  try {
    for (const { job, doc } of loaded) {
      const group = document.createElement("div");
      group.className = "bp-doc";
      group.title = job.name;
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const viewport = page.getViewport({ scale: BP_SCALE });
        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
        const img = document.createElement("img");
        img.alt = job.name + " — page " + i;
        img.src = canvas.toDataURL("image/png");
        await img.decode();
        canvas.width = 0;
        canvas.height = 0;
        const wrap = document.createElement("div");
        wrap.className = "bp-page";
        wrap.appendChild(img);
        group.appendChild(wrap);
        rendered++;
      }
      destroyQuietly(doc);
      sheet.appendChild(group);
    }
  } catch (e) {
    loaded.forEach((l) => destroyQuietly(l.doc));
    sheet.innerHTML = "";
    alert("Impression impossible : " + ((e && e.message) || e));
    return;
  }
  if (!rendered) {
    sheet.innerHTML = "";
    return;
  }
  // 3) Impression système (un seul job), puis nettoyage. La sélection est conservée.
  const dialog = byId("batch-print-dialog");
  if (dialog.open) dialog.close();
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    document.body.classList.remove("batch-printing");
    sheet.innerHTML = "";
    window.removeEventListener("afterprint", cleanup);
    document.removeEventListener("pointerdown", cleanup, true);
  };
  document.body.classList.add("batch-printing");
  window.addEventListener("afterprint", cleanup);
  // Filet de sécurité si la fenêtre ne signale pas la fin de l'impression.
  document.addEventListener("pointerdown", cleanup, true);
  api.print().catch(() => window.print());
}

function wireBatchPrint() {
  let sheet = byId("batch-print-sheet");
  if (!sheet) {
    sheet = document.createElement("div");
    sheet.id = "batch-print-sheet";
    document.body.appendChild(sheet);
  }
  const dialog = byId("batch-print-dialog");
  byId("batch-print-close").addEventListener("click", () => dialog.close());
  byId("batch-print-cancel").addEventListener("click", () => dialog.close());
  // clic sur le fond assombri = fermer
  dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });
  dialog.querySelectorAll('input[name="bp-mode"]').forEach((r) => {
    r.addEventListener("change", () => {
      setSetting("printMode", r.value);
      refreshBatchPrintDialog();
    });
  });
  byId("batch-print-go").addEventListener("click", () => {
    launchBatchPrint().catch((e) => alert("Impression impossible : " + ((e && e.message) || e)));
  });
}
