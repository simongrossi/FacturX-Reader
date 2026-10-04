"use strict";

/* Présentation uniquement : ne modifie ni XML ni verdicts des moteurs. */
const ANOMALY_SOURCES = {
  coherence: "Cohérence et historique", native: "Règles EN 16931", schematron: "Schematron officiel",
  france: "Règles françaises BR-FR", xsd: "Schéma XSD", lecture: "Lecture",
};
// Libellés des règles de présence, identiques à ceux de l’implémentation native.
const ANOMALY_TERMS = {
  "BR-01": "Identifiant de spécification (BT-24)", "BR-02": "Numéro de facture (BT-1)",
  "BR-03": "Date d’émission (BT-2)", "BR-04": "Code de type de facture (BT-3)",
  "BR-05": "Code de devise (BT-5)", "BR-06": "Nom du vendeur (BT-27)", "BR-07": "Nom de l’acheteur (BT-44)",
  "BR-08": "Adresse postale du vendeur (BG-5)", "BR-09": "Code pays du vendeur (BT-40)",
  "BR-10": "Adresse postale de l’acheteur (BG-8)", "BR-11": "Code pays de l’acheteur (BT-55)",
  "BR-12": "Somme des montants nets des lignes (BT-106)", "BR-13": "Total hors TVA (BT-109)",
  "BR-14": "Total TVA comprise (BT-112)", "BR-15": "Montant à payer (BT-115)",
};
const anomalyXmlCache = new WeakMap();

/* Résolution limitée aux chemins d'éléments explicites ; aucun XPath libre n'est exécuté.
   Les indices natifs comptent les noms locaux ; les indices Schematron comptent les espaces de noms. */
function resolveAnomalyPath(f, path) {
  if (!path) return null;
  const rows = f.result.rows || [];
  const exact = rows.find(row => row.path === path);
  if (exact) return exact;
  const parts = path.replace(/^\//, "").split("/");
  if (!parts.every(part => /^(?:[\w.-]+:)?[\w.-]+(?:\[\d+\])?$/.test(part))) return null;
  let doc = anomalyXmlCache.get(f.result);
  if (!doc) {
    doc = new DOMParser().parseFromString(f.result.xml_pretty || "", "application/xml");
    if (doc.querySelector("parsererror")) return null;
    anomalyXmlCache.set(f.result, doc);
  }
  let node = doc;
  for (const part of parts) {
    const match = /^(?:([\w.-]+):)?([\w.-]+)(?:\[(\d+)\])?$/.exec(part);
    const candidates = [...node.children].filter(child => child.localName === match[2] &&
      (!match[1] || (child.lookupNamespaceURI(match[1]) != null && child.namespaceURI === child.lookupNamespaceURI(match[1]))));
    if ((!match[3] && candidates.length !== 1) || Number(match[3] || 1) < 1) return null;
    node = candidates[Number(match[3] || 1) - 1];
    if (!node) return null;
  }
  const native = [];
  for (let item = node; item.nodeType === Node.ELEMENT_NODE; item = item.parentNode) {
    const siblings = [...item.parentNode.children].filter(sibling => sibling.localName === item.localName);
    native.unshift(item.localName + (siblings.length > 1 ? "[" + (siblings.indexOf(item) + 1) + "]" : ""));
  }
  return rows.find(row => row.path === native.join("/")) || null;
}

function anomalyAdvice(issue) {
  const title = issue.title.toLowerCase(), detail = issue.detail.toLowerCase();
  if (/iban/.test(title)) return "Confirmer les coordonnées bancaires auprès d’un contact connu du fournisseur avant tout paiement. Demander une facture corrigée si l’IBAN est erroné.";
  if (/doublon/.test(title)) return "Comparer le fournisseur, le numéro et les documents d’origine avant de conserver ou comptabiliser cette facture une seconde fois.";
  if (/prix.*(?:variation|différent)|variation.*prix/.test(title)) return "Comparer le prix unitaire au devis ou à la commande et aux factures précédentes, puis demander confirmation au fournisseur.";
  if (/échéance|échue/.test(title)) return "Vérifier les conditions de paiement et le règlement effectif. Si la date est incorrecte, demander sa correction ; une échéance dépassée ne prouve pas un impayé.";
  if (/siren|siret|n° de tva/.test(title)) return "Confirmer l’identifiant auprès du fournisseur, puis demander la correction de la donnée dans son logiciel de facturation.";
  if (issue.source === "xsd") return "Demander au logiciel émetteur de régénérer un XML conforme au schéma indiqué, puis vérifier à nouveau la facture. Consulter le message technique pour identifier l’élément ou le format en cause.";
  if (issue.family === "calcul" || /^BR-CO-(?:1[0-7])$/.test(issue.rule)) return "Recalculer les montants à partir des lignes, remises, frais et taux de TVA, en vérifiant les arrondis. Demander au fournisseur une facture corrigée si l’écart est confirmé.";
  if (issue.source === "france") return "Vérifier que cette opération entre dans le périmètre des règles françaises BR-FR, puis faire corriger la mention signalée si la règle s’applique.";
  if (/absent|manquant|ni .* ni /.test(detail) || /^BR-(?:0[1-9]|1[0-6])$/.test(issue.rule)) return "Compléter la donnée requise dans le logiciel émetteur, puis régénérer la facture et son XML. Vérifier l’énoncé de la règle pour connaître la mention concernée.";
  if (/non numérique|numeric|decimal|format/.test(detail)) return "Vérifier le format de la valeur dans le XML, puis demander sa correction dans le logiciel émetteur et régénérer la facture.";
  if (issue.family === "conteneur" || /pdf|pièce jointe|police|chiffrement/.test(title)) return "Demander au logiciel émetteur de régénérer le PDF Factur-X avec son XML et ses métadonnées. Les contrôles de structure ne couvrent pas toute la conformité PDF/A-3.";
  return "Vérifier la donnée et l’énoncé du contrôle avec le fournisseur ; demander une facture corrigée si l’anomalie est confirmée, puis relancer la vérification.";
}

function invoiceAnomalies(f) {
  const r = f.result, issues = [], incomplete = [];
  function add(source, entry) {
    const resolved = resolveAnomalyPath(f, entry.path);
    const leaf = resolved && !(r.rows || []).some(row => row.path.startsWith(resolved.path + "/"));
    const values = /Attendu (-?\d+(?:\.\d+)?), constaté (-?\d+(?:\.\d+)?)\./.exec(entry.detail || "");
    const issue = {
      source, severity: entry.severity || "ecart", rule: entry.rule || "", title: entry.title || "Contrôle à examiner",
      detail: entry.detail || "", family: entry.family || "", location: entry.path || "", path: resolved?.path || "",
      found: entry.found ?? values?.[2] ?? (leaf && !resolved.binary && !resolved.truncated ? resolved.value : null),
      expected: entry.expected ?? values?.[1] ?? null, gap: entry.gap || "", target: entry.target || "controls",
    };
    if (issue.found === "") issue.found = null;
    if (issue.expected === "") issue.expected = null;
    issue.action = anomalyAdvice(issue);
    issues.push(issue);
  }
  for (const c of [...duplicateChecks(f), ...(r.controles || [])]) {
    if (["ecart", "alerte"].includes(c.etat)) add("coherence", { severity: c.etat, title: c.regle, detail: c.detail, family: c.famille, path: c.path, found: c.constate || undefined, expected: c.attendu || undefined, gap: c.ecart });
    else if (c.etat === "non_verifiable") incomplete.push(c.regle + " : " + (c.detail || "données insuffisantes"));
  }
  for (const rule of r.regles?.liste || []) {
    if (rule.etat === "non_conforme") add("native", { rule: rule.id, title: rule.libelle, detail: rule.detail, path: rule.path, found: rule.constate, expected: rule.attendu, target: "rules" });
    else if (["non_verifiable", "non_evaluee"].includes(rule.etat)) incomplete.push(rule.id + " : règle native non évaluée");
  }
  for (const [source, report, target] of [["schematron", r.schematron, "schematron-rules"], ["france", r.schematron?.br_fr, "br-fr-rules"]]) {
    if (!report) continue;
    for (const error of report.erreurs || []) {
      const native = (r.regles?.liste || []).find(rule => rule.id === error.id);
      add(source, { severity: source === "france" || error.flag === "warning" ? "alerte" : "ecart", rule: error.id,
        title: native?.libelle || ANOMALY_TERMS[error.id] || (source === "france" ? "Mention française à vérifier" : "Règle officielle non respectée"), detail: error.texte,
        path: error.location, target });
    }
    if (report.erreur_moteur || report.evalue === false) incomplete.push(ANOMALY_SOURCES[source] + " : " + (report.erreur_moteur || "non évalué"));
    for (const id of report.non_evaluables || []) incomplete.push(ANOMALY_SOURCES[source] + " : " + id + " non évaluable");
  }
  if (r.xsd?.evalue && !r.xsd.ok) {
    for (const error of r.xsd.erreurs || []) add("xsd", { title: "Structure ou format du XML à corriger", detail: (error.ligne ? "Ligne " + error.ligne + (error.colonne ? ", colonne " + error.colonne : "") + (r.xsd.lignes_origine ? " du XML d’origine" : " du XML affiché") + " : " : "") + error.message,
      path: "", expected: "XML conforme au schéma " + (r.xsd.schema || "annoncé"), target: "xsd-errors" });
    if (r.xsd.total > (r.xsd.erreurs || []).length) incomplete.push("XSD : " + r.xsd.total + " erreurs, seules les " + (r.xsd.erreurs || []).length + " premières sont détaillées.");
  } else if (r.xsd && !r.xsd.evalue) incomplete.push("XSD : " + (r.xsd.raison || "non évalué"));
  for (const message of r.warnings || []) add("lecture", { severity: "alerte", title: "Avertissement de lecture", detail: message });
  if (r._schematronRunning || (!r.schematron && ["CII", "UBL"].includes(r.format))) incomplete.push("Schematron officiel : évaluation en cours.");
  const verdicts = invoiceVerdicts(f);
  for (const key of ["calculs", "regles", "xsd"]) if (incompleteVerdict(verdicts[key])) incomplete.push(verdicts[key].label + (verdicts[key].partiel ? " : contrôle partiel" : ""));
  if (!r.synthese) incomplete.push("Structure de facture non reconnue : données à examiner dans le XML.");
  return { issues, incomplete: [...new Set(incomplete)] };
}

function anomalyRequest(f, issues) {
  return "Bonjour,\n\nPouvez-vous vérifier les points suivants concernant la facture " + (f.result.synthese?.numero || f.name) + " (" + f.name + ") et, si nécessaire, nous transmettre une facture corrigée ?\n\n" +
    issues.map((issue, i) => [
      (i + 1) + ". " + issue.title + (issue.rule ? " [" + issue.rule + "]" : ""),
      "Contrôle : " + ANOMALY_SOURCES[issue.source],
      issue.detail && "Détail : " + issue.detail,
      issue.found != null && "Valeur trouvée : " + issue.found,
      issue.expected != null && "Valeur attendue : " + issue.expected,
      issue.location && "Emplacement : " + issue.location,
      "À vérifier : " + issue.action,
    ].filter(Boolean).join("\n")).join("\n\n") + "\n\nMerci.";
}

function openAnomalyLocation(f, issue) {
  if (state.selected !== f.id) selectFile(f.id);
  if (issue.path) {
    setTab("xml");
    byId("xml-search").value = "";
    filterXmlTable("");
    gotoXml(issue.path);
  } else { setTab("data"); focusControlSection(issue.target); }
}

function anomalyCenter(f) {
  const data = invoiceAnomalies(f);
  const view = f.anomalyView ||= { query: "", severity: "all", source: "all", limit: 50 };
  const panel = Object.assign(document.createElement("details"), { id: "anomaly-center", className: "section anomaly-center", open: view.open ?? (data.issues.length > 0 || data.incomplete.length > 0) });
  panel.addEventListener("toggle", () => { view.open = panel.open; });
  const heading = document.createElement("summary"); heading.className = "section-head";
  heading.textContent = "Centre d’anomalies — " + data.issues.length + " point" + (data.issues.length > 1 ? "s" : "") + " à examiner" + (data.incomplete.length ? " · vérification à compléter" : "");
  panel.appendChild(heading);
  const body = Object.assign(document.createElement("div"), { className: "anomaly-body" });
  const note = document.createElement("p"); note.className = "verdict-note";
  note.textContent = "Les aides guident la vérification. Les règles françaises BR-FR demandent de confirmer leur périmètre. Une même donnée peut être signalée par plusieurs moteurs. Le XML reste inchangé.";
  body.appendChild(note);
  const toolbar = Object.assign(document.createElement("div"), { className: "anomaly-toolbar" });
  const query = Object.assign(document.createElement("input"), { id: "anomaly-search", type: "search", placeholder: "Rechercher une règle, une valeur…", value: view.query });
  query.setAttribute("aria-label", "Rechercher dans les anomalies");
  const severity = Object.assign(document.createElement("select"), { id: "anomaly-severity" }); severity.setAttribute("aria-label", "Gravité des anomalies");
  for (const [key, label] of [["all", "Tous les niveaux"], ["ecart", "Écarts"], ["alerte", "Alertes"]]) severity.add(new Option(label, key));
  severity.value = view.severity;
  const source = Object.assign(document.createElement("select"), { id: "anomaly-source" }); source.setAttribute("aria-label", "Source des anomalies");
  source.add(new Option("Tous les contrôles", "all"));
  for (const [key, label] of Object.entries(ANOMALY_SOURCES)) source.add(new Option(label, key));
  source.value = view.source;
  const copy = Object.assign(document.createElement("button"), { id: "anomaly-copy-all", type: "button", className: "btn btn-sm" });
  toolbar.append(query, severity, source, copy); body.appendChild(toolbar);
  const status = Object.assign(document.createElement("p"), { id: "anomaly-count", className: "verdict-note" }); status.setAttribute("aria-live", "polite");
  body.appendChild(status);
  const list = Object.assign(document.createElement("div"), { id: "anomaly-list" }); body.appendChild(list);
  const filtered = () => data.issues.filter(issue => (view.severity === "all" || issue.severity === view.severity) &&
    (view.source === "all" || issue.source === view.source) && [issue.title, issue.rule, issue.detail, issue.found, issue.expected, issue.location, issue.action].join(" ").toLowerCase().includes(view.query.toLowerCase()));
  async function copyIssues(issues, btn) {
    try { await copyText(anomalyRequest(f, issues), btn); }
    catch (error) { workspaceNotice("Copie impossible : " + (error?.message || error)); }
  }
  copy.addEventListener("click", () => copyIssues(filtered(), copy));
  function render() {
    const issues = filtered();
    list.replaceChildren();
    status.textContent = issues.length + " / " + data.issues.length + " points" + (issues.length > view.limit ? " ; " + view.limit + " affichés" : "");
    copy.disabled = !issues.length; copy.textContent = "Copier la demande (" + issues.length + ")";
    if (!issues.length) list.appendChild(Object.assign(document.createElement("p"), { className: "notice", textContent: data.issues.length ? "Aucune anomalie ne correspond aux filtres." : data.incomplete.length ? "Aucune anomalie détaillée disponible. La vérification reste à compléter." : "Aucune anomalie relevée par les contrôles exécutés." }));
    for (const issue of issues.slice(0, view.limit)) {
      const card = Object.assign(document.createElement("article"), { className: "anomaly-card" });
      card.dataset.source = issue.source; card.dataset.rule = issue.rule;
      const head = Object.assign(document.createElement("h3"), { textContent: issue.title });
      card.appendChild(Object.assign(document.createElement("span"), { className: "ctl-chip ctl-" + issue.severity, textContent: issue.severity === "ecart" ? "Écart" : "Alerte" }));
      card.appendChild(head);
      card.appendChild(Object.assign(document.createElement("p"), { className: "verdict-note", textContent: ANOMALY_SOURCES[issue.source] + (issue.rule ? " · " + issue.rule : "") }));
      if (issue.detail) card.appendChild(Object.assign(document.createElement("p"), { className: "anomaly-detail", textContent: issue.detail }));
      const values = Object.assign(document.createElement("dl"), { className: "anomaly-values" });
      for (const [label, value] of [["Valeur trouvée", issue.found], ["Valeur attendue", issue.expected]]) {
        values.append(Object.assign(document.createElement("dt"), { textContent: label }), Object.assign(document.createElement("dd"), { textContent: value == null ? "Non fournie par ce contrôle" : String(value) }));
      }
      if (issue.gap) values.append(Object.assign(document.createElement("dt"), { textContent: "Écart" }), Object.assign(document.createElement("dd"), { textContent: issue.gap }));
      card.appendChild(values);
      card.appendChild(Object.assign(document.createElement("p"), { className: "anomaly-action", textContent: "Action conseillée : " + issue.action }));
      if (issue.location) card.appendChild(Object.assign(document.createElement("p"), { className: "anomaly-location", textContent: "Emplacement : " + issue.location }));
      const actions = Object.assign(document.createElement("div"), { className: "anomaly-toolbar" });
      const location = Object.assign(document.createElement("button"), { type: "button", className: "btn btn-sm", textContent: issue.path ? "Voir le champ dans le XML" : "Voir le contrôle" });
      location.addEventListener("click", () => openAnomalyLocation(f, issue));
      const proofKey = /^Net à payer/.test(issue.title) ? "a_payer" : /^Total TTC/.test(issue.title) ? "ttc" :
        /^Total TVA/.test(issue.title) ? "tva" : /^Total HT/.test(issue.title) ? "ht" : "";
      if (issue.family === "calcul" && proofKey && f.result.synthese?.provenance?.[proofKey]) {
        const provenance = Object.assign(document.createElement("button"), { type: "button", className: "btn btn-sm", textContent: "Voir la provenance des montants" });
        provenance.addEventListener("click", () => {
          setTab("data");
          const card = byId("tab-data").querySelector('[data-provenance="' + proofKey + '"]');
          if (card) { card.querySelector(".provenance-details").open = true; card.scrollIntoView({ behavior: "smooth", block: "center" }); }
        });
        actions.appendChild(provenance);
      }
      const request = Object.assign(document.createElement("button"), { type: "button", className: "btn btn-sm", textContent: "Copier la demande de vérification" });
      request.addEventListener("click", () => copyIssues([issue], request));
      actions.append(location, request); card.appendChild(actions); list.appendChild(card);
    }
    if (issues.length > view.limit) {
      const more = Object.assign(document.createElement("button"), { type: "button", className: "btn btn-sm", textContent: "Afficher davantage" });
      more.addEventListener("click", () => { view.limit += 50; render(); }); list.appendChild(more);
    }
  }
  query.addEventListener("input", () => { view.query = query.value; view.limit = 50; render(); });
  severity.addEventListener("change", () => { view.severity = severity.value; view.limit = 50; render(); });
  source.addEventListener("change", () => { view.source = source.value; view.limit = 50; render(); });
  render();
  if (data.incomplete.length) {
    const missing = Object.assign(document.createElement("details"), { className: "anomaly-incomplete", open: !data.issues.length });
    missing.appendChild(Object.assign(document.createElement("summary"), { textContent: "Vérification à compléter (" + data.incomplete.length + ")" }));
    const ul = document.createElement("ul");
    for (const message of data.incomplete) ul.appendChild(Object.assign(document.createElement("li"), { textContent: message }));
    missing.appendChild(ul); body.appendChild(missing);
  }
  panel.appendChild(body); return panel;
}

function refreshAnomalyCenter(f) {
  const old = byId("anomaly-center");
  if (!old) return;
  const active = old.contains(document.activeElement) ? document.activeElement.id : "";
  const selection = active === "anomaly-search" ? [document.activeElement.selectionStart, document.activeElement.selectionEnd] : null;
  old.replaceWith(anomalyCenter(f));
  if (active && byId(active)) { byId(active).focus({ preventScroll: true }); if (selection) byId(active).setSelectionRange(...selection); }
}
