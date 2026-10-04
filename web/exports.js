"use strict";

/* Génération locale. Les chaînes sont toujours des cellules texte, jamais des formules. */
function exportBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}

async function exportAction(btn, run) {
  const old = btn.textContent;
  btn.disabled = true;
  try { if (await run()) btn.textContent = "Exporté"; }
  catch (error) { workspaceNotice("Export impossible : " + (error?.message || error)); }
  finally { btn.disabled = false; setTimeout(() => { btn.textContent = old; }, 1200); }
}

/* Excel garde 15 chiffres significatifs : les valeurs plus précises restent textuelles. */
function excelNumber(value) {
  const text = String(value).replace(",", ".");
  if (!/^-?\d+(?:\.\d+)?$/.test(text)) return String(value);
  if (text.replace(/[-.]/g, "").replace(/^0+/, "").length > 15) return String(value);
  const number = Number(text);
  return Number.isFinite(number) ? number : String(value);
}

async function excelBuffer(sheets) {
  const book = new ExcelJS.Workbook();
  book.creator = "Factur-X Reader";
  book.created = new Date();
  for (const { name, rows, numeric = [] } of sheets) {
    const sheet = book.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
    rows.forEach((values, index) => {
      const row = sheet.addRow(values.map((value, col) => index && numeric.includes(col) ? excelNumber(value) : String(value ?? "")));
      row.alignment = { vertical: "top", wrapText: true };
      if (!index) {
        row.font = { bold: true, color: { argb: "FFFFFFFF" } };
        row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0B6BCB" } };
      } else {
        for (const col of numeric) row.getCell(col + 1).numFmt = "0.00########";
      }
    });
    sheet.columns.forEach((col, index) => {
      col.width = Math.min(48, rows.reduce((width, row) => Math.max(width, Math.min(48, String(row[index] ?? "").length + 2)), 14));
    });
    if (rows[0]?.length) sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: rows.length, column: rows[0].length } };
  }
  return book.xlsx.writeBuffer();
}

function exportLinesExcel(f, btn) {
  return exportAction(btn, async () => {
    await loadPointage(f);
    const cols = linesCols(f.result).filter(c => c.key !== "detail");
    const numeric = cols.flatMap((c, i) => c.align === "right" ? [i + 1] : []);
    return api.saveBinary(f.name.replace(/\.[^.]+$/, "") + "-lignes.xlsx", exportBase64(await excelBuffer([{ name: "Lignes", rows: linesExportRows(f), numeric }])));
  });
}

function exportBatchExcel(btn) {
  return exportAction(btn, async () => {
    const rows = batchVisibleRows();
    const totals = [["Devise", "Documents", "Avoirs déduits", "HT", "TVA", "TTC", "À payer"]];
    for (const [currency, t] of batchTotals(rows)) totals.push([currency, t.n, t.avoirs, ...BATCH_MONEY.map(k => (t[k] / 100).toFixed(2))]);
    return api.saveBinary("factures.xlsx", exportBase64(await excelBuffer([
      { name: "Factures", rows: batchExportRows(), numeric: [...BATCH_COLS.flatMap((c, i) => c.num ? [i] : []), BATCH_COLS.length] },
      { name: "Totaux par devise", rows: totals, numeric: [1, 2, 3, 4, 5, 6] },
    ])));
  });
}

let reportFont;
async function controlPdfBuffer(report) {
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
  pdf.setProperties({ title: "Rapport de contrôle - " + report.fichier, author: "Factur-X Reader" });
  let y = 24;
  function header() {
    pdf.setFontSize(10); pdf.setTextColor(11, 107, 203);
    pdf.text("Factur-X Reader | Rapport de contrôle", 16, 14);
    pdf.setTextColor(30, 40, 50);
  }
  header();
  function text(value, size = 10) {
    pdf.setFontSize(size);
    const lines = pdf.splitTextToSize(String(value ?? "").replace(/\t/g, "  "), 178);
    for (const line of lines) {
      if (y + size * 0.45 > 277) { pdf.addPage(); header(); y = 24; pdf.setFontSize(size); }
      pdf.text(line, 16, y); y += size * 0.45 + 1;
    }
  }
  function section(title) {
    if (y > 255) { pdf.addPage(); header(); y = 24; }
    y += 5; text(title, 13); y += 2;
  }
  const labels = { schematron: "Schematron officiel", lecture: "Lecture", calculs: "Calculs", regles_en16931: "Règles EN 16931", schema_xsd: "Schéma XSD", regles_francaises: "Règles françaises", conteneur: "Conteneur PDF", autres_alertes: "Autres alertes", non_controle: "Non contrôlé", numero: "Numéro", vendeur: "Vendeur", acheteur: "Acheteur", date: "Date", echeance: "Échéance", devise: "Devise", ht: "HT", tva: "TVA", ttc: "TTC", a_payer: "À payer", etat: "État", attendu: "Attendu", constate: "Constaté", ecart: "Écart", detail: "Détail", path: "Champ XML", texte: "Message", id: "Règle", evalue: "Évalué", ok: "Résultat", erreurs: "Erreurs", non_evaluables: "Non évaluables", liste: "Règles", regle: "Contrôle", niveau: "Périmètre", jeu_regles: "Jeu de règles", version_regles: "Version des règles", erreur: "Erreur", avertissements: "Avertissements", non_conformes: "Non conformes", non_verifiables: "Non vérifiables" };
  function details(value, prefix = "") {
    if (value == null || value === "") return;
    if (Array.isArray(value)) { value.forEach((v, i) => details(v, prefix + " " + (i + 1))); return; }
    if (typeof value === "object") {
      for (const [key, item] of Object.entries(value)) details(item, (prefix ? prefix + " / " : "") + (labels[key] || key.replaceAll("_", " ")));
    } else {
      const states = { ecart: "Écart", conforme: "Conforme", non_conforme: "Non conforme", non_verifiable: "Non vérifiable", alerte: "Alerte", info: "Information" };
      text(prefix + " : " + (typeof value === "boolean" ? value ? "Oui" : "Non" : states[value] || value));
    }
  }
  text(report.fichier, 16);
  text("Généré le " + report.genere_le);
  text("Format : " + report.format);
  section("Synthèse de la facture");
  details(report.synthese);
  section("Résultats des contrôles");
  details(report.verdicts);
  text("Ce rapport décrit les contrôles réalisés ; il ne constitue pas une certification de conformité.");
  for (const [title, data] of [["Contrôles de cohérence", report.controles], ["Règles EN 16931", report.regles_en16931], ["Schéma XSD", report.schema_xsd], ["Schematron officiel et règles françaises", report.schematron], ["Conteneur PDF", report.conteneur]]) {
    section(title); if (data == null) text("Non évalué ou non applicable."); else details(data);
  }
  if (report.aide_correction) {
    section("Aide à la correction");
    for (const issue of report.aide_correction.issues) {
      text(issue.title + (issue.rule ? " [" + issue.rule + "]" : ""));
      text("Contrôle : " + ANOMALY_SOURCES[issue.source]);
      if (issue.found != null) text("Valeur trouvée : " + issue.found);
      if (issue.expected != null) text("Valeur attendue : " + issue.expected);
      text("Action conseillée : " + issue.action);
      y += 3;
    }
    if (report.aide_correction.incomplete.length) {
      text("Vérification à compléter :");
      for (const message of report.aide_correction.incomplete) text(message);
    }
  }
  section("Suivi manuel de vérification");
  text("Statut : " + report.suivi.statut);
  text("Commentaire : " + (report.suivi.commentaire || "Aucun"));
  for (const [index, comment] of Object.entries(report.suivi.lignes)) text("Ligne " + (Number(index) + 1) + " : " + comment);
  text("Empreinte XML : " + (report.empreinte_xml || "Indisponible"), 8);
  const count = pdf.getNumberOfPages();
  for (let i = 1; i <= count; i++) {
    pdf.setPage(i); pdf.setFontSize(8); pdf.setTextColor(90, 100, 110);
    pdf.text("Généré localement avec Factur-X Reader", 16, 287);
    pdf.text(i + " / " + count, 194, 287, { align: "right" });
  }
  return pdf.output("arraybuffer");
}

function exportControlPdf(f, btn) {
  return exportAction(btn, async () => api.saveBinary(f.name.replace(/\.[^.]+$/, "") + "-controles.pdf", exportBase64(await controlPdfBuffer(controlReport(f)))));
}
