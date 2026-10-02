/* Métadonnées légères en localStorage ; copies des dépôts en IndexedDB. */
let workspaceReady = false;
let workspaceHasSession = false;
let workspaceRestoring = false;
let workspaceSaveTimer;
let workspaceScrollTarget = null;
const WORKSPACE_CACHE_LIMIT = 256 * 1024 * 1024;
let workspaceCacheQueue = Promise.resolve();
let workspacePruneTimer;
const workspaceWarnings = new Set();
function validSource(source) {
  return source && typeof source.key === "string" && typeof source.name === "string" &&
    (!source.path || typeof source.path === "string");
}
function workspaceRead(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const value = JSON.parse(raw);
    const valid = key === "fx-recent" ? Array.isArray(value) && value.every(validSource) :
      value && Array.isArray(value.files) && value.files.every(item => validSource(item?.source));
    if (!valid) throw new Error("Format invalide");
    return value;
  } catch {
    if (!workspaceWarnings.has(key)) {
      workspaceWarnings.add(key);
      workspaceNotice("Historique ou session illisible : ouvrez vos documents pour démarrer une nouvelle session.");
    }
    return fallback;
  }
}
function workspaceNotice(message) {
  byId("workspace-message-text").textContent = message;
  byId("workspace-message").hidden = false;
}
function dismissWorkspaceNotice() {
  byId("workspace-message").hidden = true;
  byId("workspace-message-text").textContent = "";
}
async function workspaceBlob(action, key, blob) {
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open("facturx-workspace", 1);
    let expired = false;
    const fail = error => { expired = true; clearTimeout(timeout); reject(error); };
    const timeout = setTimeout(() => fail(new Error("Stockage local indisponible.")), 3000);
    req.onupgradeneeded = () => req.result.createObjectStore("sources");
    req.onsuccess = () => { clearTimeout(timeout); if (expired) req.result.close(); else resolve(req.result); };
    req.onerror = () => fail(req.error);
    req.onblocked = () => fail(new Error("Stockage local bloqué par une autre fenêtre."));
  });
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("sources", action === "get" || action === "list" ? "readonly" : "readwrite");
      const store = tx.objectStore("sources");
      let result;
      if (action === "list" || action === "prune") {
        result = [];
        const req = store.openCursor();
        req.onsuccess = () => {
          const cursor = req.result;
          if (!cursor) return;
          if (action === "prune" && !key.has(cursor.key)) cursor.delete();
          else result.push({ key: cursor.key, size: cursor.value.size || 0 });
          cursor.continue();
        };
      } else {
        const req = action === "put" ? store.put(blob, key) : store.get(key);
        req.onsuccess = () => { result = req.result; };
      }
      tx.oncomplete = () => resolve(result);
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}
function workspaceCacheTask(task) {
  const result = workspaceCacheQueue.then(task);
  workspaceCacheQueue = result.catch(() => {});
  return result;
}
function workspaceRetainedKeys() {
  return new Set([
    ...state.files.map(f => f.source),
    ...workspaceRead("fx-recent", []),
    ...workspaceRead("fx-workspace", { files: [] }).files.map(item => item.source),
  ].filter(Boolean).map(source => source.key));
}
function pruneWorkspaceCache() {
  return workspaceCacheTask(() => workspaceBlob("prune", workspaceRetainedKeys()));
}
function storeWorkspaceBlob(key, blob) {
  return workspaceCacheTask(async () => {
    const stored = await workspaceBlob("prune", workspaceRetainedKeys());
    const size = stored.filter(item => item.key !== key).reduce((sum, item) => sum + item.size, 0);
    if (size + blob.size > WORKSPACE_CACHE_LIMIT) throw new Error("Limite de cache atteinte (256 Mo).");
    await workspaceBlob("put", key, blob);
  });
}
async function updateWorkspaceCacheInfo() {
  try {
    const stored = await workspaceBlob("list");
    byId("workspace-cache-info").textContent = `${stored.length} copie(s) locale(s) · ${fmtSize(stored.reduce((sum, item) => sum + item.size, 0))} / 256 Mo`;
  } catch { byId("workspace-cache-info").textContent = "Stockage local indisponible."; }
}
async function clearWorkspaceHistory() {
  try {
    localStorage.removeItem("fx-recent");
    renderWelcome();
    await pruneWorkspaceCache();
    await updateWorkspaceCacheInfo();
    workspaceNotice("Historique effacé. Les copies nécessaires aux documents ouverts et à la dernière session sont conservées.");
  } catch { workspaceNotice("L’historique ou le cache n’a pas pu être nettoyé."); }
}
function captureDocumentView() {
  const f = getFile(state.selected);
  if (!f || workspaceRestoring || workspaceScrollTarget || byId("file-view").hidden) return;
  f.view = { ...f.view, tab: state.tab, zoom: state.zoom, fit: state.fit,
    dualScroll: state.tab === "dual" ? { pdf: byId("tab-pdf").scrollTop, data: byId("tab-data").scrollTop } : f.view?.dualScroll,
    scroll: { ...f.view?.scroll, [state.tab]: document.querySelector(".main").scrollTop },
    linesQuery: f.linesQuery, sort: f.sort };
}
function restoreDocumentScroll(f) {
  const tab = state.tab;
  if (tab === "dual" && (!f.rendered.pdf || !f.rendered.data)) return;
  requestAnimationFrame(() => {
    if (state.selected === f.id && state.tab === tab) {
      if (tab === "dual") {
        byId("tab-pdf").scrollTop = f.view?.dualScroll?.pdf || 0;
        byId("tab-data").scrollTop = f.view?.dualScroll?.data || 0;
      }
      document.querySelector(".main").scrollTop = f.view?.scroll?.[tab] || 0;
      workspaceScrollTarget = null;
    }
  });
}
function saveWorkspace() {
  if (!workspaceReady || workspaceRestoring || !workspaceHasSession) return;
  try {
    localStorage.setItem("fx-workspace", JSON.stringify({
      files: state.files.filter(f => f.source).map(f => ({ source: f.source, view: f.view || {} })),
      selected: getFile(state.selected)?.source?.key || null,
      batch: !!state.batch && !state.selected,
    }));
  } catch { workspaceNotice("La session n’a pas pu être enregistrée sur cet appareil."); }
}
function rememberRecent(f) {
  if (!f.source) return;
  const recent = workspaceRead("fx-recent", []).filter(s => s.key !== f.source.key);
  recent.unshift(f.source);
  try { localStorage.setItem("fx-recent", JSON.stringify(recent.slice(0, 12))); }
  catch { workspaceNotice("L’historique des documents n’a pas pu être enregistré."); }
  renderWelcome();
  clearTimeout(workspacePruneTimer);
  workspacePruneTimer = setTimeout(() => {
    pruneWorkspaceCache().catch(() => workspaceNotice("Le nettoyage des copies locales n’a pas pu être effectué."));
  }, 500);
}
async function openWorkspaceSources(items) {
  const sources = [];
  for (const item of items) {
    const source = item.source;
    const existing = state.files.find(f => f.source?.key === source.key);
    if (existing) { selectFile(existing.id); continue; }
    sources.push({ name: source.name, source, view: item.view,
      load: async () => {
        if (source.path) return api.parsePath(source.path);
        const blob = await workspaceBlob("get", source.key);
        if (!blob) throw new Error("Copie locale indisponible. Ouvrez à nouveau le fichier d’origine.");
        return api.parse(new File([blob], source.name));
      },
    });
  }
  await addSources(sources);
}
async function resumeWorkspace() {
  if (workspaceRestoring) return;
  const saved = workspaceRead("fx-workspace", { files: [] });
  workspaceRestoring = true;
  byId("welcome-resume").disabled = true;
  try {
    await openWorkspaceSources(saved.files || []);
    const selected = state.files.find(f => f.source?.key === saved.selected);
    if (selected) selectFile(selected.id);
    else if (saved.batch && state.files.length) showBatch();
    else if (!saved.selected) showWorkspaceHome();
    const failed = state.files.filter(f => f.status === "error");
    if (failed.length) workspaceNotice(`${failed.length} document(s) n’ont pas pu être rouverts. Leurs onglets indiquent l’erreur ; les autres restent disponibles.`);
  } catch (error) { workspaceNotice("Reprise impossible : " + error); }
  // Les enregistrements sont suspendus pendant la reprise : enregistrer l'état final,
  // y compris un document ajouté entre-temps.
  finally { workspaceRestoring = false; workspaceReady = true; saveWorkspace(); renderWelcome(); }
}
function showWorkspaceHome() {
  captureDocumentView();
  state.selected = null;
  state.batch = false;
  state.library = false;
  workspaceScrollTarget = null;
  state.renderToken++;
  state.pdfDoc = null; state.pdfSource = null;
  renderList(); renderFileView(); renderWelcome();
}
function renderDocumentTabs() {
  const nav = byId("document-tabs");
  nav.replaceChildren();
  // Accueil et Tableau restent visibles quand les onglets de documents défilent.
  const fixed = document.createElement("div");
  fixed.className = "document-tabs-fixed";
  nav.appendChild(fixed);
  const home = document.createElement("button");
  const libraryShown = state.library && !state.selected;
  const batchShown = !libraryShown && state.batch && !state.selected && state.files.length > 0;
  const homeShown = !state.selected && !batchShown && !libraryShown;
  home.className = "document-tab" + (homeShown ? " selected" : "");
  home.textContent = "Accueil";
  home.setAttribute("aria-pressed", String(homeShown));
  home.onclick = showWorkspaceHome;
  fixed.appendChild(home);
  if (state.files.length) {
    const table = document.createElement("button");
    table.id = "tab-batch";
    table.className = "document-tab document-tab-batch" + (batchShown ? " selected" : "");
    table.textContent = "Tableau";
    table.title = "Tableau de toutes les factures ouvertes";
    table.setAttribute("aria-pressed", String(batchShown));
    table.onclick = showBatch;
    fixed.appendChild(table);
  }
  const shelf = document.createElement("button");
  shelf.id = "tab-library";
  shelf.className = "document-tab document-tab-batch" + (libraryShown ? " selected" : "");
  shelf.textContent = "Bibliothèque";
  shelf.title = "Toutes les factures déjà ouvertes, entre les sessions";
  shelf.setAttribute("aria-pressed", String(libraryShown));
  shelf.onclick = showLibrary;
  fixed.appendChild(shelf);
  for (const f of state.files) {
    const group = document.createElement("div");
    group.className = "document-tab-group" + (state.selected === f.id ? " selected" : "");
    group.dataset.fileId = f.id;
    const tab = document.createElement("button");
    tab.className = "document-tab";
    tab.textContent = (f.status === "error" ? "⚠ " : f.status === "loading" ? "… " : "") + f.name;
    tab.title = f.error || f.source?.path || f.name;
    tab.setAttribute("aria-pressed", String(state.selected === f.id));
    tab.onclick = () => selectFile(f.id);
    const close = document.createElement("button");
    close.className = "document-close"; close.textContent = "×";
    close.setAttribute("aria-label", "Fermer " + f.name);
    close.onclick = () => removeFile(f.id);
    group.onauxclick = e => { if (e.button === 1) { e.preventDefault(); removeFile(f.id); } };
    group.append(tab, close); nav.appendChild(group);
  }
  nav.style.scrollPaddingLeft = fixed.offsetWidth + "px";
  nav.querySelector(".document-tab-group.selected")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  byId("btn-doc-list").hidden = !state.files.length;
  if (!state.files.length) hideDocumentPicker();
}
/* Liste filtrable sous la barre d'onglets : documents ouverts ou documents récents. */
function hideDocumentPicker() {
  document.querySelector(".doc-picker")?.remove();
  byId("btn-doc-list").setAttribute("aria-expanded", "false");
}
function showPicker(placeholder, entries, start = 0) {
  hideDocumentPicker();
  hideContextMenu();
  hidePopover();
  const picker = document.createElement("div");
  picker.className = "doc-picker";
  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = placeholder;
  input.setAttribute("aria-label", placeholder);
  const list = document.createElement("div");
  list.className = "doc-picker-list";
  list.setAttribute("role", "listbox");
  picker.append(input, list);
  let active = Math.max(0, start);
  const mark = () => {
    const items = [...list.querySelectorAll(".doc-picker-item")];
    active = Math.max(0, Math.min(active, items.length - 1));
    items.forEach((item, i) => item.setAttribute("aria-selected", String(i === active)));
    items[active]?.scrollIntoView({ block: "nearest" });
  };
  const fill = () => {
    const query = input.value.trim().toLowerCase();
    const shown = entries.filter(entry => (entry.label + " " + entry.detail).toLowerCase().includes(query));
    list.replaceChildren();
    for (const entry of shown) {
      const item = document.createElement("div");
      item.className = "doc-picker-item" + (entry.current ? " current" : "");
      item.setAttribute("role", "option");
      const name = document.createElement("span");
      name.textContent = entry.label;
      const detail = document.createElement("small");
      detail.textContent = entry.detail;
      item.title = entry.detail || entry.label;
      item.append(name, detail);
      item.onclick = () => { hideDocumentPicker(); entry.run(); };
      list.appendChild(item);
    }
    if (!shown.length) list.appendChild(Object.assign(document.createElement("div"), { className: "doc-picker-empty", textContent: "Aucun document ne correspond." }));
    mark();
  };
  input.oninput = () => { active = 0; fill(); };
  input.onkeydown = e => {
    if (e.key === "Escape") { e.stopPropagation(); hideDocumentPicker(); }
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const count = list.querySelectorAll(".doc-picker-item").length;
      if (count) { active = (active + (e.key === "ArrowDown" ? 1 : -1) + count) % count; mark(); }
    } else if (e.key === "Enter") {
      e.preventDefault();
      list.querySelector('.doc-picker-item[aria-selected="true"]')?.click();
    }
  };
  document.body.appendChild(picker);
  picker.style.top = document.querySelector(".tabbar").getBoundingClientRect().bottom + 4 + "px";
  fill();
  input.focus();
}
function showDocumentPicker() {
  if (!state.files.length) return;
  showPicker("Sélectionnez une facture à ouvrir", state.files.map(f => ({
    label: (f.status === "error" ? "⚠ " : f.status === "loading" ? "… " : "") + f.name,
    detail: f.error || f.source?.path || "",
    current: state.selected === f.id,
    run: () => selectFile(f.id),
  })), state.files.findIndex(f => f.id === state.selected));
  byId("btn-doc-list").setAttribute("aria-expanded", "true");
}
function openRecent(source) {
  openWorkspaceSources([{ source }]).catch(e => workspaceNotice(String(e)));
}
function recentFolder(source) {
  return source.path ? source.path.replace(/[\\/][^\\/]*$/, "") : "Copie locale";
}
function showRecentPicker() {
  showPicker("Sélectionnez un document récent à ouvrir", workspaceRead("fx-recent", []).map(source => ({
    label: source.name, detail: recentFolder(source), run: () => openRecent(source),
  })));
}
function forgetRecent(source) {
  try { localStorage.setItem("fx-recent", JSON.stringify(workspaceRead("fx-recent", []).filter(s => s.key !== source.key))); }
  catch { workspaceNotice("L’historique des documents n’a pas pu être enregistré."); }
  renderWelcome();
}
const WELCOME_RECENT = 5;
function renderWelcome() {
  const list = byId("recent-files"); list.replaceChildren();
  const recent = workspaceRead("fx-recent", []);
  if (!recent.length) list.textContent = "Vos dernières factures apparaîtront ici.";
  for (const source of recent.slice(0, WELCOME_RECENT)) {
    const row = document.createElement("div"); row.className = "recent-row";
    const button = document.createElement("button"); button.className = "recent-file";
    const name = document.createElement("span"); name.textContent = source.name;
    const detail = document.createElement("small"); detail.textContent = recentFolder(source);
    button.title = source.path || "Copie locale du document importé";
    button.append(name, detail);
    button.onclick = () => openRecent(source);
    const remove = document.createElement("button"); remove.className = "recent-remove"; remove.textContent = "×";
    remove.title = "Retirer des documents récents";
    remove.setAttribute("aria-label", "Retirer " + source.name + " des documents récents");
    remove.onclick = () => forgetRecent(source);
    row.append(button, remove);
    list.appendChild(row);
  }
  if (recent.length > WELCOME_RECENT) {
    const more = document.createElement("button"); more.className = "recent-more"; more.textContent = "Plus…";
    more.title = "Tous les documents récents";
    more.onclick = showRecentPicker;
    list.appendChild(more);
  }
  byId("welcome-resume").disabled = workspaceRestoring || !workspaceRead("fx-workspace", { files: [] }).files?.length;
}
function wireWorkspace() {
  byId("workspace-message-close").onclick = dismissWorkspaceNotice;
  byId("workspace-clear-history").onclick = clearWorkspaceHistory;
  byId("workspace-clean-cache").onclick = async () => {
    try { await pruneWorkspaceCache(); await updateWorkspaceCacheInfo(); }
    catch { workspaceNotice("Le cache n’a pas pu être nettoyé."); }
  };
  byId("btn-settings").addEventListener("click", updateWorkspaceCacheInfo);
  byId("welcome-open").onclick = () => byId("add-files").click();
  byId("welcome-folder").onclick = openFolder;
  byId("welcome-settings").onclick = () => byId("btn-settings").click();
  byId("welcome-resume").onclick = resumeWorkspace;
  renderWelcome();
  document.querySelector(".main").addEventListener("scroll", () => {
    clearTimeout(workspaceSaveTimer);
    workspaceSaveTimer = setTimeout(() => { captureDocumentView(); saveWorkspace(); }, 250);
  });
  window.addEventListener("pagehide", () => { captureDocumentView(); saveWorkspace(); });
  byId("btn-doc-list").onclick = () => (document.querySelector(".doc-picker") ? hideDocumentPicker() : showDocumentPicker());
  document.addEventListener("click", e => { if (!e.target.closest(".doc-picker, #btn-doc-list, .menubar-drop, .recent-more")) hideDocumentPicker(); });
  window.addEventListener("blur", hideDocumentPicker);
  // La molette fait défiler les onglets, la barre n'ayant pas d'ascenseur.
  byId("document-tabs").addEventListener("wheel", e => {
    const nav = e.currentTarget;
    if (!e.deltaY || e.shiftKey || nav.scrollWidth <= nav.clientWidth) return;
    e.preventDefault();
    nav.scrollLeft += e.deltaY;
  }, { passive: false });
  document.addEventListener("keydown", e => {
    if (!(e.ctrlKey || e.metaKey) || document.querySelector("dialog[open]")) return;
    if (e.key.toLowerCase() === "e" && state.files.length) { e.preventDefault(); showDocumentPicker(); }
    if (e.key.toLowerCase() === "w" && state.selected) { e.preventDefault(); removeFile(state.selected); }
    if (e.key === "Tab" && state.files.length) {
      e.preventDefault();
      const index = state.files.findIndex(f => f.id === state.selected);
      selectFile(state.files[(index + (e.shiftKey ? -1 : 1) + state.files.length) % state.files.length].id);
    }
  });
}
