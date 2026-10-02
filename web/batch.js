/* Suivi local de vérification ; indépendant du paiement et des contrôles comptables. */
const REVIEW_STATUSES = ["À vérifier", "Vérifiée", "Anomalie"];
const reviewCache = new Map();
function reviewKey(f) { return "fx-review:" + (f.result?.doc_hash || f.source?.key || f.name); }
function readReview(f) {
  const key = reviewKey(f);
  if (reviewCache.has(key)) return reviewCache.get(key);
  let review = { status: "À vérifier", comment: "", lines: {} };
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const value = JSON.parse(raw);
      if (!REVIEW_STATUSES.includes(value.status) || typeof value.comment !== "string" ||
          !value.lines || typeof value.lines !== "object" || Array.isArray(value.lines) ||
          Object.values(value.lines).some(c => typeof c !== "string")) throw new Error("Format invalide");
      review = value;
    }
  } catch { workspaceNotice("Suivi de vérification illisible ou indisponible pour " + f.name + "."); }
  reviewCache.set(key, review);
  return review;
}
function writeReview(f, review) {
  reviewCache.set(reviewKey(f), review);
  try { localStorage.setItem(reviewKey(f), JSON.stringify(review)); }
  catch { workspaceNotice("Le suivi de " + f.name + " n’a pas pu être enregistré. Vos changements restent dans cette session."); }
}
function reviewSelect(f) {
  const select = document.createElement("select");
  select.setAttribute("aria-label", "Vérification de " + f.name);
  REVIEW_STATUSES.forEach(status => select.add(new Option(status, status)));
  select.value = readReview(f).status;
  select.onchange = () => { writeReview(f, { ...readReview(f), status: select.value }); renderList(true); };
  return select;
}
function renderReview(f, pane) {
  const panel = document.createElement("section"); panel.className = "section review-panel";
  const title = document.createElement("h3"); title.textContent = "Suivi de vérification";
  const note = document.createElement("p"); note.textContent = "Statut manuel, sans confirmation de paiement. Les commentaires sont enregistrés localement, associés à l’empreinte du XML.";
  panel.append(title, reviewSelect(f), note);
  const label = document.createElement("label"); label.textContent = "Commentaire de la facture";
  const comment = document.createElement("textarea"); comment.maxLength = 10000;
  comment.setAttribute("aria-label", "Commentaire de la facture"); comment.value = readReview(f).comment;
  comment.oninput = () => { writeReview(f, { ...readReview(f), comment: comment.value }); };
  label.append(comment); panel.append(label);
  if (f.result.lines?.length) {
    const select = document.createElement("select"); select.setAttribute("aria-label", "Ligne à commenter");
    f.result.lines.forEach((line, i) => select.add(new Option(`${i + 1} — ${line.cells?.name?.value || line.cells?.itemid?.value || "Ligne"}`, String(i))));
    const lineComment = document.createElement("textarea"); lineComment.maxLength = 10000;
    lineComment.setAttribute("aria-label", "Commentaire de la ligne");
    const sync = () => { lineComment.value = readReview(f).lines[select.value] || ""; };
    select.onchange = sync; sync();
    lineComment.oninput = () => {
      const review = readReview(f); const lines = { ...review.lines };
      if (lineComment.value) lines[select.value] = lineComment.value; else delete lines[select.value];
      writeReview(f, { ...review, lines });
    };
    const lineLabel = document.createElement("label"); lineLabel.textContent = "Commentaires par ligne";
    lineLabel.append(select, lineComment); panel.append(lineLabel);
    const point = document.createElement("button"); point.className = "btn"; point.textContent = "Pointer toutes les lignes";
    point.onclick = async () => {
      await loadPointage(f);
      f.pointed = new Set(f.result.lines.map((_, i) => i));
      await api.setPointage(f.result.doc_hash, [...f.pointed], f.name).catch(() => workspaceNotice("Le pointage n’a pas pu être enregistré."));
      if (state.selected === f.id) renderLinesOnly(f);
    };
    panel.append(point);
  }
  pane.prepend(panel);
}
function summaryValue(r, title) {
  return [...(r.summary || []), ...(r.header || [])].find(c => c.title === title)?.value || "";
}
function rawAmount(r, tag, parent, currency) {
  return (r.rows || []).find(c => c.tag === tag && c.path?.split("/").at(-2)?.replace(/\[\d+\]$/, "") === parent &&
    (r.format !== "UBL" || c.path.split("/").length === 3) &&
    (!c.attrs?.currencyID || !currency || c.attrs.currencyID === currency))?.value || "";
}
function batchRecord(f) {
  const r = f.result || {};
  const currency = summaryValue(r, "Devise") || (r.rows || []).find(c => ["InvoiceCurrencyCode", "DocumentCurrencyCode"].includes(c.tag))?.value || "";
  const code = (r.rows || []).find(c => ["InvoiceTypeCode", "CreditNoteTypeCode"].includes(c.tag) ||
    (c.tag === "TypeCode" && c.path?.includes("ExchangedDocument")))?.value;
  const credit = r.root === "CreditNote" || code === "381";
  const kind = credit ? "Avoir" : r.root === "Invoice" || code === "380" ? "Facture" : "Non déterminée";
  const ubl = r.format === "UBL";
  const parent = ubl ? "LegalMonetaryTotal" : "SpecifiedTradeSettlementHeaderMonetarySummation";
  return {
    f, supplier: summaryValue(r, "Vendeur"), number: summaryValue(r, "N° facture") || summaryValue(r, "N° de facture") || summaryValue(r, "N° d'avoir"),
    date: summaryValue(r, "Date d'émission"), due: summaryValue(r, "Échéance") || summaryValue(r, "Date d'échéance"),
    ht: rawAmount(r, ubl ? "TaxExclusiveAmount" : "TaxBasisTotalAmount", parent, currency),
    tva: rawAmount(r, ubl ? "TaxAmount" : "TaxTotalAmount", ubl ? "TaxTotal" : parent, currency),
    ttc: rawAmount(r, ubl ? "TaxInclusiveAmount" : "GrandTotalAmount", parent, currency),
    currency: /^[A-Z]{3}$/.test(currency) ? currency : "Devise inconnue", kind, credit,
  };
}
/* Addition décimale exacte, sans passer par les nombres flottants. */
function batchDecimal(value) {
  const text = String(value).replace(/[\s\u00a0\u202f]/g, "").replace(/(?:[A-Z]{3}|€)$/, "").replace(",", ".");
  const match = /^([+-]?)(\d{1,40})(?:\.(\d{1,12}))?$/.exec(text);
  if (!match) return null;
  return { n: BigInt((match[1] === "-" ? "-" : "") + match[2] + (match[3] || "")), scale: (match[3] || "").length };
}
function batchAdd(a, b) {
  const scale = Math.max(a.scale, b.scale);
  return { n: a.n * 10n ** BigInt(scale - a.scale) + b.n * 10n ** BigInt(scale - b.scale), scale };
}
function batchFormat(a) {
  const scale = Math.max(2, a.scale), n = a.n * 10n ** BigInt(scale - a.scale);
  const digits = (n < 0n ? -n : n).toString().padStart(scale + 1, "0");
  return (n < 0n ? "−" : "") + digits.slice(0, -scale).replace(/\B(?=(\d{3})+(?!\d))/g, " ") + "," + digits.slice(-scale);
}
function matchesBatchFilter(f) {
  const query = byId("batch-query")?.value.trim().toLocaleLowerCase("fr") || "";
  if (byId("batch-xml")?.checked && !(f.result?.rows?.length)) return false;
  if (byId("batch-status")?.value && (f.status !== "ok" || readReview(f).status !== byId("batch-status").value)) return false;
  if (!query) return true;
  const record = batchRecord(f), review = f.status === "ok" ? readReview(f) : {};
  const text = [f.name, record.supplier, record.number, record.ht, record.tva, record.ttc, record.currency,
    review.comment, ...Object.values(review.lines || {}), ...(f.result?.lines || []).flatMap(line => Object.values(line.cells || {}).map(c => c.value))].join(" ");
  return text.toLocaleLowerCase("fr").includes(query);
}
function renderOverview() {
  if (!byId("overview-table")) return;
  const visible = state.files.filter(matchesBatchFilter);
  byId("batch-count").textContent = `${visible.length} / ${state.files.length} documents`;
  if (!state.overview) return;
  const body = byId("overview-table").querySelector("tbody"); body.replaceChildren();
  const groups = new Map();
  for (const f of visible) {
    const record = batchRecord(f), tr = document.createElement("tr");
    const link = document.createElement("button"); link.className = "welcome-action"; link.textContent = f.name; link.onclick = () => selectFile(f.id);
    const td = document.createElement("td"); td.append(link); tr.append(td);
    for (const field of ["supplier", "number", "kind", "date", "ht", "tva", "ttc", "currency", "due"]) {
      const cell = document.createElement("td"); cell.textContent = record[field] || "—"; tr.append(cell);
    }
    const status = document.createElement("td");
    if (f.status === "ok") status.append(reviewSelect(f)); else status.textContent = f.status === "error" ? "Erreur : " + f.error : "Chargement…";
    tr.append(status); body.append(tr);
    if (f.status !== "ok") continue;
    if (!groups.has(record.currency)) groups.set(record.currency, { count: 0, ht: { n: 0n, scale: 0 }, tva: { n: 0n, scale: 0 }, ttc: { n: 0n, scale: 0 }, missing: { ht: 0, tva: 0, ttc: 0 } });
    const group = groups.get(record.currency); group.count++;
    for (const field of ["ht", "tva", "ttc"]) {
      const amount = batchDecimal(record[field]);
      if (!amount || record.kind === "Non déterminée" || record.currency === "Devise inconnue") { group.missing[field]++; continue; }
      amount.n = record.credit ? -(amount.n < 0n ? -amount.n : amount.n) : amount.n;
      group[field] = batchAdd(group[field], amount);
    }
  }
  const totals = byId("overview-totals"); totals.replaceChildren();
  if (!visible.length) totals.textContent = "Aucun document ne correspond aux filtres.";
  for (const [currency, group] of groups) {
    const p = document.createElement("p");
    p.textContent = `${currency} · ${group.count} document(s) · ` + ["ht", "tva", "ttc"].map(field => `${field.toUpperCase()} : ${batchFormat(group[field])} (${group.count - group.missing[field]}/${group.count} contributions)`).join(" · ");
    totals.append(p);
  }
}
function showOverview() {
  captureDocumentView(); state.selected = null; state.overview = true;
  state.pdfDoc = null; state.pdfSource = null; workspaceScrollTarget = null;
  renderList(); renderFileView();
}
document.addEventListener("DOMContentLoaded", () => {
  for (const id of ["batch-query", "batch-status", "batch-xml"]) byId(id).addEventListener("input", () => renderList(true));
  for (const id of ["tab-pdf", "tab-data"]) byId(id).addEventListener("scroll", () => {
    if (state.tab !== "dual") return;
    clearTimeout(workspaceSaveTimer);
    workspaceSaveTimer = setTimeout(() => { captureDocumentView(); saveWorkspace(); }, 250);
    if (id === "tab-pdf" && state.pdfDoc) updatePageInfo(state.pdfDoc);
  });
});
