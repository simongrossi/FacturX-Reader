"use strict";

const WATCH_KEY = "fx-watch-folder";
const WATCH_INTERVAL_MS = 4000;
let watchFolder = { folder: "", seen: {}, active: false };
let watchTimer = null;
let watchBusy = false;
let watchImporting = false;
let watchCancel = false;
const watchPending = new Map();

function watchSignature(file) { return String(file.size) + ":" + file.modified; }
function watchSave() {
  try { localStorage.setItem(WATCH_KEY, JSON.stringify(watchFolder)); }
  catch { watchMessage("Surveillance active, mais son état ne peut pas être enregistré sur cet appareil."); }
}
function watchMessage(message) { byId("watch-folder-status").textContent = message; }
function watchRender() {
  byId("watch-folder-path").textContent = watchFolder.folder || "Aucun dossier choisi.";
  byId("watch-folder-choose").disabled = watchBusy;
  const toggle = byId("watch-folder-toggle");
  toggle.hidden = !watchFolder.folder;
  toggle.textContent = watchFolder.active ? "Mettre en pause" : "Reprendre";
  toggle.disabled = watchImporting;
  byId("watch-folder-cancel").hidden = !watchImporting;
  byId("watch-folder-progress").hidden = !watchImporting;
}
function watchPause(message = "Surveillance en pause.") {
  watchFolder.active = false;
  watchCancel = true;
  clearInterval(watchTimer);
  watchTimer = null;
  watchSave();
  watchRender();
  watchMessage(message);
}
function watchStart() {
  if (!watchFolder.folder) return;
  watchFolder.active = true;
  watchCancel = false;
  watchSave();
  watchRender();
  watchMessage("Surveillance active. Recherche de nouvelles factures…");
  clearInterval(watchTimer);
  watchTimer = setInterval(watchPoll, WATCH_INTERVAL_MS);
  watchPoll();
}
async function watchPoll() {
  if (!watchFolder.active || watchBusy) return;
  watchBusy = true;
  watchRender();
  try {
    const snapshot = await api.scanWatchFolder(watchFolder.folder);
    if (!watchFolder.active) return;
    if (snapshot.truncated) {
      watchPause("Plus de " + snapshot.max + " fichiers dans ce dossier : choisissez un sous-dossier pour une surveillance complète.");
      return;
    }
    const files = snapshot.files || [];
    const candidates = [];
    const present = new Set();
    for (const file of files) {
      present.add(file.path);
      const signature = watchSignature(file);
      if (watchFolder.seen[file.path] === signature) { watchPending.delete(file.path); continue; }
      if (watchPending.get(file.path) === signature) candidates.push({ file, signature });
      else watchPending.set(file.path, signature);
    }
    for (const path of watchPending.keys()) if (!present.has(path)) watchPending.delete(path);
    if (!candidates.length) {
      watchMessage("Surveillance active · " + files.length + " fichier(s) observé(s).");
      return;
    }
    const fresh = candidates.filter(({ file }) => !state.files.some(entry => entry.source?.path === file.path));
    for (const { file, signature } of candidates) {
      if (fresh.some(item => item.file.path === file.path)) continue;
      watchFolder.seen[file.path] = signature;
      watchPending.delete(file.path);
    }
    watchSave();
    if (!fresh.length) { watchMessage("Nouveautés déjà ouvertes dans la session."); return; }
    if (fresh.length > 500 - state.files.length) {
      watchPause("Session limitée à 500 documents : fermez des onglets puis reprenez la surveillance.");
      return;
    }
    watchImporting = true;
    watchRender();
    const progress = byId("watch-folder-progress");
    progress.max = fresh.length;
    progress.value = 0;
    const sources = fresh.map(({ file }) => ({
      name: file.path.split(/[\\/]/).pop(),
      source: { key: file.path, path: file.path, name: file.path.split(/[\\/]/).pop() },
      load: () => api.parsePath(file.path),
    }));
    const result = await addSources(sources, {
      shouldCancel: () => watchCancel,
      onProgress: (done, total) => {
        progress.value = done;
        watchMessage("Import du dossier : " + done + " / " + total + " fichier(s).");
        if (done > 0) {
          const { file, signature } = fresh[done - 1];
          watchFolder.seen[file.path] = signature;
          watchPending.delete(file.path);
          watchSave();
        }
      },
    });
    watchMessage(result.cancelled ? "Import interrompu après " + result.processed + " fichier(s)." :
      result.processed + " nouvelle(s) facture(s) examinée(s).");
  } catch (error) {
    watchMessage("Surveillance impossible : " + (error?.message || error));
  } finally {
    watchImporting = false;
    watchBusy = false;
    watchRender();
  }
}
function wireWatchFolder() {
  try {
    const saved = JSON.parse(localStorage.getItem(WATCH_KEY) || "null");
    if (saved && typeof saved.folder === "string" && saved.seen && typeof saved.seen === "object") {
      watchFolder = { folder: saved.folder, seen: saved.seen, active: saved.active === true };
    }
  } catch { /* stockage indisponible : surveillance inactive */ }
  watchRender();
  byId("watch-folder-choose").addEventListener("click", async () => {
    try {
      const snapshot = await api.pickWatchFolder();
      if (!snapshot) return;
      if (snapshot.truncated) {
        watchMessage("Plus de " + snapshot.max + " fichiers : choisissez un sous-dossier.");
        return;
      }
      watchFolder = { folder: snapshot.folder, seen: Object.fromEntries((snapshot.files || []).map(file => [file.path, watchSignature(file)])), active: false };
      watchPending.clear();
      watchStart();
      watchMessage("Surveillance active. " + (snapshot.files || []).length + " fichier(s) déjà présent(s) ignoré(s).");
    } catch (error) { watchMessage("Choix du dossier impossible : " + (error?.message || error)); }
  });
  byId("watch-folder-toggle").addEventListener("click", () => watchFolder.active ? watchPause() : watchStart());
  byId("watch-folder-cancel").addEventListener("click", () => watchPause("Arrêt demandé ; le fichier en cours se termine avant l’interruption."));
}
function resumeWatchFolder() { if (watchFolder.active) watchStart(); }
