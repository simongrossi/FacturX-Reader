"use strict";

/* Menu contextuel (clic droit) sur les cellules des tableaux : copie de la cellule,
   de la ligne, de la colonne ou du tableau, en plusieurs formats. */

function toast(message) {
  document.querySelector(".toast")?.remove();
  const div = Object.assign(document.createElement("div"), { className: "toast", textContent: message });
  div.setAttribute("role", "status");
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 1400);
}

async function clipboardWrite(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
}

/* Valeur d'une cellule : la valeur brute du XML quand elle est connue, sinon le texte affiché. */
function menuCellText(td) {
  if (td.dataset.value !== undefined) return td.dataset.value;
  const text = td.innerText.trim().replace(/\s*\n\s*/g, " — ");
  return text === "—" ? "" : text;
}

function menuIsDataCell(td) {
  return !td.classList.contains("col-point") && !td.classList.contains("col-detail");
}

/* Lignes de données affichées du tableau (filtres appliqués, détails dépliés exclus). */
function menuTableRows(table) {
  return [...table.tBodies].flatMap((body) => [...body.rows])
    .filter((tr) => !tr.classList.contains("line-detail-row") && tr.getClientRects().length);
}

function menuRowValues(tr) {
  return [...tr.cells].filter(menuIsDataCell).map(menuCellText);
}

function menuHeaders(table, tr) {
  const head = table.tHead ? [...table.tHead.rows[0].cells] : [];
  return [...tr.cells].map((td, i) => ({ td, i })).filter(({ td }) => menuIsDataCell(td))
    .map(({ i }) => (head[i]?.textContent || "").replace(/\s*[↑↓]\s*$/, "").trim() || "Colonne " + (i + 1));
}

const MENU_FORMATS = {
  tsv: (headers, rows) => [headers, ...rows].filter(Boolean)
    .map((row) => row.map((v) => v.replace(/[\t\r\n]+/g, " ")).join("\t")).join("\n"),
  csv: (headers, rows) => [headers, ...rows].filter(Boolean)
    .map((row) => row.map(csvCell).join(";")).join("\r\n"),
  json: (headers, rows, single) => {
    const objects = rows.map((row) => Object.fromEntries(row.map((v, i) => [headers[i], v])));
    return JSON.stringify(single ? objects[0] : objects, null, 2);
  },
  markdown: (headers, rows) => {
    const line = (row) => "| " + row.map((v) => v.replace(/\|/g, "\\|").replace(/\s*[\r\n]+\s*/g, " ")).join(" | ") + " |";
    return [line(headers), line(headers.map(() => "---")), ...rows.map(line)].join("\n");
  },
};

function hideContextMenu() {
  document.querySelector(".ctx-menu")?.remove();
  document.querySelectorAll('.menubar [aria-expanded="true"]').forEach((b) => b.setAttribute("aria-expanded", "false"));
}

function showContextMenu(event, td) {
  hideContextMenu();
  hidePopover();
  const tr = td.parentElement;
  const table = td.closest("table");
  const headers = menuHeaders(table, tr);
  const row = menuRowValues(tr);
  const rows = () => menuTableRows(table).map(menuRowValues);
  const value = menuCellText(td);
  const path = td.dataset.path || tr.dataset.path || "";
  const selection = String(window.getSelection() || "").trim();
  const column = [...tr.cells].filter(menuIsDataCell).indexOf(td);

  const menu = document.createElement("div");
  menu.className = "ctx-menu";
  menu.setAttribute("role", "menu");
  const copy = (text, message) => { clipboardWrite(text); toast(message); };
  const item = (label, action, parent = menu) => {
    const b = Object.assign(document.createElement("button"), { type: "button", textContent: label });
    b.setAttribute("role", "menuitem");
    b.addEventListener("click", () => { hideContextMenu(); action(); });
    parent.appendChild(b);
  };
  const separator = () => menu.appendChild(document.createElement("hr"));
  const formats = (label, what, build) => {
    const group = Object.assign(document.createElement("div"), { className: "ctx-formats" });
    group.appendChild(Object.assign(document.createElement("span"), { textContent: label }));
    for (const [key, name] of [["csv", "CSV"], ["json", "JSON"], ["markdown", "Markdown"]])
      item(name, () => copy(build(key), what), group);
    menu.appendChild(group);
  };

  if (selection) item("Copier la sélection", () => copy(selection, "Sélection copiée"));
  if (menuIsDataCell(td)) item("Copier la cellule", () => copy(value, "Cellule copiée"));
  item("Copier la ligne", () => copy(MENU_FORMATS.tsv(null, [row]), "Ligne copiée"));
  item("Copier la ligne avec les en-têtes", () => copy(MENU_FORMATS.tsv(headers, [row]), "Ligne copiée"));
  if (column >= 0) item("Copier la colonne « " + headers[column] + " »",
    () => copy(rows().map((r) => r[column] ?? "").join("\n"), "Colonne copiée"));
  item("Copier le tableau", () => copy(MENU_FORMATS.tsv(headers, rows()), "Tableau copié"));
  separator();
  formats("Copier la ligne en", "Ligne copiée", (key) => MENU_FORMATS[key](headers, [row], true));
  formats("Copier le tableau en", "Tableau copié", (key) => MENU_FORMATS[key](headers, rows(), false));
  if (path || value) separator();
  if (path) {
    item("Copier le chemin XML", () => copy(path, "Chemin copié"));
    if (getFile(state.selected)) item("Voir dans le XML", () => gotoXml(path));
  }
  if (value && value.length <= 200) item("Rechercher cette valeur", () => {
    const input = byId("quick-query");
    byId("quick-regex").checked = false;
    if (!state.selected) byId("quick-scope").value = "all";
    showQuickSearch();
    input.value = value;
    scheduleQuickSearch();
  });

  document.body.appendChild(menu);
  const x = Math.max(8, Math.min(event.clientX, window.innerWidth - menu.offsetWidth - 8));
  const y = Math.max(8, Math.min(event.clientY, window.innerHeight - menu.offsetHeight - 8));
  menu.style.left = x + "px";
  menu.style.top = y + "px";
  menu.querySelector("button").focus({ preventScroll: true });
}

/* Document cliqué dans la barre d'onglets ou la liste des fichiers. */
function showDocumentMenu(event, f) {
  hideContextMenu();
  hidePopover();
  const menu = document.createElement("div");
  menu.className = "ctx-menu";
  menu.setAttribute("role", "menu");
  const item = (label, action, enabled = true) => {
    const b = Object.assign(document.createElement("button"), { type: "button", textContent: label, disabled: !enabled });
    b.setAttribute("role", "menuitem");
    b.addEventListener("click", () => { hideContextMenu(); action(); });
    menu.appendChild(b);
  };
  const others = state.files.filter((g) => g !== f);
  const closeAll = (files) => { for (const g of files) removeFile(g.id); };
  item("Ouvrir", () => selectFile(f.id));
  item("Fermer", () => removeFile(f.id));
  item("Fermer les autres", () => closeAll(others), others.length > 0);
  item("Fermer les documents en erreur", () => closeAll(state.files.filter((g) => g.status === "error")),
    state.files.some((g) => g.status === "error"));
  menu.appendChild(document.createElement("hr"));
  item("Copier le nom du fichier", () => { clipboardWrite(f.name); toast("Nom copié"); });
  item("Copier le chemin du fichier", () => { clipboardWrite(f.source.path); toast("Chemin copié"); }, !!f.source?.path);
  document.body.appendChild(menu);
  menu.style.left = Math.max(8, Math.min(event.clientX, window.innerWidth - menu.offsetWidth - 8)) + "px";
  menu.style.top = Math.max(8, Math.min(event.clientY, window.innerHeight - menu.offsetHeight - 8)) + "px";
  menu.querySelector("button").focus({ preventScroll: true });
}

function wireContextMenu() {
  document.addEventListener("contextmenu", (e) => {
    if (e.target.closest(".ctx-menu")) { e.preventDefault(); return; }
    const doc = e.target.closest("[data-file-id]");
    if (doc && getFile(doc.dataset.fileId)) { e.preventDefault(); showDocumentMenu(e, getFile(doc.dataset.fileId)); return; }
    // Les champs de saisie gardent le menu natif (couper, copier, coller).
    const td = e.target.closest(".main td");
    if (!td || e.target.closest("input, textarea, select")) { hideContextMenu(); return; }
    e.preventDefault();
    showContextMenu(e, td);
  });
  document.addEventListener("click", (e) => { if (!e.target.closest(".ctx-menu")) hideContextMenu(); });
  document.addEventListener("keydown", (e) => {
    const menu = document.querySelector(".ctx-menu");
    if (!menu) return;
    if (e.key === "Escape") { hideContextMenu(); return; }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const buttons = [...menu.querySelectorAll("button:not(:disabled)")];
    const next = buttons.indexOf(document.activeElement) + (e.key === "ArrowDown" ? 1 : -1);
    buttons[(next + buttons.length) % buttons.length].focus();
  });
  window.addEventListener("blur", hideContextMenu);
  document.querySelector(".main").addEventListener("scroll", hideContextMenu);
}
