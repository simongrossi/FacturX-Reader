"use strict";

/* Barre de menus (Fichier, Édition, Affichage, Aide). Les entrées reprennent les
   actions existantes ; les listes déroulantes partagent le style et la navigation
   clavier du menu contextuel (menu.js). */

function menubarDoc() {
  const f = getFile(state.selected);
  return f && f.status === "ok" ? f : null;
}

function menubarStep(delta) {
  if (!state.files.length) return;
  const index = state.files.findIndex((f) => f.id === state.selected);
  selectFile(state.files[(index + delta + state.files.length) % state.files.length].id);
}

const MENUBAR = [
  { label: "Fichier", items: [
    { label: "Ouvrir des fichiers…", keys: "Ctrl+O", run: () => byId("file-input").click() },
    { label: "Ouvrir un dossier…", keys: "Ctrl+Maj+O", run: () => openFolder() },
    { label: "Reprendre la dernière session", run: () => resumeWorkspace(), on: () => !byId("welcome-resume").disabled },
    null,
    { label: "Enregistrer le PDF…", run: () => byId("btn-download-pdf").click(),
      on: () => !!menubarDoc() && !byId("btn-download-pdf").disabled },
    { label: "Exporter les lignes en CSV…", run: () => exportLinesCsv(menubarDoc(), document.createElement("button")),
      on: () => !!menubarDoc()?.result.lines?.length },
    { label: "Exporter le rapport de contrôle (JSON)…", run: () => exportControlReport(menubarDoc(), document.createElement("button")),
      on: () => !!menubarDoc()?.result.controles?.length },
    { label: "Exporter le tableau des factures en CSV…", run: () => byId("batch-export").click(), on: () => state.files.length > 0 },
    { label: "Imprimer…", keys: "Ctrl+P", run: () => printView(), on: () => !!menubarDoc() || state.library || (state.batch && state.files.length > 0) },
    null,
    { label: "Fermer le document", keys: "Ctrl+W", run: () => removeFile(state.selected), on: () => !!state.selected },
    { label: "Fermer tous les documents", run: () => clearAllFiles(), on: () => state.files.length > 0 },
    null,
    { label: "Paramètres…", keys: "Ctrl+,", run: () => byId("btn-settings").click() },
  ] },
  { label: "Édition", items: [
    { label: "Rechercher…", keys: "Ctrl+F", run: () => showQuickSearch() },
    null,
    { label: "Copier les lignes affichées", run: () => { clipboardWrite(linesTsv(menubarDoc())); toast("Lignes copiées"); },
      on: () => !!menubarDoc()?.result.lines?.length },
    { label: "Copier le tableau des factures", run: () => { byId("batch-copy").click(); toast("Tableau copié"); },
      on: () => state.files.length > 0 },
  ] },
  { label: "Affichage", items: [
    { label: "Accueil", run: () => showWorkspaceHome(), checked: () => !state.selected && !state.batch && !state.library },
    { label: "Tableau des factures", run: () => showBatch(), on: () => state.files.length > 0,
      checked: () => !state.selected && state.batch && state.files.length > 0 },
    { label: "Bibliothèque", run: () => showLibrary(), checked: () => !state.selected && state.library },
    null,
    ...[["pdf", "PDF"], ["data", "Données"], ["dual", "PDF et données"], ["xml", "XML complet"], ["raw", "XML brut"]].map(([tab, label]) => (
      { label, run: () => setTab(tab), checked: () => !!menubarDoc() && state.tab === tab,
        on: () => !!menubarDoc() && (tab !== "dual" || !!(menubarDoc().result.pdf || menubarDoc().result.xml_pdf)) })),
    null,
    { label: "Document suivant", keys: "Ctrl+Tab", run: () => menubarStep(1), on: () => state.files.length > 0 },
    { label: "Document précédent", keys: "Ctrl+Maj+Tab", run: () => menubarStep(-1), on: () => state.files.length > 0 },
    { label: "Liste des documents ouverts…", keys: "Ctrl+E", run: () => showDocumentPicker(), on: () => state.files.length > 0 },
    null,
    { label: "Panneau des fichiers", run: () => toggleSidebar(), checked: () => !byId("sidebar").classList.contains("collapsed") },
  ] },
  { label: "Aide", items: [
    { label: "À propos de Factur-X Reader", run: () => byId("btn-settings").click() },
    { label: "Licences des composants tiers", run: () => showLicenses() },
  ] },
];

function openMenubar(button, menu) {
  hideContextMenu();
  hidePopover();
  button.setAttribute("aria-expanded", "true");
  const drop = document.createElement("div");
  drop.className = "ctx-menu menubar-drop";
  drop.setAttribute("role", "menu");
  for (const entry of menu.items) {
    if (!entry) { drop.appendChild(document.createElement("hr")); continue; }
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("role", "menuitem");
    b.disabled = entry.on ? !entry.on() : false;
    const checked = entry.checked ? entry.checked() : false;
    if (entry.checked) b.setAttribute("aria-checked", String(checked));
    b.appendChild(Object.assign(document.createElement("span"), { textContent: (checked ? "✓ " : "") + entry.label }));
    if (entry.keys) b.appendChild(Object.assign(document.createElement("kbd"), { textContent: entry.keys }));
    b.addEventListener("click", () => { hideContextMenu(); entry.run(); });
    drop.appendChild(b);
  }
  document.body.appendChild(drop);
  const r = button.getBoundingClientRect();
  drop.style.left = Math.max(4, Math.min(r.left, window.innerWidth - drop.offsetWidth - 4)) + "px";
  drop.style.top = r.bottom + 2 + "px";
}

function wireMenubar() {
  const bar = byId("menubar");
  for (const menu of MENUBAR) {
    const button = Object.assign(document.createElement("button"), { type: "button", textContent: menu.label });
    button.setAttribute("aria-haspopup", "menu");
    button.setAttribute("aria-expanded", "false");
    button.addEventListener("click", (e) => {
      // Le clic ne doit pas atteindre le gestionnaire global qui referme les menus.
      e.stopPropagation();
      if (button.getAttribute("aria-expanded") === "true") hideContextMenu();
      else openMenubar(button, menu);
    });
    // Menu déjà ouvert : le survol d'un autre titre bascule dessus.
    button.addEventListener("mouseenter", () => {
      if (bar.querySelector('[aria-expanded="true"]') && button.getAttribute("aria-expanded") !== "true")
        openMenubar(button, menu);
    });
    bar.appendChild(button);
  }
}

/* Licences des composants embarqués : leurs textes font partie de l'application installée. */
const THIRD_PARTY_LICENSES = [
  { title: "Règles de validation EN 16931 (© Union européenne), licence EUPL 1.2", file: "schematron/NOTICE-EINVOICING.txt" },
  { title: "Texte de la licence EUPL 1.2", file: "schematron/LICENSE-EUPL-1.2.txt" },
  { title: "Règles du profil français EXTENDED-CTC-FR (FNFE-MPE, dépôt France_RFE), licence Apache 2.0", file: "schematron/NOTICE-FRANCE.txt" },
  { title: "Règles et schémas XSD Factur-X (© FNFE-MPE | FeRD, Apache 2.0), schémas UBL 2.1 (© OASIS) et validateur XSD uppsala (BSD-2-Clause)", file: "schematron/NOTICE-XSD.txt" },
];

async function showLicenses() {
  const dialog = byId("licenses-dialog");
  const body = byId("licenses-body");
  body.querySelectorAll(".license-block").forEach((el) => el.remove());
  for (const item of THIRD_PARTY_LICENSES) {
    let text;
    try {
      const response = await fetch(item.file);
      if (!response.ok) continue;
      text = await response.text();
    } catch { continue; }
    const block = document.createElement("section");
    block.className = "license-block";
    block.appendChild(Object.assign(document.createElement("h3"), { textContent: item.title }));
    block.appendChild(Object.assign(document.createElement("pre"), { textContent: text.trim() }));
    body.appendChild(block);
  }
  if (!dialog.open) dialog.showModal();
}

document.addEventListener("DOMContentLoaded", () => {
  byId("licenses-close").addEventListener("click", () => byId("licenses-dialog").close());
});
