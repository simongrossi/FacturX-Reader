"use strict";

// Comparaison conservatrice de champs libellés dans le texte, sans OCR.
const PDF_MONEY = /^(?:([A-Z]{3}|€|£)[ ]*)?([+-]?\d+(?:[ ,.']\d+)*)(?:[ ]*([A-Z]{3}|€|£))?$/u;
const PDF_CURRENCY = { "€": "EUR", "£": "GBP" };

function pdfAmount(raw) {
  if (/[ ']/.test(raw) && !/^[+-]?\d{1,3}(?:[ ']\d{3})+(?:[.,]\d{1,2})?$/.test(raw)) return null;
  const compact = raw.replace(/[ ']/g, "");
  const decimal = /^([+-]?\d+)(?:[.,](\d{1,2}))?$/.exec(compact);
  if (decimal) return decimalCents(decimal[1] + (decimal[2] ? "." + decimal[2] : ""));
  const grouped = /^([+-]?\d{1,3})([.,])(\d{3}(?:\2\d{3})*)(?:([.,])(\d{1,2}))?$/.exec(compact);
  if (grouped && grouped[2] !== grouped[4]) {
    return decimalCents(grouped[1] + grouped[3].replace(/[.,]/g, "") + (grouped[5] ? "." + grouped[5] : ""));
  }
  return null;
}

function pdfXmlChecks(result, pages, source) {
  const s = result.synthese;
  const header = title => result.header?.find(row => row.title === title);
  const seller = result.sections?.find(section => section.name === "Vendeur")?.rows || [];
  const legal = seller.find(row => /^(SIREN \/ registre|Identifiant légal)$/.test(row.title));
  const vat = seller.find(row => row.title === "N° de TVA");
  const checks = [];
  const candidates = { numero: [], identifiant: [], devise: [], ttc: [], a_payer: [] };
  const add = (key, page, raw, value, extra = {}) => candidates[key].push({ page, raw, value, ...extra });
  const code = raw => raw?.toUpperCase().replace(/[\s.-]/g, "") || "";
  for (const [index, page] of pages.entries()) {
    for (const line of page.split("\n")) {
      const number = /^(?:facture\s+n[°ºo.]\s*|n(?:[°ºo.]|uméro)\s*(?:de\s+)?facture\s*|invoice\s+(?:no\.?|number)\s*)[:#]?\s*([\p{L}\d][\p{L}\d._/-]*)/iu.exec(line);
      if (number && /\d/.test(number[1])) add("numero", index + 1, number[1], number[1].toUpperCase());
      // Un identifiant générique peut appartenir à l’acheteur. Exiger un libellé vendeur explicite.
      const id = /^(?:(?:vendeur|fournisseur)\s+)?(siret|siren|(?:n[°ºo.]\s*)?tva(?:\s+intracommunautaire)?)\s+(?:du\s+)?(?:vendeur|fournisseur)\s*[:#]?\s*([A-Z]{0,2}[\d .-]+)/iu.exec(line)
        || /^(?:vendeur|fournisseur)\s+(siret|siren|tva)\s*[:#]?\s*([A-Z]{0,2}[\d .-]+)/iu.exec(line);
      if (id) {
        const value = code(id[2]);
        const kind = id[1].toLowerCase();
        const xml = kind.includes("tva") ? vat : legal;
        const expected = code(xml?.value);
        const length = kind === "siret" ? 14 : 9;
        if (expected && (xml === vat ? /^[A-Z]{2}\d/.test(value) : value.length === length && expected.length === length)) {
          add("identifiant", index + 1, id[2].trim(), value, { expected, xml, kind: xml === vat ? "TVA" : kind });
        }
      }
      const currency = /^(?:devise(?:\s+de\s+(?:la\s+)?facture)?|invoice currency)\s*[:=]?\s*([A-Z]{3}|€|£)(?!\p{L})/iu.exec(line);
      if (currency) add("devise", index + 1, currency[1], PDF_CURRENCY[currency[1]] || currency[1].toUpperCase());
      const amount = /^(total\s+ttc|montant\s+ttc|net\s+[àa]\s+payer|(?:montant\s+)?[àa]\s+payer)\s*[:=]?\s*(.*)$/iu.exec(line);
      if (!amount) continue;
      const match = PDF_MONEY.exec(amount[2]);
      if (!match) continue;
      const value = pdfAmount(match[2]);
      if (value == null) continue;
      const currencies = [match[1], match[3]].filter(Boolean);
      for (const raw of currencies) add("devise", index + 1, raw, PDF_CURRENCY[raw] || raw);
      const codes = new Set(currencies.map(raw => PDF_CURRENCY[raw] || raw));
      if (codes.size > 1) continue;
      const key = /ttc/i.test(amount[1]) ? "ttc" : "a_payer";
      add(key, index + 1, match[0].trim(), value, { currency: codes.values().next().value });
    }
  }
  for (const [key, label, expected, path] of [
    ["numero", "Numéro de facture", s.numero, header("N° de facture")?.path],
    ["identifiant", "Identifiant fournisseur", legal?.value || vat?.value, legal?.path || vat?.path],
    ["devise", "Devise", s.devise, header("Devise")?.path],
    ["ttc", "Total TTC", s.ttc, s.provenance?.ttc?.path],
    ["a_payer", "Net à payer", s.a_payer, s.provenance?.a_payer?.path],
  ]) {
    const found = candidates[key];
    const distinct = new Set(found.map(item => item.kind || ""));
    const first = found[0];
    const xmlValue = first?.xml?.value || expected || "";
    const normalized = key === "identifiant" ? first?.expected : key === "numero" || key === "devise"
      ? xmlValue.toUpperCase() : decimalCents(xmlValue);
    const ambiguous = found.some(item => item.value !== first.value || (item.currency && first.currency && item.currency !== first.currency));
    const wrongCurrency = (key === "ttc" || key === "a_payer") && found.some(item => item.currency && item.currency !== s.devise);
    let etat = "non_verifiable", detail;
    if (!xmlValue || (normalized == null && key !== "identifiant")) detail = "Valeur XML indisponible.";
    else if (!first) detail = "Champ introuvable dans le texte PDF.";
    else if (distinct.size > 1 || ambiguous) detail = "Plusieurs correspondances PDF possibles.";
    else if (wrongCurrency) detail = "Montant PDF exprimé dans une autre devise.";
    else {
      etat = first.value === normalized ? "conforme" : "ecart";
      detail = "Valeur PDF relevée page " + first.page + ".";
    }
    checks.push({
      famille: "pdf_xml", regle: "PDF / XML · " + label, etat, detail, attendu: xmlValue,
      constate: etat !== "non_verifiable" ? first.raw : "", ecart: "", path: first?.xml?.path || path || "",
      pdf_page: etat !== "non_verifiable" ? first.page : null, pdf_source: source,
    });
  }
  return checks;
}

async function compareInvoicePdf(result) {
  if (!result.synthese || !["UBL", "CII"].includes(result.format)) return;
  const source = result.pdf ? "pdf" : "xmlpdf";
  const pdf = result.pdf || result.xml_pdf;
  if (!pdf?.base64) return;
  let task;
  let checks;
  const unavailable = detail => [{ famille: "pdf_xml", regle: "Comparaison PDF / XML", etat: "non_verifiable", detail }];
  try {
    task = loadPdfTask(b64toBytes(pdf.base64));
    const doc = await task.promise;
    const pages = [];
    let textLength = 0;
    if (doc.numPages <= 50) {
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        const text = content.items.map(item => (item.str || "") + (item.hasEOL ? "\n" : item.str ? " " : "")).join("");
        textLength += text.length;
        page.cleanup();
        if (textLength > 1_000_000) break;
        pages.push(text.split("\n").map(line => line.replace(/\s+/g, " ").trim()).join("\n"));
      }
    }
    checks = doc.numPages > 50 ? unavailable("Comparaison limitée aux PDF de 50 pages ou moins.")
      : textLength > 1_000_000 ? unavailable("Le texte dépasse la limite de comparaison.")
      : pages.some(page => page.trim()) ? pdfXmlChecks(result, pages, source)
      : unavailable("Texte indisponible dans le PDF.");
  } catch {
    checks = unavailable("Texte PDF inaccessible.");
  } finally {
    await task?.destroy().catch(() => {});
  }
  result.controles = [...(result.controles || []), ...checks];
}

function revealPdfComparisonPage(f) {
  const target = f.pdfComparisonTarget;
  if (!target) return;
  requestAnimationFrame(() => {
    if (f.pdfComparisonTarget !== target || state.selected !== f.id || state.tab !== target.source ||
      state.pdfSource !== target.source || !f.rendered.pdf) return;
    const page = byId("pdf-pages").querySelector('[data-page="' + target.page + '"]');
    if (page) {
      delete f.pdfComparisonTarget;
      page.scrollIntoView({ block: "start" });
    }
  });
}

function openPdfComparisonPage(f, issue) {
  if (state.selected !== f.id) selectFile(f.id);
  f.pdfComparisonTarget = { source: issue.pdfSource, page: issue.pdfPage };
  setTab(issue.pdfSource);
  revealPdfComparisonPage(f);
}
