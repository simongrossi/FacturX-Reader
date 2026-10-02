"use strict";

/* Suivi local de vérification ; indépendant du paiement et des contrôles calculés. */
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
  select.className = "review-select";
  select.setAttribute("aria-label", "Vérification de " + f.name);
  REVIEW_STATUSES.forEach(status => select.add(new Option(status, status)));
  select.value = readReview(f).status;
  select.dataset.status = select.value;
  select.onchange = () => {
    writeReview(f, { ...readReview(f), status: select.value });
    select.dataset.status = select.value;
    renderList(true);
  };
  return select;
}
/* Panneau « Suivi de vérification » de l'onglet Données. */
function reviewPanel(f) {
  const panel = document.createElement("details"); panel.className = "section review-panel";
  const review = readReview(f);
  panel.open = review.status !== "À vérifier" || !!review.comment || Object.keys(review.lines).length > 0;
  const title = document.createElement("summary"); title.className = "section-head controls-head";
  title.append(Object.assign(document.createElement("span"), { textContent: "Suivi de vérification" }), reviewSelect(f));
  const body = document.createElement("div"); body.className = "review-body";
  const note = document.createElement("p"); note.textContent = "Statut manuel, sans confirmation de paiement. Les commentaires sont enregistrés localement, associés à l’empreinte du XML.";
  body.append(note);
  const label = document.createElement("label"); label.textContent = "Commentaire de la facture";
  const comment = document.createElement("textarea"); comment.maxLength = 10000;
  comment.setAttribute("aria-label", "Commentaire de la facture"); comment.value = review.comment;
  comment.oninput = () => { writeReview(f, { ...readReview(f), comment: comment.value }); };
  label.append(comment); body.append(label);
  if (f.result.lines?.length) {
    const select = document.createElement("select"); select.setAttribute("aria-label", "Ligne à commenter");
    f.result.lines.forEach((line, i) => select.add(new Option(`${i + 1} — ${line.cells?.name?.value || line.cells?.itemid?.value || "Ligne"}`, String(i))));
    const lineComment = document.createElement("textarea"); lineComment.maxLength = 10000;
    lineComment.setAttribute("aria-label", "Commentaire de la ligne");
    const sync = () => { lineComment.value = readReview(f).lines[select.value] || ""; };
    select.onchange = sync; sync();
    lineComment.oninput = () => {
      const current = readReview(f); const lines = { ...current.lines };
      if (lineComment.value) lines[select.value] = lineComment.value; else delete lines[select.value];
      writeReview(f, { ...current, lines });
    };
    const lineLabel = document.createElement("label"); lineLabel.textContent = "Commentaires par ligne";
    lineLabel.append(select, lineComment); body.append(lineLabel);
    const point = document.createElement("button"); point.className = "btn btn-sm"; point.type = "button"; point.textContent = "Pointer toutes les lignes";
    point.onclick = async () => {
      await loadPointage(f);
      f.pointed = new Set(f.result.lines.map((_, i) => i));
      await api.setPointage(f.result.doc_hash, [...f.pointed], f.name).catch(() => workspaceNotice("Le pointage n’a pas pu être enregistré."));
      if (state.selected === f.id) renderLinesOnly(f);
    };
    body.append(point);
  }
  panel.append(title, body);
  return panel;
}

/* Rapport de contrôle : synthèse, contrôles du moteur et suivi manuel. */
function controlReport(f) {
  const r = f.result, review = readReview(f);
  return {
    fichier: f.name,
    empreinte_xml: r.doc_hash || null,
    format: r.format,
    genere_le: new Date().toISOString(),
    synthese: r.synthese || null,
    controles: r.controles || [],
    suivi: { statut: review.status, commentaire: review.comment, lignes: review.lines },
  };
}
async function exportControlReport(f, btn) {
  const old = btn.textContent;
  try {
    if (await api.saveReport(f.name.replace(/\.[^.]+$/, "") + "-controles.json", controlReport(f))) btn.textContent = "Exporté";
  } catch (error) { workspaceNotice("Export du rapport impossible : " + ((error && error.message) || error)); }
  setTimeout(() => { btn.textContent = old; }, 1200);
}

/* Vue « PDF et données » : chaque volet garde son propre défilement. */
function wireReview() {
  for (const id of ["tab-pdf", "tab-data"]) byId(id).addEventListener("scroll", () => {
    if (state.tab !== "dual") return;
    clearTimeout(workspaceSaveTimer);
    workspaceSaveTimer = setTimeout(() => { captureDocumentView(); saveWorkspace(); }, 250);
    if (id === "tab-pdf" && state.pdfDoc) updatePageInfo(state.pdfDoc);
  });
}
