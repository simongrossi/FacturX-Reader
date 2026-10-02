/* Métadonnées légères en localStorage ; copies des dépôts en IndexedDB. */
let workspaceReady = false;
let workspaceHasSession = false;
let workspaceRestoring = false;
let workspaceSaveTimer;
function workspaceRead(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch { return fallback; }
}
function workspaceNotice(message) {
  byId("workspace-message").textContent = message;
  byId("workspace-message").hidden = false;
}
async function workspaceBlob(action, key, blob) {
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open("facturx-workspace", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("sources");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("sources", action === "get" ? "readonly" : "readwrite");
      const store = tx.objectStore("sources");
      const req = action === "put" ? store.put(blob, key) : store.get(key);
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}
function captureDocumentView() {
  const f = getFile(state.selected);
  if (!f || byId("file-view").hidden) return;
  f.view = { ...f.view, tab: state.tab, zoom: state.zoom, fit: state.fit,
    scroll: { ...f.view?.scroll, [state.tab]: document.querySelector(".main").scrollTop },
    linesQuery: f.linesQuery, sort: f.sort };
}
function restoreDocumentScroll(f) {
  requestAnimationFrame(() => {
    if (state.selected === f.id) document.querySelector(".main").scrollTop = f.view?.scroll?.[state.tab] || 0;
  });
}
function saveWorkspace() {
  if (!workspaceReady || workspaceRestoring || !workspaceHasSession) return;
  try {
    localStorage.setItem("fx-workspace", JSON.stringify({
      files: state.files.filter(f => f.source).map(f => ({ source: f.source, view: f.view || {} })),
      selected: getFile(state.selected)?.source?.key || null,
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
    else if (!saved.selected) showWorkspaceHome();
    const failed = state.files.filter(f => f.status === "error");
    if (failed.length) workspaceNotice(`${failed.length} document(s) n’ont pas pu être rouverts. Leurs onglets indiquent l’erreur ; les autres restent disponibles.`);
  } catch (error) { workspaceNotice("Reprise impossible : " + error); }
  finally { workspaceRestoring = false; workspaceReady = true; renderWelcome(); }
}
function showWorkspaceHome() {
  captureDocumentView();
  state.selected = null;
  state.renderToken++;
  state.pdfDoc = null; state.pdfSource = null;
  renderList(); renderFileView(); renderWelcome();
}
function renderDocumentTabs() {
  const nav = byId("document-tabs");
  nav.replaceChildren();
  const home = document.createElement("button");
  home.className = "document-tab" + (!state.selected ? " selected" : "");
  home.textContent = "Accueil";
  home.setAttribute("aria-pressed", String(!state.selected));
  home.onclick = showWorkspaceHome;
  nav.appendChild(home);
  for (const f of state.files) {
    const group = document.createElement("div");
    group.className = "document-tab-group" + (state.selected === f.id ? " selected" : "");
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
  nav.querySelector(".selected")?.scrollIntoView({ block: "nearest", inline: "nearest" });
}
function renderWelcome() {
  const list = byId("recent-files"); list.replaceChildren();
  const recent = workspaceRead("fx-recent", []);
  if (!recent.length) list.textContent = "Vos dernières factures apparaîtront ici.";
  for (const source of recent) {
    const button = document.createElement("button"); button.className = "welcome-action recent-file";
    const name = document.createElement("span"); name.textContent = source.name;
    const detail = document.createElement("small"); detail.textContent = source.path || "Copie locale du document importé";
    button.title = detail.textContent;
    button.append(name, detail);
    button.onclick = () => openWorkspaceSources([{ source }]).catch(e => workspaceNotice(String(e)));
    list.appendChild(button);
  }
  byId("welcome-resume").disabled = workspaceRestoring || !workspaceRead("fx-workspace", { files: [] }).files?.length;
}
function wireWorkspace() {
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
  document.addEventListener("keydown", e => {
    if (!(e.ctrlKey || e.metaKey) || document.querySelector("dialog[open]")) return;
    if (e.key.toLowerCase() === "w" && state.selected) { e.preventDefault(); removeFile(state.selected); }
    if (e.key === "Tab" && state.files.length) {
      e.preventDefault();
      const index = state.files.findIndex(f => f.id === state.selected);
      selectFile(state.files[(index + (e.shiftKey ? -1 : 1) + state.files.length) % state.files.length].id);
    }
  });
}
