"use strict";

/* Bilan de toute la session : les filtres du tableau n'excluent jamais un fichier du rapport. */
const batchReview = { limit: 50 };

function batchAuditSnapshot() {
  const files = state.files;
  const documents = [], points = [];
  let done = 0, importing = 0, validating = 0, unreadable = 0, incomplete = 0, affected = 0, anomalies = 0;
  for (const f of files) {
    if (f.status === "loading") { importing++; continue; }
    if (f.status === "error" || !f.result) {
      done++; unreadable++; affected++;
      const doc = { f, name: f.name, status: "error", reason: f.error || "Lecture impossible", issues: [], incomplete: [] };
      documents.push(doc);
      points.push({ kind: "error", f, message: doc.reason });
      continue;
    }
    const r = f.result;
    const waiting = ["CII", "UBL"].includes(r.format) && !r.schematron;
    if (waiting) validating++; else done++;
    const result = invoiceAnomalies(f);
    const doc = { f, name: f.name, status: waiting ? "validating" : "ready", format: r.format,
      number: r.synthese?.numero || "", seller: r.synthese?.vendeur || "", date: r.synthese?.date || "",
      currency: r.synthese?.devise || "", amount: r.synthese?.ttc || "", credit: !!r.synthese?.avoir,
      issues: result.issues, incomplete: result.incomplete };
    documents.push(doc);
    anomalies += doc.issues.length;
    if (!waiting && doc.incomplete.length) incomplete++;
    if (doc.issues.length || (!waiting && doc.incomplete.length)) affected++;
    for (const issue of doc.issues) points.push({ kind: issue.severity, f, issue, message: issue.title });
    if (!waiting) for (const message of doc.incomplete) points.push({ kind: "incomplete", f, message });
  }
  return { documents, points, total: files.length, done, importing, validating, unreadable, incomplete, affected, anomalies,
    complete: files.length > 0 && done === files.length };
}

function refreshBatchProgress(snapshot = batchAuditSnapshot()) {
  if (!state.batch || state.selected || byId("batch-view").hidden) return snapshot;
  const progress = byId("batch-progress");
  progress.max = Math.max(1, snapshot.total);
  progress.value = snapshot.done;
  byId("batch-progress-label").textContent = snapshot.done + " / " + snapshot.total + " documents analysés";
  const pending = [];
  if (snapshot.importing) pending.push(snapshot.importing + " à lire");
  if (snapshot.validating) pending.push(snapshot.validating + " en validation Schematron");
  byId("batch-audit-summary").textContent = (snapshot.complete ? "Analyse du lot terminée. " : "Analyse en cours : " + pending.join(", ") + ". ") +
    snapshot.affected + " document" + (snapshot.affected > 1 ? "s" : "") + " à examiner · " +
    snapshot.anomalies + " anomalie" + (snapshot.anomalies > 1 ? "s" : "") + " · " +
    snapshot.incomplete + " contrôle" + (snapshot.incomplete > 1 ? "s" : "") + " incomplet" + (snapshot.incomplete > 1 ? "s" : "") + " · " +
    snapshot.unreadable + " non lu" + (snapshot.unreadable > 1 ? "s" : "");
  const exportButton = byId("batch-report");
  if (!exportButton.dataset.exporting) exportButton.disabled = !snapshot.complete;
  exportButton.title = snapshot.complete ? "Créer le bilan PDF de tous les documents ouverts" : "Attendre la fin de la lecture et des validations Schematron";
  return snapshot;
}

function renderBatchIssues(snapshot) {
  const query = byId("batch-anomaly-search").value.trim().toLowerCase();
  const kind = byId("batch-anomaly-kind").value;
  const selected = snapshot.points.filter(point => (kind === "all" || point.kind === kind) &&
    [point.f.name, point.f.result?.synthese?.numero, point.f.result?.synthese?.vendeur, point.issue?.rule,
      point.issue?.source, point.issue?.detail, point.issue?.found, point.issue?.expected, point.message]
      .join(" ").toLowerCase().includes(query));
  byId("batch-anomaly-count").textContent = selected.length + " / " + snapshot.points.length + " points" +
    (selected.length > batchReview.limit ? " · " + batchReview.limit + " affichés" : "");
  const list = byId("batch-anomaly-list");
  list.replaceChildren();
  if (!selected.length) list.appendChild(Object.assign(document.createElement("p"), { className: "notice",
    textContent: snapshot.complete && !snapshot.points.length ? "Aucun point à examiner parmi les contrôles exécutés."
      : snapshot.points.length ? "Aucun point ne correspond aux filtres." : "Les résultats apparaîtront au fil de l’analyse." }));
  for (const point of selected.slice(0, batchReview.limit)) {
    const card = Object.assign(document.createElement("article"), { className: "batch-issue batch-" + point.kind });
    card.appendChild(Object.assign(document.createElement("strong"), { textContent: point.f.name }));
    card.appendChild(Object.assign(document.createElement("span"), { className: "ctl-chip ctl-" +
      (point.kind === "error" ? "ecart" : point.kind === "incomplete" ? "non_verifiable" : point.kind),
      textContent: { ecart: "Écart", alerte: "Alerte", incomplete: "Contrôle incomplet", error: "Non lue" }[point.kind] }));
    if (point.issue) {
      card.appendChild(Object.assign(document.createElement("p"), { textContent: point.issue.title +
        (point.issue.rule ? " · " + point.issue.rule : "") + " · " + ANOMALY_SOURCES[point.issue.source] }));
      if (point.issue.detail) card.appendChild(Object.assign(document.createElement("p"), { className: "verdict-note", textContent: point.issue.detail }));
      if (point.issue.found != null || point.issue.expected != null) card.appendChild(Object.assign(document.createElement("p"), {
        className: "verdict-note", textContent: "Trouvé : " + (point.issue.found ?? "non fourni") + " · Attendu : " + (point.issue.expected ?? "non fourni") }));
    } else card.appendChild(Object.assign(document.createElement("p"), { textContent: point.message }));
    const open = Object.assign(document.createElement("button"), { type: "button", className: "btn btn-sm", textContent: "Ouvrir la facture" });
    open.addEventListener("click", () => {
      if (point.issue) openAnomalyLocation(point.f, point.issue);
      else { selectFile(point.f.id); if (point.f.status === "ok") { setTab("data"); focusControlSection("anomaly-center"); } }
    });
    card.appendChild(open); list.appendChild(card);
  }
  byId("batch-anomaly-more").hidden = selected.length <= batchReview.limit;
}

function renderBatchOverview() {
  if (!state.batch || state.selected || byId("batch-view").hidden) return;
  const snapshot = refreshBatchProgress(batchAuditSnapshot());
  renderBatchIssues(snapshot);
}

function wireBatchOverview() {
  byId("batch-anomaly-search").addEventListener("input", () => { batchReview.limit = 50; renderBatchIssues(batchAuditSnapshot()); });
  byId("batch-anomaly-kind").addEventListener("change", () => { batchReview.limit = 50; renderBatchIssues(batchAuditSnapshot()); });
  byId("batch-anomaly-more").addEventListener("click", () => { batchReview.limit += 50; renderBatchIssues(batchAuditSnapshot()); });
  byId("batch-report").addEventListener("click", (event) => exportBatchReport(event.currentTarget));
}

function batchReportSnapshot() {
  const audit = batchAuditSnapshot();
  if (!audit.complete) throw new Error("Attendez la fin de la lecture et des validations Schematron.");
  const totals = [...batchTotals(batchRows())].map(([currency, values]) => ({ currency, ...values }));
  return { ...audit, totals, generatedAt: new Date().toLocaleString("fr-FR") };
}

async function batchPdfBuffer(snapshot, onProgress) {
  if (!reportFont) {
    reportFont = fetch("exports/NotoSans-Regular.ttf").then(response => {
      if (!response.ok) throw new Error("Police du rapport indisponible.");
      return response.arrayBuffer();
    }).then(exportBase64).catch(error => { reportFont = null; throw error; });
  }
  const pdf = new jspdf.jsPDF({ compress: true });
  pdf.addFileToVFS("NotoSans.ttf", await reportFont);
  pdf.addFont("NotoSans.ttf", "NotoSans", "normal");
  pdf.setFont("NotoSans");
  pdf.setProperties({ title: "Bilan du lot de factures", author: "Factur-X Reader" });
  let y = 24;
  function header() {
    pdf.setFontSize(10); pdf.setTextColor(11, 107, 203);
    pdf.text("Factur-X Reader | Bilan du lot", 16, 14);
    pdf.setTextColor(30, 40, 50);
  }
  function line(value, size = 10) {
    pdf.setFontSize(size);
    for (const part of pdf.splitTextToSize(String(value ?? ""), 178)) {
      if (y + size * 0.45 > 277) { pdf.addPage(); header(); y = 24; pdf.setFontSize(size); }
      pdf.text(part, 16, y); y += size * 0.45 + 1;
    }
  }
  function heading(value) { if (y > 254) { pdf.addPage(); header(); y = 24; } y += 5; line(value, 13); y += 2; }
  header();
  line("Bilan de " + snapshot.total + " documents", 16);
  line("Généré le " + snapshot.generatedAt);
  line(snapshot.affected + " documents à examiner · " + snapshot.anomalies + " anomalies · " +
    snapshot.incomplete + " documents avec contrôles incomplets · " + snapshot.unreadable + " factures non lues.");
  line("Tous les documents ouverts sont inclus, indépendamment des filtres du tableau. Les contrôles exécutés ne constituent pas une certification de conformité.");
  heading("Totaux par devise (avoirs déduits)");
  if (!snapshot.totals.length) line("Aucune facture chiffrée disponible.");
  for (const t of snapshot.totals) line((t.currency || "Sans devise") + " : " + t.n + " document" + (t.n > 1 ? "s" : "") +
    " dont " + t.avoirs + " avoir" + (t.avoirs > 1 ? "s" : "") + " · HT " + (t.ht / 100).toFixed(2) + " · TVA " + (t.tva / 100).toFixed(2) +
    " · TTC " + (t.ttc / 100).toFixed(2) + " · À payer " + (t.a_payer / 100).toFixed(2));
  heading("Détail par facture");
  for (let i = 0; i < snapshot.documents.length; i++) {
    const item = snapshot.documents[i];
    if (y > 248) { pdf.addPage(); header(); y = 24; }
    line((i + 1) + ". " + item.name + (item.number ? " · " + item.number : ""), 12);
    if (item.status === "error") line("Lecture impossible : " + item.reason);
    else {
      line([item.seller, item.date, item.amount && "TTC " + item.amount + " " + item.currency,
        item.credit && "Avoir"].filter(Boolean).join(" · ") || "Synthèse indisponible");
      if (!item.issues.length && !item.incomplete.length) line("Aucun point relevé par les contrôles exécutés.");
      for (const issue of item.issues) {
        line("- " + (issue.severity === "ecart" ? "Écart" : "Alerte") + " · " + ANOMALY_SOURCES[issue.source] +
          (issue.rule ? " [" + issue.rule + "]" : "") + " : " + issue.title);
        if (issue.detail) line("  Détail : " + issue.detail);
        if (issue.found != null) line("  Valeur trouvée : " + issue.found);
        if (issue.expected != null) line("  Valeur attendue : " + issue.expected);
        line("  À vérifier : " + issue.action);
      }
      for (const message of item.incomplete) line("- Contrôle incomplet : " + message);
    }
    y += 5;
    if (i % 10 === 9) { onProgress(i + 1, snapshot.documents.length); await new Promise(resolve => setTimeout(resolve, 0)); }
  }
  const pages = pdf.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    pdf.setPage(i); pdf.setFontSize(8); pdf.setTextColor(90, 100, 110);
    pdf.text("Généré localement avec Factur-X Reader", 16, 287);
    pdf.text(i + " / " + pages, 194, 287, { align: "right" });
  }
  onProgress(snapshot.documents.length, snapshot.documents.length);
  return pdf.output("arraybuffer");
}

async function exportBatchReport(button) {
  if (button.dataset.exporting) return;
  const old = button.textContent;
  button.dataset.exporting = "1";
  button.disabled = true;
  try {
    const snapshot = batchReportSnapshot();
    button.textContent = "Préparation…";
    const pdf = await batchPdfBuffer(snapshot, (done, total) => { button.textContent = "Rapport " + done + "/" + total; });
    if (await api.saveBinary("bilan-factures.pdf", exportBase64(pdf))) button.textContent = "Exporté";
  } catch (error) { workspaceNotice("Rapport du lot impossible : " + (error?.message || error)); }
  finally {
    delete button.dataset.exporting;
    refreshBatchProgress();
    setTimeout(() => { button.textContent = old; }, 1200);
  }
}
