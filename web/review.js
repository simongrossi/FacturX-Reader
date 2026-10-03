"use strict";

/* Suivi local de vérification ; indépendant du paiement et des contrôles calculés. */
const REVIEW_STATUSES = ["À vérifier", "Vérifiée", "Anomalie"];
/* Le suivi est enregistré dans suivi.json, à côté des pointages (clé = empreinte du XML).
   Il est chargé en entier au démarrage : la lecture reste synchrone pour l'affichage. */
const reviewCache = new Map();
const reviewPending = new Map();
const REVIEW_LEGACY_PREFIX = "fx-review:";
function reviewKey(f) { return f.result?.doc_hash || f.source?.key || f.name; }
function validReview(value) {
  return !!value && REVIEW_STATUSES.includes(value.status) && typeof value.comment === "string" &&
    !!value.lines && typeof value.lines === "object" && !Array.isArray(value.lines) &&
    Object.values(value.lines).every(c => typeof c === "string");
}
function reviewIsEmpty(r) { return r.status === REVIEW_STATUSES[0] && !r.comment && !Object.keys(r.lines).length; }
async function initReviews() {
  let stored;
  try { stored = await api.getReviews(); }
  catch (error) { dataNotice(error); return; }
  reviewCache.clear();
  for (const [key, value] of Object.entries(stored || {}))
    if (validReview(value)) reviewCache.set(key, { status: value.status, comment: value.comment, lines: value.lines });
  // Reprise des suivis enregistrés par les versions précédentes dans le stockage de la WebView :
  // une entrée n'est retirée de l'ancien stockage qu'une fois écrite dans le fichier.
  let legacy = [];
  try { legacy = Object.keys(localStorage).filter(k => k.startsWith(REVIEW_LEGACY_PREFIX)); } catch { return; }
  for (const storageKey of legacy) {
    const key = storageKey.slice(REVIEW_LEGACY_PREFIX.length);
    try {
      const value = JSON.parse(localStorage.getItem(storageKey));
      if (validReview(value) && !reviewIsEmpty(value) && !reviewCache.has(key)) {
        const review = { status: value.status, comment: value.comment, lines: value.lines };
        await api.setReview(key, review, "");
        reviewCache.set(key, review);
      }
      localStorage.removeItem(storageKey);
    } catch (error) { dataNotice(error); return; }
  }
}
function readReview(f) {
  return reviewCache.get(reviewKey(f)) || { status: REVIEW_STATUSES[0], comment: "", lines: {} };
}
/* La frappe d'un commentaire est regroupée ; un changement de statut est écrit tout de suite. */
function writeReview(f, review, immediate) {
  const key = reviewKey(f);
  reviewCache.set(key, review);
  clearTimeout(reviewPending.get(key)?.timer);
  const run = () => { reviewPending.delete(key); return api.setReview(key, review, f.name).catch(dataNotice); };
  if (immediate) return run();
  reviewPending.set(key, { run, timer: setTimeout(run, 400) });
}
function flushReviews() {
  const runs = [...reviewPending.values()];
  for (const p of runs) clearTimeout(p.timer);
  return Promise.all(runs.map(p => p.run()));
}
function reviewSelect(f) {
  const select = document.createElement("select");
  select.className = "review-select";
  select.setAttribute("aria-label", "Vérification de " + f.name);
  REVIEW_STATUSES.forEach(status => select.add(new Option(status, status)));
  select.value = readReview(f).status;
  select.dataset.status = select.value;
  select.onchange = () => {
    writeReview(f, { ...readReview(f), status: select.value }, true);
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
  comment.onchange = flushReviews;
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
    lineComment.onchange = flushReviews;
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
    verdicts: (() => {
      const v = invoiceVerdicts(f);
      return { lecture: v.lecture.label, calculs: v.calculs.label, regles_en16931: v.regles.label, schema_xsd: v.xsd ? v.xsd.label : null, regles_francaises: v.france ? v.france.label : null, autres_alertes: v.alertes, non_controle: NOT_CHECKED };
    })(),
    synthese: r.synthese || null,
    controles: r.controles || [],
    regles_en16931: r.regles || null,
    schema_xsd: r.xsd || null,
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
  window.addEventListener("pagehide", flushReviews);
  for (const id of ["tab-pdf", "tab-data"]) byId(id).addEventListener("scroll", () => {
    if (state.tab !== "dual") return;
    clearTimeout(workspaceSaveTimer);
    workspaceSaveTimer = setTimeout(() => { captureDocumentView(); saveWorkspace(); }, 250);
    if (id === "tab-pdf" && state.pdfDoc) updatePageInfo(state.pdfDoc);
  });
}
