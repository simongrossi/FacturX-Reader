"use strict";

/* ---- verdicts : lecture, calculs et règles EN 16931 ne sont jamais confondus ---- */

const NOT_CHECKED = ["conformité PDF/A-3 complète du fichier (ses déclarations et quelques points de structure sont contrôlés)", "règles nationales autres que françaises (XRechnung, Peppol…)"];
const NOT_CHECKED_NOTE = "Non contrôlés : " + NOT_CHECKED.join(" ; ") + ". Le Schematron officiel et le schéma XSD ont chacun leur verdict ; aucun de ces verdicts ne vaut certification.";

/* Verdicts indépendants d'un document, plus le nombre d'autres alertes. */
function invoiceVerdicts(f, extraAlerts = 0) {
  const r = f.result;
  const plural = (n, word) => n + " " + word + (n > 1 ? "s" : "");
  if (f.status === "error") {
    const none = { etat: "erreur", court: "Non lue", label: "Non lue" };
    return { lecture: { etat: "erreur", court: "Non lue", label: "Lecture impossible" }, calculs: none, regles: none, schematron: null, conteneur: null, alertes: 0 };
  }
  if (!r || !r.synthese) {
    const none = { etat: "non_verifiable", court: "—", label: "Non évalué" };
    return { lecture: { etat: "non_verifiable", court: "Non reconnue", label: "Structure non reconnue" }, calculs: none, regles: none, schematron: null, conteneur: null, alertes: 0 };
  }
  const checks = r.controles || [];
  const calc = checks.filter((c) => c.famille === "calcul");
  const gaps = calc.filter((c) => c.etat === "ecart").length;
  const calculs = gaps ? { etat: "ecart", court: plural(gaps, "écart"), label: plural(gaps, "écart") + " de calcul" }
    : calc.some((c) => c.etat === "conforme") ? { etat: "conforme", court: "Cohérents", label: "Calculs cohérents" }
    : { etat: "non_verifiable", court: "Non vérifiables", label: "Calculs non vérifiables" };
  const report = r.regles;
  const broken = (report && report.non_conformes) || 0;
  const regles = !report || !report.evaluees ? { etat: "non_verifiable", court: "Non évaluées", label: "Règles EN 16931 non évaluées" }
    : broken ? { etat: "ecart", court: broken + " non respectée" + (broken > 1 ? "s" : ""), label: broken + " règle" + (broken > 1 ? "s" : "") + " EN 16931 non respectée" + (broken > 1 ? "s" : "") }
    : { etat: "conforme", court: "Respectées", label: "Règles EN 16931 respectées" };

  let schematron = { etat: "non_verifiable", court: "Non évalué", label: "Schematron officiel non évalué" };
  if (r.schematron) {
    const sch = r.schematron;
    if (sch.evalue && !sch.non_conformes && (sch.non_evaluables || []).length) {
      const n = sch.non_evaluables.length;
      schematron = { etat: "alerte", court: "Partiel", label: "Schematron officiel : " + n + " règle" + (n > 1 ? "s" : "") + " non évaluable" + (n > 1 ? "s" : "") };
    } else if (sch.evalue) {
      schematron = sch.non_conformes > 0
        ? { etat: "ecart", court: plural(sch.non_conformes, "non-conformité"), label: plural(sch.non_conformes, "règle") + " Schematron officiel non respectée" + (sch.non_conformes > 1 ? "s" : "") }
        : { etat: "conforme", court: "Respecté", label: "Schematron officiel respecté" };
    } else {
      // Moteur indisponible ou document qu'aucune règle ne reconnaît : jamais présenté comme un succès.
      schematron = { etat: "non_verifiable", court: "Non évalué", label: "Schematron officiel non évalué" };
    }
  } else if (r._schematronRunning) {
    schematron = { etat: "info", court: "En cours…", label: "Schematron officiel en cours…" };
  }

  // Règles françaises BR-FR : verdict à part, en alerte et non en écart, leur périmètre étant approché.
  let france = null;
  const fr = r.schematron && r.schematron.br_fr;
  if (fr) {
    france = fr.evalue === false
      ? { etat: "non_verifiable", court: "Non évaluées", label: "Règles françaises BR-FR non évaluées" }
      : fr.non_conformes
      ? { etat: "alerte", court: plural(fr.non_conformes, "règle") + " BR-FR", label: plural(fr.non_conformes, "règle") + " française" + (fr.non_conformes > 1 ? "s" : "") + " BR-FR non respectée" + (fr.non_conformes > 1 ? "s" : "") }
      : (fr.non_evaluables || []).length ? { etat: "alerte", court: "BR-FR partiel", label: "Règles françaises BR-FR : évaluation partielle" }
      : fr.ok === true ? { etat: "conforme", court: "BR-FR respectées", label: "Règles françaises BR-FR respectées" }
      : { etat: "non_verifiable", court: "Non évaluées", label: "Règles françaises BR-FR non évaluées" };
  }

  // Schéma XSD : celui du profil Factur-X ou du CII, ou celui d'UBL 2.1.
  let xsd = { etat: "non_verifiable", court: "Non évalué", label: "Schéma XSD non évalué" };
  if (r.xsd && r.xsd.evalue) {
    xsd = r.xsd.ok
      ? { etat: "conforme", court: "Respecté", label: "Schéma XSD respecté" }
      : { etat: "ecart", court: plural(r.xsd.total, "erreur"), label: plural(r.xsd.total, "erreur") + " de schéma XSD" };
  } else if (r.xsd && (r.format === "CII" || r.format === "UBL")) {
    xsd = { etat: "non_verifiable", court: "Non évalué", label: "Schéma XSD non évalué" };
  }

  let conteneur = null;
  if (r.conteneur && r.conteneur.est_pdf) {
    const c = r.conteneur;
    // Ce sont des déclarations lues dans le PDF, pas une validation ISO 19005-3 du fichier.
    // Structure du fichier : quelques exigences de PDF/A-3 réellement contrôlées, pas toutes.
    const flaws = (c.structure_ecarts || 0) + (c.structure_alertes || 0);
    if (c.est_pdfa && c.pdfa_part === 3 && c.piece_jointe_declaree && flaws) {
      conteneur = { etat: c.structure_ecarts ? "ecart" : "alerte", court: plural(flaws, "anomalie") + " PDF",
        label: "PDF/A-3 déclaré, " + plural(flaws, "anomalie") + " de structure" };
    } else if (c.est_pdfa && c.pdfa_part === 3 && c.piece_jointe_declaree) {
      conteneur = { etat: "conforme", court: "PDF/A-3 déclaré", label: c.structure_controles
        ? "PDF/A-3 déclaré, structure sans anomalie relevée" : "PDF/A-3 déclaré, pièce jointe XML déclarée" };
    } else if (!c.piece_jointe_declaree) {
      conteneur = { etat: "alerte", court: "Pièce jointe", label: "Pièce jointe XML non déclarée dans le PDF" };
    } else {
      conteneur = { etat: "alerte", court: "PDF/A-3", label: c.est_pdfa ? (c.pdfa_version || "PDF/A") + " déclaré, PDF/A-3 attendu" : "PDF/A-3 non déclaré dans le PDF" };
    }
  }

  const alertes = checks.filter((c) => c.famille !== "calcul" && (c.etat === "alerte" || c.etat === "ecart")).length + extraAlerts;
  calculs.partiel = calc.some((c) => c.etat === "non_verifiable");
  regles.partiel = (report?.liste || []).some((rule) => rule.etat === "non_verifiable" || rule.etat === "non_evaluee");
  schematron.partiel = !!r.schematron?.non_evaluables?.length;
  if (france) france.partiel = !!fr?.non_evaluables?.length;
  return { lecture: { etat: "conforme", court: "Lue", label: "Lecture réussie" }, calculs, regles, schematron, france, xsd, conteneur, alertes };
}

function incompleteVerdict(v) {
  return !!v && (["non_verifiable", "info"].includes(v.etat) || v.partiel === true);
}

function focusControlSection(id) {
  const section = byId(id);
  if (!section) return;
  for (let node = section; node; node = node.parentElement) {
    if (node.tagName === "DETAILS") node.open = true;
  }
  section.scrollIntoView({ behavior: "smooth", block: "start" });
  section.tabIndex = -1;
  section.focus({ preventScroll: true });
}

function actionSummary(v) {
  const targets = { calculs: "controls", regles: "rules", schematron: "schematron-rules", france: "br-fr-rules", xsd: "xsd-errors", conteneur: "controls" };
  const items = Object.entries(targets).map(([key, target]) => ({ verdict: v[key], target }))
    .filter(({ verdict }) => verdict);
  const issues = items.filter(({ verdict }) => ["ecart", "alerte"].includes(verdict.etat));
  if (v.alertes) issues.push({ verdict: { label: v.alertes + (v.alertes > 1 ? " autres alertes à vérifier" : " autre alerte à vérifier") }, target: "controls" });
  const incomplete = items.filter(({ verdict }) => incompleteVerdict(verdict));
  const panel = Object.assign(document.createElement("section"), { className: "action-summary" });
  panel.setAttribute("aria-label", "Synthèse des vérifications");
  const title = issues.length ? `${issues.length} famille${issues.length > 1 ? "s" : ""} de contrôles à examiner`
    : incomplete.length ? "Vérification à compléter" : "Aucune anomalie relevée par les contrôles exécutés";
  panel.appendChild(Object.assign(document.createElement("strong"), { textContent: title }));
  if (incomplete.length) panel.appendChild(Object.assign(document.createElement("p"), {
    textContent: `${incomplete.length} contrôle${incomplete.length > 1 ? "s incomplets, non évalués" : " incomplet, non évalué"} ou en cours.`,
  }));
  const actions = Object.assign(document.createElement("div"), { className: "action-summary-links" });
  for (const item of [...issues, ...incomplete.filter((item) => !issues.includes(item))]) {
    const button = Object.assign(document.createElement("button"), { type: "button", className: "btn btn-sm", textContent: item.verdict.label });
    button.addEventListener("click", () => focusControlSection(item.target));
    actions.appendChild(button);
  }
  panel.appendChild(actions);
  return panel;
}

/* Bandeau de verdicts en tête de l'onglet Données. */
function verdictStrip(f) {
  const v = invoiceVerdicts(f, duplicateChecks(f).length);
  const strip = document.createElement("div");
  strip.id = "verdicts";
  strip.className = "verdicts";
  strip.appendChild(actionSummary(v));
  const chips = document.createElement("div");
  chips.className = "verdict-chips";
  const chip = (verdict) => {
    if (!verdict) return;
    chips.appendChild(Object.assign(document.createElement("span"), {
      className: "ctl-chip ctl-" + verdict.etat, textContent: verdict.label,
    }));
  };
  chip(v.lecture);
  chip(v.calculs);
  chip(v.regles);
  if (v.schematron) chip(v.schematron);
  if (v.france) chip(v.france);
  if (v.xsd) chip(v.xsd);
  if (v.conteneur) chip(v.conteneur);
  if (v.alertes) chip({ etat: "alerte", label: v.alertes + " alerte" + (v.alertes > 1 ? "s" : "") });
  strip.appendChild(chips);
  strip.appendChild(Object.assign(document.createElement("p"), { className: "verdict-note", textContent: NOT_CHECKED_NOTE }));
  return strip;
}


/* Doublons parmi les documents ouverts : même XML, ou même vendeur et même numéro. */
function duplicateChecks(f) {
  const r = f.result;
  if (!r) return [];
  const number = r.synthese?.numero || summaryValue(r, "N° de facture");
  const seller = r.synthese?.vendeur || summaryValue(r, "Vendeur");
  const exact = [], probable = [];
  for (const g of state.files) {
    if (g === f || g.status !== "ok" || !g.result) continue;
    if (r.doc_hash && g.result.doc_hash === r.doc_hash) exact.push(g.name);
    else if (number && seller && (g.result.synthese?.numero || summaryValue(g.result, "N° de facture")) === number &&
      (g.result.synthese?.vendeur || summaryValue(g.result, "Vendeur")) === seller) probable.push(g.name);
  }
  const out = [];
  if (exact.length) out.push({ regle: "Doublon exact parmi les documents ouverts", etat: "alerte", famille: "historique", detail: "XML identique : " + exact.join(", ") });
  if (probable.length) out.push({ regle: "Doublon probable parmi les documents ouverts", etat: "alerte", famille: "historique", detail: "Même vendeur et même numéro : " + probable.join(", ") });
  return out;
}

