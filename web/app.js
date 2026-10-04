"use strict";

const $ = (s) => document.querySelector(s);
const byId = (id) => document.getElementById(id);

const state = {
  files: [],        // {id, name, status, error, result, rendered: {}}
  selected: null,   // id du fichier sélectionné
  tab: "pdf",
  zoom: 1.25,
  pdfDoc: null,
  pdfSource: null,   // "pdf" | "xmlpdf" | null — source affichée dans le pane PDF partagé
  renderToken: 0,
  pdfSearchPages: [],
  pdfSearchMatches: [],
  pdfSearchIndex: -1,
  fit: false,        // PDF ajusté à la largeur à l'ouverture
  batch: false,      // tableau multi-factures affiché (aucun document sélectionné)
  library: false,    // bibliothèque affichée (aucun document sélectionné)
};
let fileSeq = 0;

/* ---------------- utilitaires ---------------- */

function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function b64toBytes(b64) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

function fmtSize(n) {
  if (n == null) return "";
  if (n > 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + " Mo";
  if (n > 1024) return Math.round(n / 1024) + " Ko";
  return n + " o";
}

async function copyText(t, btn) {
  const old = btn.textContent;
  await clipboardWrite(t);
  btn.textContent = "Copié";
  setTimeout(() => { btn.textContent = old; }, 1200);
}

/* ---------------- backend (commandes Rust) ---------------- */

const invoke = window.__TAURI__.core.invoke;

const api = {
  async parse(file, selection) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    return parseArchiveChoice((choice) => invoke("parse_file", bytes, {
      headers: { "x-filename": encodeURIComponent(file.name), "x-library": settings.library === "off" ? "0" : "1",
        ...(choice ? { "x-archive-selection": JSON.stringify(choice) } : {}) },
    }), selection);
  },
  parsePath: (path, selection) => parseArchiveChoice((choice) => invoke("parse_path", { path, selection: choice || null, library: settings.library !== "off" }), selection),
  libraryStatus: () => invoke("library_status"),
  librarySearch: (query, filters) => invoke("library_search", { query, filters }),
  libraryOpen: (hash) => parseArchiveChoice((selection) => invoke("library_open", { hash, remember: settings.library !== "off", selection: selection || null })),
  async libraryRelink(hash) {
    let path = null;
    return parseArchiveChoice(async (selection) => {
      const result = await invoke("library_relink", { hash, path, selection: selection || null });
      if (result?.replacement_path) path = result.replacement_path;
      return result;
    });
  },
  libraryRemove: (hash) => invoke("library_remove", { hash }),
  libraryClear: () => invoke("library_clear"),
  libraryReset: () => invoke("library_reset"),
  libraryPrices: (hash, reference, name) => invoke("library_prices", { hash, reference, name }),
  pickFolder: () => invoke("pick_folder"),
  pickWatchFolder: () => invoke("pick_watch_folder"),
  scanWatchFolder: (folder) => invoke("scan_watch_folder", { folder }),
  startupPaths: () => invoke("startup_paths"),
  getPointage: (hash) => invoke("get_pointage", { hash }),
  setPointage: (hash, lines, filename) => invoke("set_pointage", { hash, lines, filename }),
  clearPointage: (hash) => invoke("clear_pointage", { hash }),
  appInfo: () => invoke("app_info"),
  getReviews: () => invoke("get_reviews"),
  setReview: (key, review, filename) => invoke("set_review", { key, review, filename }),
  dataStatus: () => invoke("data_status"),
  restoreBackup: (which) => invoke("restore_backup", { which }),
  exportData: () => invoke("export_data"),
  importData: () => invoke("import_data"),
  savePdf: (pdfObj) => invoke("save_pdf", {
    filename: pdfObj.filename || "facture.pdf",
    base64: pdfObj.base64,
  }),
  saveBinary: (filename, base64) => invoke("save_binary", { filename, base64 }),
  saveText: (filename, content) => invoke("save_text", { filename, content }),
  saveReport: (filename, report) => invoke("save_control_report", { filename, report }),
  print: () => invoke("print_window"),
};

/* ---------------- chargement / analyse des fichiers ---------------- */

function newFileEntry(name, status, result) {
  return {
    id: "f" + (++fileSeq),
    name: name,
    status: status,
    error: null,
    result: result,
    rendered: {},
    pointed: new Set(),      // indices de lignes pointees (persistees)
    _openDetails: new Set(), // indices de lignes dont le detail est ouvert (session)
    sort: { key: null, dir: 1 },
    linesQuery: "",
  };
}

/* Charge une liste de sources {name, load()} l'une après l'autre. */
async function addSources(sources, options = {}) {
  const remaining = Math.max(0, 500 - state.files.length);
  if (sources.length > remaining) {
    workspaceNotice("La session est limitée à 500 documents. Fermez des onglets avant d’en ajouter d’autres.");
    sources = sources.slice(0, remaining);
  }
  if (!sources.length) return { processed: 0, cancelled: false };
  workspaceHasSession = true;
  const entries = sources.map((src) => {
    const entry = newFileEntry(src.name, "loading", null);
    entry.source = src.source || { key: crypto.randomUUID(), name: src.name };
    entry.view = src.view || {};
    state.files.push(entry);
    return entry;
  });
  renderList();
  let processed = 0;
  options.onProgress?.(0, sources.length);
  for (let i = 0; i < sources.length; i++) {
    if (options.shouldCancel?.()) break;
    const entry = entries[i];
    try {
      if (sources[i].blob) {
        try { await storeWorkspaceBlob(entry.source.key, sources[i].blob); }
        catch (error) { workspaceNotice("Copie locale non enregistrée : " + (error.message || error) + " Ce document devra être rouvert manuellement."); }
      }
      entry.result = await sources[i].load();
      if (entry.result.archive_selection) {
        entry.source.selection = entry.result.archive_selection;
        if (entry.source.path) entry.source.key = entry.source.path + "#archive:" + JSON.stringify(entry.source.selection);
      }
      entry.status = "ok";
      if (entry.result && (entry.result.format === "CII" || entry.result.format === "UBL")) {
        triggerSchematronValidation(entry);
      }
      libraryNotice(entry.result && entry.result.bibliotheque_erreur);
      rememberRecent(entry);
    } catch (e) {
      entry.status = "error";
      entry.error = String((e && e.message) || e);
    }
    processed++;
    options.onProgress?.(processed, sources.length, entry);
    if (state.batch && !state.selected) refreshBatchProgress();
    if (i % 10 === 9 || i === sources.length - 1) {
      renderList();
      if (state.batch && !state.selected) renderBatch();
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
  }
  if (processed < entries.length) {
    const pending = new Set(entries.slice(processed));
    state.files = state.files.filter(entry => !pending.has(entry));
    renderList();
  }
  const lastOk = entries.slice(0, processed).reverse().find((x) => x.status === "ok");
  if (!state.batch && processed > 0) {
    if (lastOk) selectFile(lastOk.id);
    else if (state.files.length) selectFile(state.files[0].id);
  }
  return { processed, cancelled: processed < entries.length };
}

/* Fichiers choisis ou déposés dans la fenêtre (objets File). */
function addFiles(fileList) {
  const files = [...fileList].filter((f) => f && f.size > 0);
  return addSources(files.map((f) => ({ name: f.name, blob: f, load: () => api.parse(f) })));
}

/* Fichiers désignés par leur chemin sur le disque (dossier ouvert, ligne de commande). */
function addPaths(listing) {
  if (!listing || !listing.files) return Promise.resolve();
  if (listing.truncated)
    alert("Ce dossier contient plus de " + listing.max + " fichiers : seuls les " + listing.max + " premiers sont chargés.");
  else if (listing.folder && !listing.files.length)
    alert("Aucun fichier .pdf, .xml ou .zip dans ce dossier.");
  return addSources(listing.files.map((p) => ({
    name: p.split(/[\\/]/).pop(),
    source: { key: p, path: p, name: p.split(/[\\/]/).pop() },
    load: () => api.parsePath(p),
  })));
}

async function openFolder() {
  try {
    await addPaths(await api.pickFolder());
  } catch (e) {
    alert("Ouverture du dossier impossible : " + e);
  }
}

/* ---- dépôt de dossiers : parcours récursif des entrées déposées ---- */

const INVOICE_EXT = /\.(pdf|xml|zip)$/i;

function readAllEntries(reader) {
  return new Promise((resolve) => {
    const all = [];
    const next = () => reader.readEntries((batch) => {
      if (!batch.length) return resolve(all);
      all.push(...batch);
      next();
    }, () => resolve(all));
    next();
  });
}

async function filesFromEntry(entry, insideFolder, out) {
  if (entry.isFile) {
    // dans un dossier, seuls les fichiers factures sont retenus
    if (insideFolder && !INVOICE_EXT.test(entry.name)) return;
    const file = await new Promise((resolve) => entry.file(resolve, () => resolve(null)));
    if (file) out.push(file);
  } else if (entry.isDirectory && !entry.name.startsWith(".")) {
    const children = await readAllEntries(entry.createReader());
    children.sort((a, b) => a.name.localeCompare(b.name));
    for (const child of children) await filesFromEntry(child, true, out);
  }
}

async function addDropped(dataTransfer) {
  // les entrées doivent être lues de façon synchrone pendant l'événement drop
  const entries = [...(dataTransfer.items || [])]
    .map((it) => (it.webkitGetAsEntry ? it.webkitGetAsEntry() : null))
    .filter(Boolean);
  if (!entries.some((e) => e.isDirectory)) return addFiles(dataTransfer.files);
  const files = [];
  for (const entry of entries) await filesFromEntry(entry, false, files);
  return addFiles(files);
}

/* ---------------- liste des fichiers ---------------- */

function fmtBadge(result) {
  if (!result) return "";
  const b = [];
  b.push('<span class="badge accent">' + esc(result.format) + "</span>");
  if (result.lines && result.lines.length)
    b.push('<span class="badge">' + result.lines.length + " lignes</span>");
  if (result.pdf) b.push('<span class="badge ok">PDF ' + esc(fmtSize(result.pdf.size)) + "</span>");
  else b.push('<span class="badge warn">sans PDF</span>');
  if (result.rows) b.push('<span class="badge">' + result.rows.length + " valeurs XML</span>");
  const gaps = (result.controles || []).filter((c) => c.famille === "calcul" && c.etat === "ecart").length;
  if (gaps) b.push('<span class="badge err">' + gaps + " écart" + (gaps > 1 ? "s" : "") + " de calcul</span>");
  const broken = (result.regles && result.regles.non_conformes) || 0;
  if (broken) b.push('<span class="badge warn">' + broken + " règle" + (broken > 1 ? "s" : "") + " EN 16931</span>");
  return b.join(" ");
}

/* Barre de recherche : repliée par défaut, ouverte par la loupe, Ctrl+F ou le menu Édition. */
function showQuickSearch() {
  byId("quick-search").hidden = false;
  byId("btn-search").setAttribute("aria-pressed", "true");
  byId("quick-query").focus();
  byId("quick-query").select();
}
function hideQuickSearch() {
  byId("quick-query").value = "";
  scheduleQuickSearch();
  byId("quick-search").hidden = true;
  byId("btn-search").setAttribute("aria-pressed", "false");
}

function renderList(preserveSearch = false) {
  // L'en-tête (logo, boutons d'ouverture) laisse la place aux documents dès qu'il y en a.
  document.body.classList.toggle("has-documents", state.files.length > 0);
  renderDocumentTabs();
  saveWorkspace();
  if (!preserveSearch) scheduleQuickSearch();
  const ul = byId("file-list");
  ul.innerHTML = "";
  for (const f of state.files) {
    const li = document.createElement("li");
    li.className = "file-item" + (f.id === state.selected ? " selected" : "");
    li.dataset.fileId = f.id;
    li.innerHTML =
      '<div class="fi-name">' + esc(f.name) + "</div>" +
      (f.status === "error"
        ? '<div class="fi-error">Erreur : ' + esc(f.error) + "</div>"
        : '<div class="fi-meta">' + fmtBadge(f.result) + "</div>") +
      '<button type="button" class="fi-del" title="Retirer ce fichier" aria-label="Retirer ce fichier">✕</button>';
    li.addEventListener("click", () => selectFile(f.id));
    li.querySelector(".fi-del").addEventListener("click", (e) => {
      e.stopPropagation();
      removeFile(f.id);
    });
    ul.appendChild(li);
  }
}

function removeFile(id) {
  captureDocumentView();
  const idx = state.files.findIndex((x) => x.id === id);
  if (idx === -1) return;
  state.files.splice(idx, 1);
  if (state.selected === id) {
    const next = state.files[Math.min(idx, state.files.length - 1)];
    state.selected = next ? next.id : null;
    state.tab = "pdf";
    state.pdfDoc = null;
    state.pdfSource = null;
  }
  renderList();
  renderFileView();
}

function clearAllFiles() {
  if (!state.files.length) return;
  if (!confirm("Vider tous les fichiers de la session ?\n(Les pointages déjà sauvegardés ne seront pas supprimés.)")) return;
  state.files = [];
  state.selected = null;
  state.tab = "pdf";
  state.pdfDoc = null;
  state.pdfSource = null;
  renderList();
  renderFileView();
}

function toggleSidebar() {
  const sb = byId("sidebar");
  const folded = sb.classList.toggle("collapsed");
  const btn = byId("btn-fold");
  btn.textContent = folded ? "›" : "‹";
  btn.title = folded ? "Déplier le panneau" : "Replier le panneau";
  btn.setAttribute("aria-label", folded ? "Déplier le panneau" : "Replier le panneau");
  try { localStorage.setItem("fx-sidebar", folded ? "1" : "0"); } catch (e) {}
  requestAnimationFrame(() => syncStickyOffsets());
}

/* ---------------- sélection / affichage ---------------- */

function getFile(id) {
  return state.files.find((f) => f.id === id);
}

/* Schematron officiel : les validations sont faites par le moteur de l'application, dans ses
   propres fils. L'interface en lance quelques-unes de front, le document affiché en premier,
   et ne rafraîchit le tableau qu'une fois par lot. */
const SCHEMATRON_PARALLEL = 3;
const schematronQueue = [];
let schematronActive = 0;
let schematronRefreshTimer = null;

function refreshSchematronViews(entry) {
  if (state.selected === entry.id) {
    const oldVerdicts = byId("verdicts");
    if (oldVerdicts) oldVerdicts.replaceWith(verdictStrip(entry));
    refreshAnomalyCenter(entry);
    const oldSch = byId("schematron-rules");
    const newSch = oldSch && schematronSection(entry);
    if (newSch) oldSch.replaceWith(newSch);
  }
  if (state.batch && !state.selected) refreshBatchProgress();
  clearTimeout(schematronRefreshTimer);
  schematronRefreshTimer = setTimeout(() => {
    if (state.batch && !state.selected) renderBatch();
  }, schematronQueue.length || schematronActive ? 1000 : 0);
}

function pumpSchematron() {
  while (schematronActive < SCHEMATRON_PARALLEL && schematronQueue.length) {
    const { entry, first } = schematronQueue.shift();
    if (!entry.result || entry.result.schematron || !state.files.includes(entry)) continue;
    schematronActive++;
    entry.result._schematronRunning = true;
    // Le XML d'origine ne sert qu'à cette validation : il n'est pas gardé en mémoire ensuite.
    SchematronValidator.validate(entry.result.xml_source || entry.result.xml_pretty, entry.result.format, first, entry.result.xml_pretty)
      .then((res) => { entry.result.schematron = res; delete entry.result.xml_source; })
      .catch((err) => { entry.result.schematron = { evalue: false, erreur_moteur: String(err) }; })
      .finally(() => {
        entry.result._schematronRunning = false;
        schematronActive--;
        refreshSchematronViews(entry);
        pumpSchematron();
      });
  }
}

function triggerSchematronValidation(entry, first) {
  if (!entry || !entry.result || entry.result.schematron || entry.result._schematronRunning) return;
  if (typeof SchematronValidator === "undefined") return;
  const queued = schematronQueue.findIndex((q) => q.entry === entry);
  if (queued !== -1) {
    if (!first) return;
    schematronQueue.splice(queued, 1);
  }
  if (first) schematronQueue.unshift({ entry, first: true }); else schematronQueue.push({ entry, first: false });
  pumpSchematron();
}

function selectFile(id) {
  captureDocumentView();
  state.renderToken++;
  state.selected = id;
  state.batch = false;
  state.library = false;
  state.tab = "pdf";
  state.pdfDoc = null;
  state.pdfSource = null;
  const f = getFile(id);
  triggerSchematronValidation(f, true);
  renderList();
  renderFileView();
}

function renderFileView() {
  state.renderToken++;
  document.querySelector(".layout").classList.toggle("workspace-home", !state.selected);
  const f = getFile(state.selected);
  const showLibraryView = state.library && !state.selected;
  byId("library-view").hidden = !showLibraryView;
  if (showLibraryView) {
    byId("batch-view").hidden = true;
    byId("empty-state").hidden = true;
    byId("file-view").hidden = true;
    renderLibrary();
    return;
  }
  const showBatchView = state.batch && !state.selected && state.files.length > 0;
  byId("batch-view").hidden = !showBatchView;
  if (showBatchView) {
    byId("empty-state").hidden = true;
    byId("file-view").hidden = true;
    renderBatch();
    return;
  }
  if (!f || f.status !== "ok") {
    byId("empty-state").hidden = false;
    byId("file-view").hidden = true;
    if (f?.status === "error") workspaceNotice(f.name + " : " + f.error);
    return;
  }
  byId("empty-state").hidden = true;
  const view = byId("file-view");
  view.hidden = false;
  f.rendered = {};
  f._dataStarted = false;
  if (f.view?.zoom) { state.zoom = f.view.zoom; state.fit = !!f.view.fit; byId("pdf-zoom").value = String(state.zoom); }
  else { state.zoom = parseFloat(settings.pdfZoom) || 1.25; state.fit = settings.pdfZoom === "fit"; }
  f.linesQuery = f.view?.linesQuery ?? f.linesQuery;
  f.sort = f.view?.sort || f.sort;
  loadPointage(f);

  byId("fv-name").textContent = f.name;
  const r = f.result;
  const badges = [
    '<span class="badge accent">' + esc(r.format) + " " + (r.root && r.root !== "Invoice" ? "· " + esc(r.root) : "") + "</span>",
  ];
  for (const c of r.header || []) {
    if ((c.title === "N° de facture" || c.title === "N° d'avoir") && c.value)
      badges.push('<span class="badge">' + esc(c.title) + " : " + esc(c.value) + "</span>");
    if (c.title === "Date d'émission" && c.value)
      badges.push('<span class="badge">' + esc(c.value) + "</span>");
    if (c.title === "Profil" && c.value)
      badges.push('<span class="badge">' + esc(c.value) + (c.note ? " — " + esc(c.note) : "") + "</span>");
    if (c.title === "Devise" && c.value)
      badges.push('<span class="badge">' + esc(c.value) + "</span>");
  }
  if (r.pdf) badges.push('<span class="badge ok">PDF intégré</span>');
  if (r.xml_pdf) badges.push('<span class="badge ok">PDF du XML</span>');
  byId("fv-badges").innerHTML = badges.join("");

  const xmlpdfTab = document.querySelector('.tab[data-tab="xmlpdf"]');
  if (xmlpdfTab) xmlpdfTab.hidden = !r.xml_pdf;

  const dl = byId("btn-download-pdf");
  dl.disabled = !(r.pdf || r.xml_pdf);
  document.querySelector('.tab[data-tab="dual"]').hidden = !(r.pdf || r.xml_pdf);

  if (f.view?.tab === "dual" && !(r.pdf || r.xml_pdf)) setTab("data", true);
  else if (f.view?.tab) setTab(f.view.tab === "xmlpdf" && !r.xml_pdf ? "pdf" : f.view.tab, true);
  else if (settings.defaultTab === "data") setTab("data", true);
  else setTab(r.xml_pdf ? "xmlpdf" : "pdf", true);
}

function setTab(name, force) {
  if (!force) captureDocumentView();
  state.tab = name;
  workspaceScrollTarget = { id: state.selected, tab: name };
  document.querySelectorAll(".tab").forEach((t) =>
    t.classList.toggle("active", t.dataset.tab === name));
  const paneId = (name === "xmlpdf") ? "tab-pdf" : "tab-" + name;
  byId("reading-panes").classList.toggle("dual-reading", name === "dual");
  document.querySelectorAll(".tabpane").forEach((p) =>
    p.classList.toggle("active", p.id === paneId || (name === "dual" && ["tab-pdf", "tab-data"].includes(p.id))));
  hidePopover();
  const f = getFile(state.selected);
  if (!f) return;
  if (name === "dual") {
    loadPointage(f).then(() => {
      if (state.selected !== f.id || state.tab !== "dual") return;
      renderData(f); f.rendered.data = true; restoreDocumentScroll(f);
    });
    renderPdf(f, f.result.pdf ? "pdf" : "xmlpdf");
  } else if (name === "pdf" || name === "xmlpdf") {
    if (force || state.pdfSource !== name) renderPdf(f, name);
  } else if (name === "data") {
    requestAnimationFrame(() => syncStickyOffsets());
    if (!f.rendered.data) {
      loadPointage(f).then(() => {
        const cur = getFile(f.id);
        if (cur && state.selected === f.id && state.tab === "data") {
          renderData(cur);
          cur.rendered.data = true;
          restoreDocumentScroll(cur);
        }
      });
    }
  } else if (name === "xml" && !f.rendered.xml) {
    renderXmlTable(f);
    f.rendered.xml = true;
  } else if (name === "raw" && !f.rendered.raw) {
    renderRaw(f);
    f.rendered.raw = true;
  }
  const mainEl = document.querySelector(".main");
  if (mainEl) mainEl.scrollTop = 0;
  if (f) {
    f.view = { ...f.view, tab: name };
    saveWorkspace();
    if (name === "xml" || name === "raw" || (name === "data" && f.rendered.data) ||
      ((name === "pdf" || name === "xmlpdf") && state.pdfDoc && f.rendered.pdf)) restoreDocumentScroll(f);
  }
}

/* ---------------- onglet PDF ---------------- */

function updatePageInfo(doc) {
  const pages = document.querySelectorAll(".pdf-page");
  if (!pages.length || !doc) { byId("pdf-pageinfo").textContent = ""; return; }
  let current = 1;
  const mid = window.innerHeight * 0.4;
  let best = Infinity;
  pages.forEach((p) => {
    const r = p.getBoundingClientRect();
    const d = Math.abs(r.top - mid);
    if (d < best) { best = d; current = Number(p.dataset.page); }
  });
  byId("pdf-pageinfo").textContent = "Page " + current + " / " + doc.numPages;
}

async function renderPdf(f, src) {
  const f2 = getFile(state.selected);
  if (!f2 || f2.id !== f.id) return;
  const pane = byId("pdf-pages");
  const pdfObj = (src === "xmlpdf") ? f.result.xml_pdf : f.result.pdf;
  state.pdfSource = src;
  state.pdfSearchPages = [];
  state.pdfSearchMatches = [];
  state.pdfSearchIndex = -1;
  byId("pdf-search").value = "";
  updatePdfSearchStatus();
  if (!pdfObj) {
    pane.innerHTML = '<div class="pdf-none">' + (src === "xmlpdf"
      ? "Le XML de cette facture ne contient pas de PDF intégré distinct."
      : "Aucun PDF intégré trouvé dans ce fichier.") + "</div>";
    byId("pdf-pageinfo").textContent = "";
    state.pdfDoc = null;
    restoreDocumentScroll(f);
    return;
  }
  pane.innerHTML = '<div class="pdf-loading">Chargement du PDF…</div>';
  try {
    const bytes = b64toBytes(pdfObj.base64);
    const doc = await pdfjsLib.getDocument({ data: bytes }).promise;
    const f3 = getFile(state.selected);
    if (!f3 || f3.id !== f.id || state.pdfSource !== src) return;
    state.pdfDoc = doc;
    if (state.fit) await fitWidth();
    else await renderAllPages(doc);
  } catch (e) {
    if (state.selected === f.id && state.pdfSource === src) {
      pane.innerHTML = '<div class="notice error">Impossible d’afficher le PDF : ' + esc(String(e)) + "</div>";
      f.rendered.pdf = true;
    }
    if (state.selected === f.id) restoreDocumentScroll(f);
  }
}

async function renderAllPages(doc) {
  const token = ++state.renderToken;
  const renderingFile = getFile(state.selected);
  if (renderingFile) {
    renderingFile.rendered.pdf = false;
    if (state.tab === state.pdfSource || state.tab === "dual") workspaceScrollTarget = { id: renderingFile.id, tab: state.tab };
  }
  const pane = byId("pdf-pages");
  pane.innerHTML = "";
  state.pdfSearchPages = [];
  const scale = state.zoom;
  for (let i = 1; i <= doc.numPages; i++) {
    if (token !== state.renderToken) return;
    const page = await doc.getPage(i);
    if (token !== state.renderToken) return;
    const div = document.createElement("div");
    div.className = "pdf-page";
    div.dataset.page = String(i);
    const canvas = document.createElement("canvas");
    const label = document.createElement("div");
    label.className = "pdf-page-label";
    label.textContent = "Page " + i + " / " + doc.numPages;
    div.appendChild(canvas);
    div.appendChild(label);
    pane.appendChild(div);
    const viewport = page.getViewport({ scale });
    div.style.width = viewport.width + "px";
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const ctx = canvas.getContext("2d");
    await page.render({ canvasContext: ctx, viewport }).promise;
    if (token !== state.renderToken) return;
    try {
      const content = await page.getTextContent();
      if (token !== state.renderToken) return;
      const layer = document.createElement("div");
      layer.className = "pdf-text-layer";
      layer.style.width = viewport.width + "px";
      layer.style.height = viewport.height + "px";
      div.appendChild(layer);
      const textDivs = [];
      await pdfjsLib.renderTextLayer({ textContentSource: content, container: layer, viewport, textDivs }).promise;
      if (token !== state.renderToken) return;
      state.pdfSearchPages.push({ layer, content, textDivs, page: i });
    } catch (e) { /* Un calque texte défectueux ne doit pas empêcher l'affichage du PDF. */ }
  }
  if (token === state.renderToken) {
    updatePdfSearch(false);
    updatePageInfo(doc);
    const f = getFile(state.selected);
    if (f) { f.rendered.pdf = true; restoreDocumentScroll(f); }
  }
}

function updatePdfSearchStatus() {
  const query = byId("pdf-search").value.trim();
  const count = state.pdfSearchMatches.length;
  byId("pdf-search-status").textContent = !query ? "" : !state.pdfDoc ? "PDF absent"
    : !state.pdfSearchPages.some(p => p.content.items.some(item => item.str)) ? "Aucun texte (OCR requis)"
    : count ? `${state.pdfSearchIndex + 1} / ${count}` : "Aucun résultat";
  byId("pdf-search-prev").disabled = !count;
  byId("pdf-search-next").disabled = !count;
}

function updatePdfSearch(navigate = true) {
  state.pdfSearchMatches = [];
  state.pdfSearchIndex = -1;
  document.querySelectorAll(".pdf-match").forEach(el => el.remove());
  const query = byId("pdf-search").value.trim().toLocaleLowerCase();
  if (!query) { updatePdfSearchStatus(); return; }
  for (const { layer, content, textDivs, page } of state.pdfSearchPages) {
    const items = content.items;
    const offsets = [];
    let full = "";
    items.forEach((item, index) => {
      offsets.push(full.length);
      full += item.str || "";
      if (item.hasEOL) full += "\n";
    });
    const lower = full.toLocaleLowerCase();
    for (let pos = 0; (pos = lower.indexOf(query, pos)) !== -1; pos += Math.max(1, query.length)) {
      const marks = [];
      const end = pos + query.length;
      for (let i = 0; i < items.length; i++) {
        const start = offsets[i], itemEnd = start + (items[i].str || "").length;
        if (itemEnd <= pos || start >= end || !textDivs[i]?.firstChild) continue;
        const node = textDivs[i].firstChild;
        if (node.nodeType !== Node.TEXT_NODE) continue;
        const range = document.createRange();
        range.setStart(node, Math.max(0, pos - start));
        range.setEnd(node, Math.min(node.length, end - start));
        const origin = layer.getBoundingClientRect();
        for (const rect of range.getClientRects()) {
          if (!rect.width || !rect.height) continue;
          const mark = document.createElement("span");
          mark.className = "pdf-match";
          mark.style.left = rect.left - origin.left + "px";
          mark.style.top = rect.top - origin.top + "px";
          mark.style.width = rect.width + "px";
          mark.style.height = rect.height + "px";
          layer.appendChild(mark);
          marks.push(mark);
        }
      }
      if (marks.length) state.pdfSearchMatches.push({ marks, page });
    }
  }
  if (state.pdfSearchMatches.length) {
    state.pdfSearchIndex = 0;
    if (navigate) gotoPdfSearchMatch(0);
    else state.pdfSearchMatches[0].marks.forEach(mark => mark.classList.add("active"));
  }
  updatePdfSearchStatus();
}

function gotoPdfSearchMatch(delta) {
  const matches = state.pdfSearchMatches;
  if (!matches.length) return;
  matches[state.pdfSearchIndex]?.marks.forEach(mark => mark.classList.remove("active"));
  state.pdfSearchIndex = (state.pdfSearchIndex + delta + matches.length) % matches.length;
  const match = matches[state.pdfSearchIndex];
  match.marks.forEach(mark => mark.classList.add("active"));
  match.marks[0].scrollIntoView({ block: "center", inline: "nearest" });
  updatePdfSearchStatus();
}

async function fitWidth() {
  const doc = state.pdfDoc;
  if (!doc) return;
  const page = await doc.getPage(1);
  const base = page.getViewport({ scale: 1 });
  const avail = Math.max(320, byId("pdf-pages").clientWidth - 40);
  state.zoom = Math.min(3, Math.max(0.4, avail / base.width));
  await renderAllPages(doc);
}

function gotoPage(dir) {
  const pages = [...document.querySelectorAll(".pdf-page")];
  if (!pages.length) return;
  let idx = 0;
  const mid = window.innerHeight * 0.4;
  let best = Infinity;
  pages.forEach((p, i) => {
    const d = Math.abs(p.getBoundingClientRect().top - mid);
    if (d < best) { best = d; idx = i; }
  });
  const next = Math.min(pages.length - 1, Math.max(0, idx + dir));
  pages[next].scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ---------------- onglet Données ---------------- */

function makeCell(td, c) {
  if (!c) return;
  td.classList.add("cell");
  td.dataset.title = c.title || "";
  td.dataset.path = c.path || "";
  td.dataset.value = c.value ?? "";
  if (c.value === "" || c.value == null) {
    td.classList.add("empty");
    td.textContent = "—";
    return;
  }
  const span = document.createElement("span");
  span.className = "val";
  span.textContent = c.value;
  td.appendChild(span);
  if (c.note) {
    const n = document.createElement("span");
    n.className = "note";
    n.textContent = c.note;
    td.appendChild(n);
  }
}

function kvTable(rows) {
  const table = document.createElement("table");
  const thead = document.createElement("thead");
  thead.innerHTML = "<tr><th style='width:34%'>Champ</th><th>Valeur</th></tr>";
  table.appendChild(thead);
  const tbody = document.createElement("tbody");
  for (const row of rows) {
    const tr = document.createElement("tr");
    const th = document.createElement("td");
    th.textContent = row.title || "";
    th.style.color = "var(--muted)";
    const td = document.createElement("td");
    makeCell(td, row);
    tr.appendChild(th);
    tr.appendChild(td);
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  return table;
}

/* ---- pointage (persiste dans pointages.json, cles = hash du XML) ---- */

/* Erreur de lecture ou d'écriture des pointages ou du suivi : toujours visible. */
function dataNotice(error) {
  workspaceNotice(String((error && error.message) || error));
  // Si un fichier est illisible, afficher l'état complet des deux fichiers plutôt que la dernière erreur.
  refreshDataStatus(true);
}

/* État des fichiers de pointages et de suivi, affiché dans les Paramètres. */
async function refreshDataStatus(warn) {
  let status;
  try { status = await api.dataStatus(); } catch { return; }
  if (!status || !status.pointages || !status.suivi) return;
  const parts = [["pointages", "Pointages"], ["suivi", "Suivi de vérification"]];
  const broken = parts.filter(([key]) => !status[key].ok);
  const text = byId("data-status-text");
  text.replaceChildren();
  for (const [key, label] of parts) {
    const s = status[key];
    const line = document.createElement("span");
    line.className = "data-status-line" + (s.ok ? "" : " data-status-error");
    line.textContent = label + " : " + (s.ok
      ? s.entrees + " facture" + (s.entrees > 1 ? "s" : "") + ", " + s.sauvegardes.length + " sauvegarde" + (s.sauvegardes.length > 1 ? "s" : "") + " quotidienne" + (s.sauvegardes.length > 1 ? "s" : "")
      : s.erreur + " Rien n'est écrasé tant que le fichier n'est pas restauré.");
    text.appendChild(line);
  }
  const restore = byId("data-restore");
  restore.hidden = !broken.length;
  restore.dataset.which = broken.map(([key]) => key).join(",");
  restore.disabled = !broken.some(([key]) => status[key].sauvegardes.length);
  restore.title = restore.disabled ? "Aucune sauvegarde disponible" : "";
  if (warn && broken.length)
    workspaceNotice(broken.map(([key]) => status[key].erreur).join(" ") +
      " Rien ne sera écrasé : ouvrez les Paramètres pour restaurer une sauvegarde.");
}

/* Après une restauration ou un import : relire le suivi et les pointages affichés. */
async function reloadUserData() {
  await initReviews();
  for (const f of state.files) f._pointagePromise = null;
  renderList(true);
  renderFileView();
  await refreshDataStatus(false);
}

function wireDataProtection() {
  byId("btn-settings").addEventListener("click", () => refreshDataStatus(false));
  byId("data-export").addEventListener("click", async (e) => {
    const btn = e.currentTarget, old = btn.textContent;
    try { await flushReviews(); if (await api.exportData()) btn.textContent = "Exporté"; }
    catch (error) { dataNotice(error); }
    setTimeout(() => { btn.textContent = old; }, 1200);
  });
  byId("data-import").addEventListener("click", async () => {
    try {
      const result = await api.importData();
      if (!result) return;
      await reloadUserData();
      workspaceNotice("Import terminé : " + result.pointages + " pointage(s) et " + result.suivi + " suivi(s) ajoutés ou mis à jour. Les données plus récentes déjà présentes sont conservées.");
    } catch (error) { dataNotice(error); }
  });
  byId("data-restore").addEventListener("click", async (e) => {
    const names = [];
    try {
      for (const which of e.currentTarget.dataset.which.split(",").filter(Boolean)) names.push(await api.restoreBackup(which));
      await reloadUserData();
      workspaceNotice("Sauvegarde restaurée : " + names.join(", ") + ". Le fichier illisible a été conservé à côté.");
    } catch (error) { dataNotice(error); await refreshDataStatus(false); }
  });
}

function loadPointage(f) {
  if (f._pointagePromise) return f._pointagePromise;
  const hash = f.result && f.result.doc_hash;
  if (!hash) {
    f.pointed = new Set();
    f._pointagePromise = Promise.resolve();
    return f._pointagePromise;
  }
  f._pointagePromise = api.getPointage(hash)
    .then((j) => { const cur = getFile(f.id); if (cur && cur.id === f.id) f.pointed = new Set(j.lines || []); })
    .catch((e) => {
      // Fichier des pointages illisible : le dire, ne pas faire croire qu'il n'y a aucun pointage.
      const cur = getFile(f.id); if (cur && cur.id === f.id) f.pointed = new Set();
      dataNotice(e);
    });
  return f._pointagePromise;
}

function savePointage(f) {
  const hash = f.result && f.result.doc_hash;
  if (!hash) return Promise.resolve();
  const lines = [...f.pointed].sort((a, b) => a - b);
  return api.setPointage(hash, lines, f.name).catch(dataNotice);
}

function clearPointage(f) {
  const hash = f.result && f.result.doc_hash;
  f.pointed = new Set();
  if (hash) api.clearPointage(hash).catch(dataNotice);
}

function togglePoint(f, idx) {
  if (f.pointed.has(idx)) f.pointed.delete(idx);
  else f.pointed.add(idx);
  updatePointUI(f, idx);
  savePointage(f);
}

function updatePointUI(f, idx) {
  const on = f.pointed.has(idx);
  const tr = document.querySelector('#lines-tbody tr[data-idx="' + idx + '"]');
  if (!tr) return;
  tr.classList.toggle("pointed", on);
  tr.classList.remove("pt-alt");
  document.querySelectorAll('#lines-tbody tr.pointed').forEach((row, i) => {
    if (i % 2 === 1) row.classList.add("pt-alt");
  });
  const btn = tr.querySelector(".point-btn");
  if (btn) btn.setAttribute("aria-pressed", on ? "true" : "false");
  const cnt = byId("lines-pointed-count");
  if (cnt) cnt.textContent = f.pointed.size + " ligne" + (f.pointed.size > 1 ? "s" : "") + " pointée" + (f.pointed.size > 1 ? "s" : "");
}

function updatePointedCount(f) {
  const cnt = byId("lines-pointed-count");
  if (cnt) cnt.textContent = f.pointed.size + " ligne" + (f.pointed.size > 1 ? "s" : "") + " pointée" + (f.pointed.size > 1 ? "s" : "");
  syncStickyOffsets();
}

/* ---- tri + recherche sur les lignes ---- */

function linesCols(r) {
  const base = (r.lines_columns || []).filter((c) => c.key !== "note" && c.key !== "detail");
  const cols = base.slice();
  const hasRawNote = (r.lines || []).some(
    (l) => l.cells && l.cells.note && l.cells.note.value
  );
  if (hasRawNote) cols.push({ key: "note", title: "Note(s)", align: "left" });
  for (const c of r.note_columns || []) cols.push(c);
  const detail = (r.lines_columns || []).find((c) => c.key === "detail");
  if (detail) cols.push(detail);
  return cols;
}

function _num(v) {
  if (v == null) return null;
  const m = String(v).replace(/\s/g, "").match(/-?\d+(?:[.,]\d+)?/);
  return m ? decimalUnits(m[0]) : null;
}

function applyLineFilters(f) {
  const r = f.result;
  let rows = r.lines.map((line, idx) => ({ line, idx }));
  const q = (f.linesQuery || "").trim().toLowerCase();
  if (q) {
    rows = rows.filter(({ line }) => {
      const hay = linesCols(r)
        .map((c) => { const c2 = line.cells[c.key]; return (c2 && c2.value) ? c2.value : ""; })
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }
  const pf = f.linesFilter || "all";
  if (pf !== "all") {
    rows = rows.filter(({ idx }) => (pf === "pointed") ? f.pointed.has(idx) : !f.pointed.has(idx));
  }
  const s = f.sort;
  if (s && s.key) {
    const dir = s.dir;
    rows.sort((a, b) => {
      const av = (a.line.cells[s.key] || {}).value ?? "";
      const bv = (b.line.cells[s.key] || {}).value ?? "";
      const an = _num(av), bn = _num(bv);
      let cmp;
      if (an != null && bn != null) cmp = an < bn ? -1 : an > bn ? 1 : 0;
      else cmp = String(av).localeCompare(String(bv), "fr", { numeric: true });
      return cmp * dir;
    });
  }
  return rows;
}

/* ---- export des lignes affichées (recherche, filtre de pointage et tri appliqués) ---- */

/* Tableau [en-têtes, ...lignes]. Les montants « 12.50 EUR » deviennent « 12,50 »
   (décimale française, lisible par Excel) et la devise passe dans sa propre colonne. */
function linesExportRows(f) {
  const cols = linesCols(f.result).filter((c) => c.key !== "detail");
  const table = [["Pointée", ...cols.map((c) => c.title), "Devise"]];
  for (const { line, idx } of applyLineFilters(f)) {
    let currency = "";
    const cells = cols.map((col) => {
      const v = String((line.cells[col.key] || {}).value ?? "");
      const m = col.align === "right" && /^(-?\d+(?:\.\d+)?)(?: ([A-Z]{3}))?$/.exec(v);
      if (!m) return v;
      if (m[2]) currency = m[2];
      return m[1].replace(".", ",");
    });
    table.push([f.pointed.has(idx) ? "oui" : "non", ...cells, currency]);
  }
  return table;
}

function csvCell(v) {
  // Une valeur de facture ne doit pas être interprétée comme une formule par le tableur.
  if (/^[=+@]/.test(v) || (/^-/.test(v) && !/^-\d+(,\d+)?$/.test(v))) v = "'" + v;
  return /[;"\r\n]/.test(v) ? '"' + v.replaceAll('"', '""') + '"' : v;
}

function linesCsv(f) {
  // BOM UTF-8 + point-virgule + CRLF : ouverture directe dans Excel en français.
  return "﻿" + linesExportRows(f).map((row) => row.map(csvCell).join(";")).join("\r\n") + "\r\n";
}

function linesTsv(f) {
  return linesExportRows(f).map((row) => row.map((v) => v.replace(/[\t\r\n]+/g, " ")).join("\t")).join("\n");
}

async function exportLinesCsv(f, btn) {
  const old = btn.textContent;
  try {
    const saved = await api.saveText(f.name.replace(/\.[^.]+$/, "") + "-lignes.csv", linesCsv(f));
    if (saved) btn.textContent = "Exporté";
  } catch (e) {
    workspaceNotice("Export impossible : " + ((e && e.message) || e));
  }
  setTimeout(() => { btn.textContent = old; }, 1200);
}

function linesTable(f) {
  const r = f.result;
  const cols = linesCols(r);
  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const trh = document.createElement("tr");
  const thPoint = document.createElement("th");
  thPoint.className = "col-point";
  thPoint.title = "Pointer la ligne";
  trh.appendChild(thPoint);
  for (const col of cols) {
    const th = document.createElement("th");
    const label = document.createElement("span");
    label.textContent = col.title;
    th.appendChild(label);
    if (col.align === "right") th.classList.add("num");
    if (f.sort && f.sort.key === col.key) {
      th.classList.add("sorted", f.sort.dir > 0 ? "sort-asc" : "sort-desc");
      label.textContent += (f.sort.dir > 0 ? "  \u2191" : "  \u2193");
    }
    th.title = "Trier par " + col.title;
    th.addEventListener("click", () => {
      if (f.sort && f.sort.key === col.key) f.sort.dir *= -1;
      else f.sort = { key: col.key, dir: 1 };
      renderLinesOnly(f);
    });
    trh.appendChild(th);
  }
  thead.appendChild(trh);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  tbody.id = "lines-tbody";
  const rows = applyLineFilters(f);
  let pointedSeq = 0;
  for (const { line, idx } of rows) {
    const tr = document.createElement("tr");
    tr.dataset.idx = String(idx);
    const pointed = f.pointed.has(idx);
    if (pointed) {
      tr.classList.add("pointed");
      if (pointedSeq % 2 === 1) tr.classList.add("pt-alt");
      pointedSeq++;
    }
    const tdPoint = document.createElement("td");
    tdPoint.className = "col-point";
    const btn = document.createElement("button");
    btn.className = "point-btn";
    btn.type = "button";
    btn.setAttribute("aria-pressed", pointed ? "true" : "false");
    btn.title = pointed ? "Retirer le pointage" : "Pointer cette ligne";
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      togglePoint(f, idx);
    });
    tdPoint.appendChild(btn);
    tr.appendChild(tdPoint);
    for (const col of cols) {
      const td = document.createElement("td");
      if (col.key === "detail") {
        td.classList.add("col-detail");
        const open = (f._openDetails || new Set()).has(idx);
        const b = document.createElement("button");
        b.type = "button";
        b.className = "detail-btn" + (open ? " open" : "");
        b.textContent = open ? "Masquer" : "Détail";
        b.title = "Afficher tous les champs de la ligne";
        b.addEventListener("click", (e) => { e.stopPropagation(); toggleDetail(f, idx); });
        td.appendChild(b);
      } else {
        if (col.align === "right") td.classList.add("num");
        makeCell(td, line.cells[col.key]);
      }
      tr.appendChild(td);
    }
    tbody.appendChild(tr);

    // Ligne de détail extensible (tous les champs de la ligne).
    const dtr = document.createElement("tr");
    dtr.className = "line-detail-row" + ((f._openDetails || new Set()).has(idx) ? " open" : "");
    dtr.dataset.detailFor = String(idx);
    const dtd = document.createElement("td");
    dtd.colSpan = cols.length + 1;
    dtd.appendChild(detailBox(line, f, idx));
    dtr.appendChild(dtd);
    tbody.appendChild(dtr);
  }
  table.appendChild(tbody);

  const cnt = byId("lines-count");
  if (cnt) {
    const total = r.lines.length;
    cnt.textContent = rows.length === total ? total + " lignes" : rows.length + " / " + total + " lignes";
  }
  return table;
}

function toggleDetail(f, idx) {
  if (!f._openDetails) f._openDetails = new Set();
  if (f._openDetails.has(idx)) f._openDetails.delete(idx);
  else f._openDetails.add(idx);
  renderLinesOnly(f);
}

function detailBox(line, f, idx) {
  const box = document.createElement("div");
  box.className = "line-detail-box";
  const proof = f?.result.synthese?.provenance_lignes?.[idx];
  if (proof) box.appendChild(lineProvenancePanel(proof, false));
  if (f && f.result.synthese && settings.library !== "off") {
    const history = Object.assign(document.createElement("button"), {
      type: "button", className: "btn btn-sm price-history-btn", textContent: "Historique des prix",
    });
    history.title = "Prix de cet article sur les autres factures de ce fournisseur";
    history.addEventListener("click", (e) => { e.stopPropagation(); showPriceHistory(f, idx, box, history); });
    box.appendChild(history);
  }
  const fields = (line && line.fields) || [];
  if (!fields.length) {
    const p = document.createElement("p");
    p.textContent = "Aucun champ supplémentaire pour cette ligne.";
    box.appendChild(p);
    return box;
  }
  const table = document.createElement("table");
  table.className = "line-detail-table";
  const thead = document.createElement("thead");
  thead.innerHTML = "<tr><th style='width:26%'>Champ</th><th>Valeur</th><th style='width:30%'>Chemin (XML)</th></tr>";
  table.appendChild(thead);
  const tbody = document.createElement("tbody");
  for (const f2 of fields) {
    const tr = document.createElement("tr");
    const th = document.createElement("td");
    th.className = "dt-title";
    th.textContent = f2.title || "";
    const tdv = document.createElement("td");
    tdv.textContent = f2.value || "";
    const tdp = document.createElement("td");
    tdp.className = "dt-path";
    tdp.textContent = f2.path || "";
    tr.appendChild(th);
    tr.appendChild(tdv);
    tr.appendChild(tdp);
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  box.appendChild(table);
  return box;
}

function provenanceSourceLink(path, label) {
  const row = document.createElement("p");
  row.className = "provenance-path";
  row.appendChild(document.createTextNode(label + " · " + path + " "));
  const button = Object.assign(document.createElement("button"), { type: "button", className: "btn btn-sm", textContent: "Voir dans le XML" });
  button.addEventListener("click", () => {
    setTab("xml");
    byId("xml-search").value = "";
    filterXmlTable("");
    gotoXml(path);
  });
  row.appendChild(button);
  return row;
}

function lineProvenancePanel(proof, open) {
  const panel = Object.assign(document.createElement("details"), { className: "line-provenance", open });
  panel.appendChild(Object.assign(document.createElement("summary"), { textContent: "Calcul et provenance de la ligne" }));
  for (const input of proof.inputs || []) {
    const label = input.label + " : " + (input.value || "Non disponible") + (input.note ? " (" + input.note + ")" : "");
    panel.appendChild(input.path ? provenanceSourceLink(input.path, label) :
      Object.assign(document.createElement("p"), { textContent: label }));
  }
  if (proof.comparison) {
    const c = proof.comparison;
    panel.appendChild(Object.assign(document.createElement("p"), { textContent: "Calcul : " + c.formula }));
    panel.appendChild(Object.assign(document.createElement("p"), { textContent: "Sans frais/remises : " + c.base_expected +
      (c.adjustments_net !== "0.00" ? " · Avec frais/remises : " + c.adjusted_expected + " (net " + c.adjustments_net + ")" : "") }));
    panel.appendChild(Object.assign(document.createElement("p"), { textContent: "Valeur attendue retenue : " + c.expected + " · Tolérance du contrôle : ±" + c.tolerance }));
    panel.appendChild(Object.assign(document.createElement("p"), { textContent: "Le contrôle accepte le calcul avec ou sans frais/remises lorsque l’écart est dans la tolérance." }));
  } else {
    panel.appendChild(Object.assign(document.createElement("p"), { textContent: "Calcul non vérifiable : quantité, prix unitaire ou total de ligne absent, ou quantité de base nulle." }));
  }
  return panel;
}

function taxBreakdownPanel(proof, index, open = false) {
  const panel = Object.assign(document.createElement("details"), { className: "line-provenance tax-provenance", open });
  panel.dataset.taxIndex = String(index);
  panel.appendChild(Object.assign(document.createElement("summary"), {
    textContent: "TVA par taux · ventilation " + (index + 1) + (proof.rate ? " · " + proof.rate + " %" : ""),
  }));
  for (const input of proof.inputs || []) {
    const label = input.label + " : " + (input.value || "Non disponible") + (input.note ? " (" + input.note + ")" : "");
    panel.appendChild(input.path ? provenanceSourceLink(input.path, label) :
      Object.assign(document.createElement("p"), { textContent: label }));
  }
  if (proof.comparison) {
    const c = proof.comparison;
    panel.appendChild(Object.assign(document.createElement("p"), { textContent: "Calcul : " + c.formula }));
    panel.appendChild(Object.assign(document.createElement("p"), { textContent: "TVA attendue : " + c.expected +
      " · TVA déclarée : " + c.found + " · Écart : " + c.difference + " · Tolérance du contrôle : ±" + c.tolerance }));
  } else {
    panel.appendChild(Object.assign(document.createElement("p"), {
      textContent: "Calcul non vérifiable : base, taux ou TVA déclarée absents ou non numériques.",
    }));
  }
  return panel;
}

function syncStickyOffsets() {
  const tabs = document.querySelector(".tabs");
  const head = byId("lines-head");
  const root = document.documentElement;
  if (tabs) root.style.setProperty("--tabs-h", tabs.offsetHeight + "px");
  if (head && head.offsetHeight) root.style.setProperty("--lines-head-h", head.offsetHeight + "px");
}

function renderLinesOnly(f) {
  const wrap = byId("lines-table-wrap");
  if (!wrap) return;
  wrap.innerHTML = "";
  wrap.appendChild(linesTable(f));
  updatePointedCount(f);
  syncStickyOffsets();
}

/* ---- contrôles de cohérence (calculés par le moteur) et doublons ---- */

const CONTROL_STATES = {
  ecart: "Écart",
  alerte: "Alerte",
  non_verifiable: "Non vérifiable",
  info: "Info",
  conforme: "Conforme",
};

function summaryValue(r, title) {
  return ((r.summary || []).find((s) => s.title === title) || {}).value || "";
}

function controlsSection(f) {
  const checks = [...duplicateChecks(f), ...(f.result.controles || [])];
  if (!checks.length) return null;
  const order = Object.keys(CONTROL_STATES);
  const counts = {};
  for (const c of checks) counts[c.etat] = (counts[c.etat] || 0) + 1;

  const sec = document.createElement("details");
  sec.id = "controls";
  sec.className = "section controls";
  sec.open = !!(counts.ecart || counts.alerte);
  const head = document.createElement("summary");
  head.className = "section-head controls-head";
  head.appendChild(Object.assign(document.createElement("span"), { textContent: "Contrôles" }));
  for (const etat of order) {
    if (!counts[etat]) continue;
    head.appendChild(Object.assign(document.createElement("span"), {
      className: "ctl-chip ctl-" + etat,
      textContent: counts[etat] + " " + CONTROL_STATES[etat].toLowerCase() + (counts[etat] > 1 && etat !== "info" ? "s" : ""),
    }));
  }
  const report = Object.assign(document.createElement("button"), {
    id: "btn-control-report", type: "button", className: "btn btn-sm controls-report", textContent: "Rapport JSON",
    title: "Enregistrer le rapport de contrôle : synthèse, contrôles et suivi de vérification",
  });
  report.addEventListener("click", (e) => { e.preventDefault(); exportControlReport(f, report); });
  head.appendChild(report);
  const pdfReport = Object.assign(document.createElement("button"), { id: "btn-control-pdf", type: "button", className: "btn btn-sm", textContent: "Rapport PDF" });
  pdfReport.addEventListener("click", (e) => { e.preventDefault(); exportControlPdf(f, pdfReport); });
  head.appendChild(pdfReport);
  sec.appendChild(head);

  const wrap = document.createElement("div");
  wrap.className = "table-wrap";
  const table = document.createElement("table");
  table.innerHTML = "<thead><tr><th style='width:120px'>État</th><th>Contrôle</th>" +
    "<th class='num'>Attendu</th><th class='num'>Constaté</th><th class='num'>Écart</th></tr></thead>";
  const tbody = document.createElement("tbody");
  const sorted = checks.slice().sort((a, b) => order.indexOf(a.etat) - order.indexOf(b.etat));
  for (const c of sorted) {
    const tr = document.createElement("tr");
    tr.className = "ctl-row ctl-" + c.etat;
    tr.innerHTML =
      '<td><span class="ctl-chip ctl-' + esc(c.etat) + '">' + esc(CONTROL_STATES[c.etat] || c.etat) + "</span></td>" +
      "<td>" + esc(c.regle) + (c.detail ? '<span class="note">' + esc(c.detail) + "</span>" : "") + "</td>" +
      '<td class="num">' + esc(c.attendu) + '</td><td class="num">' + esc(c.constate) + "</td>" +
      '<td class="num">' + esc(c.ecart) + "</td>";
    if (c.path) {
      tr.classList.add("ctl-link");
      tr.title = "Voir dans le XML : " + c.path;
      tr.addEventListener("click", () => gotoXml(c.path));
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  wrap.appendChild(table);
  sec.appendChild(wrap);
  return sec;
}

/* ---- règles métier EN 16931 (évaluées par le moteur) ---- */

function rulesSection(f) {
  const report = f.result.regles;
  if (!report || !report.liste || !report.liste.length) return null;
  const failed = report.non_conformes || 0;
  const passed = report.evaluees - failed;
  const sec = document.createElement("details");
  sec.id = "rules";
  sec.className = "section controls";
  sec.open = failed > 0;
  const head = document.createElement("summary");
  head.className = "section-head controls-head";
  head.appendChild(Object.assign(document.createElement("span"), { textContent: "Règles EN 16931" }));
  if (failed) head.appendChild(Object.assign(document.createElement("span"), {
    className: "ctl-chip ctl-ecart", textContent: failed + " non respectée" + (failed > 1 ? "s" : ""),
  }));
  head.appendChild(Object.assign(document.createElement("span"), {
    className: "ctl-chip ctl-conforme", textContent: passed + " respectée" + (passed > 1 ? "s" : ""),
  }));
  sec.appendChild(head);
  const note = document.createElement("p");
  note.className = "rules-note";
  note.textContent = report.niveau + " Ne remplace pas une validation XSD, Schematron ni PDF/A-3.";
  sec.appendChild(note);

  const wrap = document.createElement("div");
  wrap.className = "table-wrap";
  const table = document.createElement("table");
  table.innerHTML = "<thead><tr><th style='width:130px'>État</th><th style='width:110px'>Règle</th><th>Énoncé</th></tr></thead>";
  const tbody = document.createElement("tbody");
  const sorted = report.liste.slice().sort((a, b) => (a.etat === "conforme") - (b.etat === "conforme"));
  for (const rule of sorted) {
    const ok = rule.etat === "conforme";
    const tr = document.createElement("tr");
    tr.className = "ctl-row " + (ok ? "ctl-conforme" : "ctl-ecart");
    tr.innerHTML =
      '<td><span class="ctl-chip ' + (ok ? "ctl-conforme" : "ctl-ecart") + '">' + (ok ? "Respectée" : "Non respectée") + "</span></td>" +
      "<td>" + esc(rule.id) + "</td>" +
      "<td>" + esc(rule.libelle) + (rule.detail ? '<span class="note">' + esc(rule.detail) + "</span>" : "") + "</td>";
    if (rule.path) {
      tr.classList.add("ctl-link");
      tr.title = "Voir dans le XML : " + rule.path;
      tr.addEventListener("click", () => gotoXml(rule.path));
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  wrap.appendChild(table);
  sec.appendChild(wrap);
  return sec;
}

/* ---- impression de la vue affichée ---- */

function printView() {
  hideContextMenu();
  hidePopover();
  // Blocs repliés ouverts et thème clair le temps de l'impression.
  const closed = [...document.querySelectorAll("#controls:not([open]), #rules:not([open]), #schematron-rules:not([open]), #xsd-errors:not([open]), #anomaly-center:not([open]), .anomaly-incomplete:not([open])")];
  closed.forEach((d) => { d.open = true; });
  const root = document.documentElement;
  const theme = root.getAttribute("data-theme");
  root.setAttribute("data-theme", "jour");
  let restored = false;
  const restore = () => {
    if (restored) return;
    restored = true;
    closed.forEach((d) => { d.open = false; });
    root.setAttribute("data-theme", theme);
    window.removeEventListener("afterprint", restore);
    document.removeEventListener("pointerdown", restore, true);
  };
  window.addEventListener("afterprint", restore);
  // Filet de sécurité si la fenêtre ne signale pas la fin de l'impression.
  document.addEventListener("pointerdown", restore, true);
  api.print().catch(() => window.print());
}

/* Schéma XSD : erreurs de structure, avec leur ligne dans « XML brut ». */
function xsdSection(f) {
  const x = f.result && f.result.xsd;
  if (!x || (!x.evalue && f.result.format !== "CII" && f.result.format !== "UBL")) return null;
  const sec = document.createElement("details");
  sec.id = "xsd-errors";
  sec.className = "section controls";
  sec.open = x.evalue && !x.ok;
  const sum = document.createElement("summary");
  sum.className = "section-title";
  const etat = !x.evalue ? "non_verifiable" : x.ok ? "conforme" : "ecart";
  sum.innerHTML = '<span class="ctl-chip ctl-' + etat + '">Schéma XSD</span> ' +
    esc(!x.evalue ? "Non évalué : " + (x.raison || "") : x.ok ? "Structure du XML conforme au schéma" : x.total + " erreur" + (x.total > 1 ? "s" : "") + " de structure");
  sec.appendChild(sum);
  if (x.evalue && !x.ok) {
    const list = document.createElement("ul");
    list.className = "xsd-list";
    for (const e of x.erreurs) {
      const li = document.createElement("li");
      li.textContent = (e.ligne ? "Ligne " + e.ligne + (e.colonne ? ", colonne " + e.colonne : "") + " : " : "") + e.message;
      list.appendChild(li);
    }
    sec.appendChild(list);
    if (x.total > x.erreurs.length) {
      sec.appendChild(Object.assign(document.createElement("p"), { className: "notice", textContent: "Seules les " + x.erreurs.length + " premières erreurs sont listées." }));
    }
  }
  if (x.evalue) {
    sec.appendChild(Object.assign(document.createElement("p"), {
      className: "verdict-note",
      textContent: "Schéma " + x.schema + ", contrôlé sur ce poste" +
        (x.valide_sur === "reindente" ? ", sur la version réindentée du XML faute d'avoir pu lire l'original. " : ", sur le XML d'origine. ") +
        (x.lignes_origine ? "Les lignes sont celles du fichier d'origine, pas de l'onglet « XML brut »" : "Les lignes sont celles de l'onglet « XML brut »") +
        " ; les messages viennent du validateur, en anglais.",
    }));
  }
  return sec;
}

function schematronSection(f) {
  const r = f.result;
  if (!r || (r.format !== "CII" && r.format !== "UBL")) return null;
  const sch = r.schematron;
  const sec = document.createElement("details");
  sec.id = "schematron-rules";
  sec.className = "section controls";
  sec.open = !!(sch && sch.non_conformes > 0);

  const sum = document.createElement("summary");
  sum.className = "section-title";

  if (!sch) {
    sum.innerHTML = '<span class="ctl-chip ctl-info">Schematron officiel</span> Évaluation officielle en arrière-plan…';
    sec.appendChild(sum);
    const p = document.createElement("p");
    p.className = "notice";
    p.textContent = "Les règles Schematron officielles EN 16931 de la Commission européenne sont en cours d'évaluation sur ce poste…";
    sec.appendChild(p);
    return sec;
  }

  if (sch.erreur_moteur) {
    sum.innerHTML = '<span class="ctl-chip ctl-alerte">Schematron officiel</span> Évaluation impossible : ' + esc(sch.erreur_moteur);
    sec.appendChild(sum);
    return sec;
  }

  const unevaluated = sch.non_evaluables || [];
  const etat = sch.non_conformes ? "ecart" : unevaluated.length ? "alerte" : "conforme";
  const badgeTxt = sch.non_conformes
    ? sch.non_conformes + " règle" + (sch.non_conformes > 1 ? "s" : "") + " bloquante" + (sch.non_conformes > 1 ? "s" : "") + " non respectée" + (sch.non_conformes > 1 ? "s" : "")
    : unevaluated.length ? unevaluated.length + " règle" + (unevaluated.length > 1 ? "s" : "") + " non évaluable" + (unevaluated.length > 1 ? "s" : "")
    : "Aucune règle bloquante enfreinte";
  sum.innerHTML = '<span class="ctl-chip ctl-' + etat + '">Schematron officiel CEN</span> ' +
    esc(badgeTxt) + (sch.avertissements ? ' · ' + sch.avertissements + ' avertissement' + (sch.avertissements > 1 ? "s" : "") : '');
  sec.appendChild(sum);

  if (sch.erreurs && sch.erreurs.length) {
    sec.appendChild(schematronTable(sch.erreurs));
  } else {
    const okP = document.createElement("p");
    okP.className = "notice";
    okP.style.color = "var(--ok)";
    okP.textContent = unevaluated.length ? "Aucune règle officielle enfreinte parmi celles qui ont pu être évaluées."
      : "Aucune règle du Schematron officiel n'est enfreinte.";
    if (unevaluated.length) okP.style.color = "";
    sec.appendChild(okP);
  }
  schematronTail(sec, sch, unevaluated);
  if (sch.br_fr && sch.br_fr.non_conformes) sec.open = true;
  return sec;
}

/* Tableau des règles Schematron non respectées : identifiant, texte, emplacement. */
function schematronTable(errors) {
  const table = document.createElement("table");
  table.className = "ctl-table";
  const tbody = document.createElement("tbody");
  for (const err of errors) {
    const tr = document.createElement("tr");
    tr.className = "ctl-row ctl-" + (err.flag === "warning" ? "alerte" : "ecart");
    const tdState = document.createElement("td");
    tdState.className = "ctl-etat";
    tdState.appendChild(Object.assign(document.createElement("span"), {
      className: "ctl-chip ctl-" + (err.flag === "warning" ? "alerte" : "ecart"),
      textContent: err.id || (err.flag === "warning" ? "Avertissement" : "Non-conforme"),
    }));
    const tdText = document.createElement("td");
    tdText.className = "ctl-rule";
    tdText.textContent = err.texte;
    if (err.location) {
      tdText.appendChild(Object.assign(document.createElement("span"), {
        className: "note",
        textContent: "Emplacement : " + err.location,
      }));
    }
    tr.appendChild(tdState);
    tr.appendChild(tdText);
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  return table;
}

function schematronTail(sec, sch, unevaluated) {
  if (unevaluated.length) {
    // Une valeur illisible (montant non numérique, par exemple) empêche d'évaluer certaines règles.
    sec.appendChild(Object.assign(document.createElement("p"), {
      className: "notice", textContent: "Règles non évaluables sur ce document, une valeur du XML n'ayant pas le format attendu : " + unevaluated.join(", ") + ".",
    }));
  }

  const foot = document.createElement("p");
  foot.className = "verdict-note";
  // Profils Factur-X MINIMUM, BASIC WL, BASIC et EXTENDED : règles Factur-X du profil annoncé.
  // Profil français EXTENDED-CTC-FR : règles du FNFE-MPE pour la réforme.
  const facturX = /^Factur-X/.test(sch.jeu_regles || "");
  const france = /^EXTENDED-CTC-FR/.test(sch.jeu_regles || "");
  foot.textContent = (facturX
    ? "Règles Schematron officielles " + sch.jeu_regles + ", v" + (sch.version_regles || "") + " (FNFE-MPE et FeRD, Apache 2.0), évaluées sur ce poste"
    : france
    ? "Règles Schematron officielles du profil français EXTENDED-CTC-FR, v" + (sch.version_regles || "") + " (FNFE-MPE, dépôt France_RFE), évaluées sur ce poste"
    : "Règles Schematron officielles EN 16931 v" + (sch.version_regles || "") + " de la Commission européenne (EUPL 1.2), évaluées sur ce poste") +
    (sch.regles_declenchees ? " : " + sch.regles_declenchees + " contextes examinés" : "") +
    (sch.depuis_cache ? ", résultat repris de la bibliothèque" : sch.duree_ms != null ? " en " + sch.duree_ms + " ms" : "") + "." +
    (sch.sur_xml_reindente ? " Le moteur n'a pas pu lire le XML d'origine : c'est sa version réindentée qui a été évaluée." : "");
  sec.appendChild(foot);

  // Règles françaises BR-FR : évaluées à part, sans effet sur le verdict du Schematron.
  const fr = sch.br_fr;
  if (sch.br_fr_perimetre) {
    const perimeter = document.createElement("p");
    perimeter.className = "verdict-note";
    perimeter.textContent = "Périmètre BR-FR : " + sch.br_fr_perimetre.raison + ". " + sch.br_fr_perimetre.calendrier;
    sec.appendChild(perimeter);
  }
  if (fr) {
    const nonEval = fr.non_evaluables || [];
    const verdict = invoiceVerdicts({ status: "ok", result: { synthese: {}, schematron: sch } }).france;
    const head = document.createElement("p");
    head.id = "br-fr-rules";
    head.className = "notice";
    head.innerHTML = '<span class="ctl-chip ctl-' + verdict.etat + '">Règles françaises BR-FR</span> ' +
      esc(fr.non_conformes ? fr.non_conformes + " règle" + (fr.non_conformes > 1 ? "s" : "") + " de la réforme française non respectée" + (fr.non_conformes > 1 ? "s" : "")
        : nonEval.length ? nonEval.length + " règle" + (nonEval.length > 1 ? "s" : "") + " non évaluable" + (nonEval.length > 1 ? "s" : "") + " : " + nonEval.join(", ")
        : verdict.etat === "conforme" ? "Toutes les règles de la réforme française sont respectées" : "Règles françaises non évaluées");
    sec.appendChild(head);
    if (fr.erreurs && fr.erreurs.length) sec.appendChild(schematronTable(fr.erreurs));
    sec.appendChild(Object.assign(document.createElement("p"), {
      className: "verdict-note",
      textContent: "Règles BR-FR v" + fr.version + " (FNFE-MPE, norme XP Z12-012), évaluées à titre technique. Le statut B2B, les exemptions et la taille de l'entreprise restent à confirmer ; ces règles ne changent pas celui du Schematron.",
    }));
  }
}

function renderData(f) {
  const pane = byId("tab-data");
  pane.innerHTML = "";
  const r = f.result;

  if (r.warnings && r.warnings.length) {
    const w = document.createElement("div");
    w.className = "warnings";
    for (const msg of r.warnings) {
      const d = document.createElement("div");
      d.className = "warning";
      d.textContent = msg;
      w.appendChild(d);
    }
    pane.appendChild(w);
  }

  if (r.summary && r.summary.length) {
    const cards = document.createElement("div");
    cards.className = "cards";
    const titles = { "Date d'émission": "date", "Échéance": "echeance", "Total HT": "ht", "Total TVA": "tva", "Total TTC": "ttc", "À payer": "a_payer" };
    const summaries = [...r.summary];
    if (!summaries.some(s => s.title === "Total TVA") && r.synthese?.provenance?.tva) {
      summaries.push({ title: "Total TVA", value: r.synthese.tva + (r.synthese.devise ? " " + r.synthese.devise : "") });
    }
    for (const s of summaries) {
      const c = document.createElement("div");
      c.className = "card";
      const money = /HT|TTC|TVA|payer|EUR|€|\d/.test(s.value) &&
        /HT|TTC|TVA|payer/i.test(s.title);
      c.innerHTML =
        '<div class="card-title">' + esc(s.title) + "</div>" +
        '<div class="card-value' + (money ? " money" : "") + '">' + esc(s.value) + "</div>";
      const key = titles[s.title], proof = r.synthese?.provenance?.[key];
      if (proof) {
        c.dataset.provenance = key;
        const details = document.createElement("details");
        details.className = "provenance-details";
        details.appendChild(Object.assign(document.createElement("summary"), { textContent: "Voir la provenance" }));
        details.appendChild(Object.assign(document.createElement("p"), {
          textContent: (proof.type === "calculated" ? "Valeur calculée : " : proof.type === "extracted" ? "Valeur extraite : " : "Valeur exacte du XML : ") + proof.value,
        }));
        if (proof.formula) details.appendChild(Object.assign(document.createElement("p"), { textContent: "Calcul : " + proof.formula }));
        if (proof.path) details.appendChild(provenanceSourceLink(proof.path, "Champ source"));
        for (const input of proof.inputs || []) if (input.path) details.appendChild(provenanceSourceLink(input.path, input.value));
        if (proof.comparison) {
          details.appendChild(Object.assign(document.createElement("p"), {
            textContent: "Contrôle : " + proof.comparison.formula + " = " + proof.comparison.expected,
          }));
          for (const input of proof.comparison.inputs || []) {
            const label = input.label + " : " + input.value + (input.note ? " (" + input.note + ")" : "");
            details.appendChild(input.path ? provenanceSourceLink(input.path, label) :
              Object.assign(document.createElement("p"), { textContent: label }));
          }
        }
        c.appendChild(details);
      }
      cards.appendChild(c);
    }
    pane.appendChild(cards);
  }

  const taxProofs = r.synthese?.provenance_tva_taux || [];
  if (taxProofs.length) {
    const section = Object.assign(document.createElement("section"), { id: "tax-breakdown", className: "section" });
    section.appendChild(Object.assign(document.createElement("h3"), { textContent: "Ventilation de TVA" }));
    for (const [index, proof] of taxProofs.entries()) section.appendChild(taxBreakdownPanel(proof, index));
    pane.appendChild(section);
  }

  if (r.synthese) pane.appendChild(verdictStrip(f));
  pane.appendChild(anomalyCenter(f));
  const controls = controlsSection(f);
  if (controls) pane.appendChild(controls);
  const rules = rulesSection(f);
  if (rules) pane.appendChild(rules);
  const sch = schematronSection(f);
  if (sch) pane.appendChild(sch);
  const xsd = xsdSection(f);
  if (xsd) pane.appendChild(xsd);
  pane.appendChild(reviewPanel(f));

  if (r.lines && r.lines.length) {
    const sec = document.createElement("div");
    sec.className = "section lines-section";
    const head = document.createElement("div");
    head.id = "lines-head";
    head.className = "lines-head";
    head.appendChild(Object.assign(document.createElement("div"), {
      className: "lines-title",
      textContent: "Lignes de facture",
    }));
    const tools = document.createElement("div");
    tools.className = "lines-tools";
    const search = document.createElement("input");
    search.id = "lines-search";
    search.className = "lines-search";
    search.type = "search";
    search.placeholder = "Rechercher une référence ou un texte…";
    search.value = f.linesQuery || "";
    const count = document.createElement("span");
    count.id = "lines-count";
    count.className = "lines-count";
    const pointedCount = document.createElement("span");
    pointedCount.id = "lines-pointed-count";
    pointedCount.className = "lines-pointed-count";
    const clearBtn = document.createElement("button");
    clearBtn.id = "btn-clear-pointage";
    clearBtn.className = "btn btn-ghost btn-sm";
    clearBtn.type = "button";
    clearBtn.textContent = "Effacer les pointages";
    const filterBtn = document.createElement("button");
    filterBtn.id = "btn-lines-filter";
    filterBtn.className = "btn btn-sm";
    filterBtn.type = "button";
    tools.appendChild(search);
    tools.appendChild(count);
    tools.appendChild(pointedCount);
    const exportBtn = document.createElement("button");
    exportBtn.id = "btn-lines-export";
    exportBtn.className = "btn btn-sm";
    exportBtn.type = "button";
    exportBtn.textContent = "Exporter CSV";
    exportBtn.title = "Enregistrer les lignes affichées dans un fichier CSV (Excel)";
    exportBtn.addEventListener("click", () => exportLinesCsv(f, exportBtn));
    const copyBtn = document.createElement("button");
    copyBtn.id = "btn-lines-copy";
    copyBtn.className = "btn btn-sm";
    copyBtn.type = "button";
    copyBtn.textContent = "Copier";
    copyBtn.title = "Copier les lignes affichées, à coller dans un tableur";
    copyBtn.addEventListener("click", () => copyText(linesTsv(f), copyBtn));
    tools.appendChild(filterBtn);
    tools.appendChild(exportBtn);
    const excel = Object.assign(document.createElement("button"), { id: "btn-lines-excel", type: "button", className: "btn btn-sm", textContent: "Exporter Excel" });
    excel.addEventListener("click", () => exportLinesExcel(f, excel));
    tools.appendChild(excel);
    tools.appendChild(copyBtn);
    tools.appendChild(clearBtn);
    head.appendChild(tools);
    sec.appendChild(head);
    const wrap = document.createElement("div");
    wrap.className = "table-wrap";
    wrap.id = "lines-table-wrap";
    sec.appendChild(wrap);
    pane.appendChild(sec);

    const FILTERS = ["all", "pointed", "unpointed"];
    const FILTER_LABELS = { all: "Afficher : Toutes", pointed: "Afficher : Pointées", unpointed: "Afficher : Non pointées" };
    const nextFilter = (cur) => FILTERS[(FILTERS.indexOf(cur) + 1) % FILTERS.length];
    const setFilterBtn = () => {
      const mode = f.linesFilter || "all";
      filterBtn.textContent = FILTER_LABELS[mode];
      filterBtn.classList.toggle("filter-active", mode !== "all");
      filterBtn.title = "Basculer l'affichage — suivant : " + FILTER_LABELS[nextFilter(mode)].replace("Afficher : ", "");
    };
    setFilterBtn();
    filterBtn.addEventListener("click", () => {
      f.linesFilter = nextFilter(f.linesFilter || "all");
      setFilterBtn();
      renderLinesOnly(f);
    });
    search.addEventListener("input", () => {
      f.linesQuery = search.value;
      renderLinesOnly(f);
    });
    clearBtn.addEventListener("click", () => {
      if (!f.pointed.size) return;
      if (confirm("Effacer tous les pointages de cette facture ?")) {
        clearPointage(f);
        renderLinesOnly(f);
      }
    });
    renderLinesOnly(f);
  }

  for (const section of r.sections || []) {
    if (!section.rows || !section.rows.length) continue;
    const sec = document.createElement("div");
    sec.className = "section";
    sec.innerHTML = '<div class="section-head">' + esc(section.name) + "</div>";
    const wrap = document.createElement("div");
    wrap.className = "table-wrap";
    wrap.appendChild(kvTable(section.rows));
    sec.appendChild(wrap);
    pane.appendChild(sec);
  }

  if (!r.synthese && !r.lines?.length && !(r.sections || []).some((s) => s.rows?.length)) {
    pane.innerHTML = '<div class="notice">Aucune donnée structurée reconnue — consultez les onglets « XML complet » et « XML brut ».</div>';
    pane.appendChild(reviewPanel(f));
  }
}

/* ---------------- onglet XML complet ---------------- */

function renderXmlTable(f) {
  const rows = f.result.rows || [];
  const tbody = byId("xml-table").querySelector("tbody");
  tbody.innerHTML = "";
  const frag = document.createDocumentFragment();
  rows.forEach((row, i) => {
    const tr = document.createElement("tr");
    tr.dataset.path = row.path;
    tr.dataset.search = (row.tag + " " + row.title + " " + (row.value || "") + " " + row.path).toLowerCase();
    const tdIdx = document.createElement("td");
    tdIdx.className = "col-idx";
    tdIdx.textContent = String(i + 1);
    const tdPath = document.createElement("td");
    tdPath.className = "col-path";
    tdPath.textContent = row.path;
    tdPath.title = row.path;
    const tdTitle = document.createElement("td");
    tdTitle.textContent = row.title;
    const tdValue = document.createElement("td");
    if (row.binary) tdValue.classList.add("binary");
    tdValue.classList.add("cell");
    tdValue.dataset.title = row.title;
    tdValue.dataset.path = row.path;
    tdValue.dataset.value = row.value || "";
    const shown = row.truncated && !row.binary && row.value.length > 300
      ? row.value.slice(0, 300) + " …"
      : (row.value || "—");
    tdValue.textContent = shown;
    if (row.attrs && Object.keys(row.attrs).length) {
      const n = document.createElement("span");
      n.className = "note";
      n.textContent = Object.entries(row.attrs).map(([k, v]) => k + "=" + v).join("  ");
      tdValue.appendChild(n);
    }
    tr.appendChild(tdIdx);
    tr.appendChild(tdPath);
    tr.appendChild(tdTitle);
    tr.appendChild(tdValue);
    frag.appendChild(tr);
  });
  tbody.appendChild(frag);
  byId("xml-count").textContent = rows.length + " valeurs";
}

function filterXmlTable(query) {
  const q = (query || "").trim().toLowerCase();
  let visible = 0;
  document.querySelectorAll("#xml-table tbody tr").forEach((tr) => {
    const ok = !q || tr.dataset.search.includes(q);
    tr.hidden = !ok;
    if (ok) visible++;
  });
  byId("xml-count").textContent = q ? visible + " / " + (visible + document.querySelectorAll("#xml-table tbody tr[hidden]").length) + " valeurs" : "";
}

/* ---------------- onglet XML brut ---------------- */

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* Recherche transversale : une occurrence par élément XML. */
let quickTimer, quickWorker, quickDeadline;
let quickHits = [], quickIndex = -1;
function quickButtons() {
  byId("quick-prev").disabled = byId("quick-next").disabled = !quickHits.length;
}
function clearQuickHighlight() {
  document.querySelectorAll(".quick-hit").forEach(el => el.classList.remove("quick-hit"));
}
function scheduleQuickSearch() {
  clearTimeout(quickTimer);
  clearTimeout(quickDeadline);
  if (quickWorker) quickWorker.terminate();
  quickWorker = null;
  quickHits = []; quickIndex = -1;
  quickButtons();
  clearQuickHighlight();
  const query = byId("quick-query").value;
  const currentOnly = byId("quick-scope").value === "current";
  if (currentOnly && !getFile(state.selected)) {
    byId("quick-status").textContent = "Sélectionnez un document ou choisissez « Tous les documents ouverts ».";
    return;
  }
  byId("quick-status").textContent = query ? "Recherche…" :
    (currentOnly ? "Document sélectionné" : "Tous les documents ouverts") + " · données XML";
  if (query) quickTimer = setTimeout(runQuickSearch, 200);
}
function runQuickSearch() {
  const worker = quickWorker = new Worker("search-worker.js");
  const finish = () => { clearTimeout(quickDeadline); worker.terminate(); quickWorker = null; };
  quickDeadline = setTimeout(() => {
    finish();
    byId("quick-status").textContent = "Recherche trop longue : simplifiez l’expression.";
  }, 2000);
  worker.onerror = () => {
    finish();
    byId("quick-status").textContent = "Recherche indisponible.";
  };
  worker.onmessage = ({ data }) => {
    finish();
    quickHits = data.hits || [];
    quickButtons();
    byId("quick-status").textContent = data.error || "Aucun résultat";
    if (quickHits.length) moveQuickSearch(1);
  };
  worker.postMessage({
    query: byId("quick-query").value, regex: byId("quick-regex").checked,
    files: state.files.filter(f => f.status === "ok" &&
      (byId("quick-scope").value === "all" || f.id === state.selected))
      .map(f => ({ id: f.id, rows: f.result.rows || [] })),
  });
}
function moveQuickSearch(delta) {
  if (!quickHits.length) return;
  quickIndex = (quickIndex + delta + quickHits.length) % quickHits.length;
  const hit = quickHits[quickIndex], f = getFile(hit.id);
  if (!f) { scheduleQuickSearch(); return; }
  // Ne pas relancer la recherche en sélectionnant son propre résultat.
  if (state.selected !== f.id) {
    captureDocumentView();
    state.selected = f.id;
    state.pdfDoc = null; state.pdfSource = null;
    renderFileView();
    renderList(true);
  }
  setTab("xml");
  byId("xml-search").value = "";
  filterXmlTable("");
  clearQuickHighlight();
  const tr = byId("xml-table").tBodies[0].rows[hit.index];
  if (tr) {
    const row = f.result.rows[hit.index];
    // Déplier aussi les valeurs longues pour rendre le texte trouvé visible.
    const cell = tr.cells[3];
    if (cell.firstChild && cell.firstChild.nodeType === Node.TEXT_NODE) cell.firstChild.textContent = row.value || "—";
    tr.classList.add("quick-hit");
    tr.scrollIntoView({ block: "center" });
  }
  byId("quick-status").textContent = `${quickIndex + 1} / ${quickHits.length} éléments · ${f.name}`;
}

function renderRaw(f) {
  const pre = byId("raw-xml");
  const xml = f.result.xml_pretty || "(aucun XML)";
  pre.dataset.base = xml;
  pre.textContent = xml;
}

function highlightRaw(query) {
  const pre = byId("raw-xml");
  const base = pre.dataset.base || "";
  if (!query) {
    pre.textContent = base;
    return;
  }
  const pat = escapeRegExp(esc(query));
  const re = new RegExp(pat, "gi");
  let html = esc(base).replace(re, (m) => "<mark>" + m + "</mark>");
  pre.innerHTML = html;
}

/* ---------------- popover (cellules pointables) ---------------- */

function hidePopover() {
  const p = document.querySelector(".pop");
  if (p) p.remove();
}

function showPopover(anchor) {
  hidePopover();
  const title = anchor.dataset.title || "";
  const path = anchor.dataset.path || "";
  const value = anchor.dataset.value ?? "";
  const div = document.createElement("div");
  div.className = "pop";
  div.innerHTML =
    '<div class="pop-title">' + esc(title || "—") + "</div>" +
    (path ? '<div class="pop-path">' + esc(path) + "</div>" : "") +
    '<pre class="pop-value">' + esc(value || "(vide)") + "</pre>" +
    '<div class="pop-actions">' +
    '<button class="btn" data-act="copy-value">Copier la valeur</button>' +
    (path ? '<button class="btn" data-act="copy-path">Copier le chemin</button>' : "") +
    (path ? '<button class="btn" data-act="goto-xml">Voir dans le XML</button>' : "") +
    "</div>";
  div.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-act]");
    if (!btn) return;
    e.stopPropagation();
    if (btn.dataset.act === "copy-value") copyText(value, btn);
    if (btn.dataset.act === "copy-path") copyText(path, btn);
    if (btn.dataset.act === "goto-xml") gotoXml(path);
  });
  document.body.appendChild(div);
  const r = anchor.getBoundingClientRect();
  const pw = div.offsetWidth;
  const ph = div.offsetHeight;
  let x = Math.min(r.left, window.innerWidth - pw - 10);
  let y = r.bottom + 8;
  if (y + ph > window.innerHeight - 8) y = Math.max(8, r.top - ph - 8);
  x = Math.max(8, x);
  div.style.left = x + "px";
  div.style.top = y + "px";
}

function gotoXml(path) {
  hidePopover();
  setTab("xml");
  requestAnimationFrame(() => {
    const tr = document.querySelector('#xml-table tbody tr[data-path="' + CSS.escape(path) + '"]');
    if (!tr) return;
    tr.classList.remove("flash");
    void tr.offsetWidth;
    tr.classList.add("flash");
    tr.scrollIntoView({ behavior: "smooth", block: "center" });
  });
}

/* ---------------- drag & drop global ---------------- */

function hasFiles(e) {
  return e.dataTransfer && [...(e.dataTransfer.types || [])].includes("Files");
}

function wireDnD() {
  const overlay = byId("drop-overlay");
  let depth = 0;
  window.addEventListener("dragenter", (e) => {
    e.preventDefault();
    if (!hasFiles(e)) return;
    depth++;
    overlay.classList.add("show");
  });
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("dragleave", (e) => {
    if (!hasFiles(e)) return;
    depth = Math.max(0, depth - 1);
    if (depth === 0) overlay.classList.remove("show");
  });
  window.addEventListener("drop", (e) => {
    e.preventDefault();
    depth = 0;
    overlay.classList.remove("show");
    if (e.dataTransfer && e.dataTransfer.files.length) addDropped(e.dataTransfer);
  });
}

/* ---------------- paramètres ---------------- */

const SETTINGS_KEY = "fx-settings";
const THEME_KEY = "fx-theme";   // lu par index.html avant le premier rendu
const SETTING_DEFAULTS = { theme: "jour", density: "normal", defaultTab: "pdf", pdfZoom: "1.25", startup: "restore", library: "on" };
const SETTING_CHOICES = {
  theme: ["jour", "nuit", "auto", "girl"],
  density: ["normal", "compact"],
  defaultTab: ["pdf", "data"],
  startup: ["restore", "home"],
  library: ["on", "off"],
  pdfZoom: ["fit", "0.75", "1", "1.25", "1.5", "2"],
};
const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
const settings = loadSettings();

function loadSettings() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") || {};
    if (!saved.theme) saved.theme = localStorage.getItem(THEME_KEY);
  } catch (e) { /* stockage indisponible */ }
  const out = {};
  for (const key in SETTING_DEFAULTS)
    out[key] = SETTING_CHOICES[key].includes(saved[key]) ? saved[key] : SETTING_DEFAULTS[key];
  return out;
}

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    localStorage.setItem(THEME_KEY, settings.theme);
  } catch (e) { /* stockage indisponible */ }
}

function applyTheme() {
  const name = settings.theme === "auto" ? (darkQuery.matches ? "nuit" : "jour") : settings.theme;
  document.documentElement.setAttribute("data-theme", name);
}

function applyDensity() {
  document.documentElement.setAttribute("data-density", settings.density);
  syncStickyOffsets();
}

function applyPdfZoom() {
  state.fit = settings.pdfZoom === "fit";
  if (!state.fit) {
    state.zoom = parseFloat(settings.pdfZoom);
    byId("pdf-zoom").value = settings.pdfZoom;
  }
  if (!state.pdfDoc) return;
  if (state.fit) fitWidth();
  else renderAllPages(state.pdfDoc);
}

const SETTING_APPLIERS = { theme: applyTheme, density: applyDensity, pdfZoom: applyPdfZoom };

function setSetting(key, value) {
  if (!SETTING_CHOICES[key] || !SETTING_CHOICES[key].includes(value)) return;
  settings[key] = value;
  saveSettings();
  if (SETTING_APPLIERS[key]) SETTING_APPLIERS[key]();
  syncSettingsUI();
}

function syncSettingsUI() {
  document.querySelectorAll(".seg[data-setting] button").forEach((b) => {
    const active = settings[b.parentElement.dataset.setting] === b.dataset.value;
    b.classList.toggle("active", active);
    b.setAttribute("aria-pressed", active ? "true" : "false");
  });
  document.querySelectorAll("select[data-setting]").forEach((sel) => {
    sel.value = settings[sel.dataset.setting];
  });
}

function wireSettings() {
  const dialog = byId("settings-dialog");
  const open = () => { syncSettingsUI(); if (!dialog.open) dialog.showModal(); };
  byId("btn-settings").addEventListener("click", open);
  byId("settings-close").addEventListener("click", () => dialog.close());
  // clic sur le fond assombri = fermer
  dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === ",") { e.preventDefault(); open(); }
  });

  document.querySelectorAll(".seg[data-setting] button").forEach((b) => {
    b.addEventListener("click", () => setSetting(b.parentElement.dataset.setting, b.dataset.value));
  });
  document.querySelectorAll("select[data-setting]").forEach((sel) => {
    sel.addEventListener("change", () => setSetting(sel.dataset.setting, sel.value));
  });
  byId("settings-reset").addEventListener("click", () => {
    for (const key in SETTING_DEFAULTS) setSetting(key, SETTING_DEFAULTS[key]);
  });
  darkQuery.addEventListener("change", () => { if (settings.theme === "auto") applyTheme(); });

  api.appInfo().then((info) => {
    if (!info) return;
    byId("settings-version").textContent = "Factur-X Reader " + info.version;
    byId("settings-pointages-path").textContent = info.pointages;
    byId("settings-data").hidden = false;
    const copy = byId("settings-copy-path");
    copy.addEventListener("click", () => copyText(info.pointages, copy));
  }).catch(() => {});

  applyTheme();
  applyDensity();
  applyPdfZoom();
  syncSettingsUI();
}

/* ---------------- câblage général ---------------- */

function wireUI() {
  byId("add-files").addEventListener("click", () => byId("file-input").click());
  byId("file-input").addEventListener("change", (e) => {
    addFiles(e.target.files);
    e.target.value = "";
  });
  byId("open-folder").addEventListener("click", openFolder);
  document.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "o") return;
    e.preventDefault();
    if (e.shiftKey) openFolder();
    else byId("file-input").click();
  });
  byId("btn-clear-all").addEventListener("click", clearAllFiles);
  byId("btn-fold").addEventListener("click", toggleSidebar);
  try {
    if (localStorage.getItem("fx-sidebar") === "1") toggleSidebar();
  } catch (e) {}

  document.querySelectorAll(".tab").forEach((t) =>
    t.addEventListener("click", () => setTab(t.dataset.tab)));

  byId("pdf-prev").addEventListener("click", () => gotoPage(-1));
  byId("pdf-next").addEventListener("click", () => gotoPage(1));
  byId("pdf-search").addEventListener("input", () => updatePdfSearch());
  byId("pdf-search").addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); gotoPdfSearchMatch(e.shiftKey ? -1 : 1); }
  });
  byId("pdf-search-prev").addEventListener("click", () => gotoPdfSearchMatch(-1));
  byId("pdf-search-next").addEventListener("click", () => gotoPdfSearchMatch(1));
  byId("pdf-fit").addEventListener("click", () => {
    state.fit = true;
    captureDocumentView(); saveWorkspace();
    fitWidth();
  });
  byId("pdf-zoom").addEventListener("change", (e) => {
    state.zoom = parseFloat(e.target.value) || 1.25;
    state.fit = false;
    captureDocumentView(); saveWorkspace();
    if (state.pdfDoc) renderAllPages(state.pdfDoc);
  });
  const mainEl = document.querySelector(".main");
  if (mainEl) {
    mainEl.addEventListener("scroll", () => {
      if (state.pdfDoc && (state.tab === "pdf" || state.tab === "xmlpdf"))
        updatePageInfo(state.pdfDoc);
    });
  }
  window.addEventListener("resize", syncStickyOffsets);

  byId("xml-search").addEventListener("input", (e) => filterXmlTable(e.target.value));
  byId("raw-search").addEventListener("input", (e) => highlightRaw(e.target.value));

  byId("btn-download-pdf").addEventListener("click", () => {
    const f = getFile(state.selected);
    if (!f || !f.result) return;
    const key = (state.pdfSource === "xmlpdf") ? "xml_pdf" : "pdf";
    const pdfObj = f.result[key] || f.result.pdf || f.result.xml_pdf;
    if (!pdfObj) return;
    api.savePdf(pdfObj).catch((e) => alert("Enregistrement du PDF impossible : " + e));
  });

  document.addEventListener("click", (e) => {
    if (e.target.closest(".pop")) return;
    const cell = e.target.closest("td.cell, .cell");
    if (cell) showPopover(cell);
    else hidePopover();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hidePopover();
  });
}

/* ---------------- démarrage ---------------- */

window.addEventListener("DOMContentLoaded", async () => {
  wireSettings();
  wireWatchFolder();
  wireDnD();
  wireUI();
  wireWorkspace();
  wireBatch();
  wireContextMenu();
  wireMenubar();
  wireReview();
  wireDataProtection();
  wireLibrary();
  renderFileView();
  byId("quick-query").addEventListener("input", scheduleQuickSearch);
  byId("quick-regex").addEventListener("change", scheduleQuickSearch);
  byId("quick-scope").addEventListener("change", scheduleQuickSearch);
  byId("quick-prev").addEventListener("click", () => moveQuickSearch(-1));
  byId("quick-next").addEventListener("click", () => moveQuickSearch(1));
  byId("quick-close").addEventListener("click", hideQuickSearch);
  byId("btn-search").addEventListener("click", () => (byId("quick-search").hidden ? showQuickSearch() : hideQuickSearch()));
  byId("quick-query").addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); moveQuickSearch(e.shiftKey ? -1 : 1); }
    if (e.key === "Escape") hideQuickSearch();
  });
  document.addEventListener("keydown", e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "p") { e.preventDefault(); printView(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
      e.preventDefault(); showQuickSearch();
    }
  });
  renderList();
  await initReviews();
  await refreshDataStatus(true);
  refreshLibraryStatus(true);
  try {
    const startup = await api.startupPaths();
    if (startup?.files?.length) { workspaceReady = true; await addPaths(startup); }
    else if (settings.startup === "restore") await resumeWorkspace();
  } catch {
    /* pas de fichiers passés au lancement */
  }
  workspaceReady = true;
  renderWelcome();
  resumeWatchFolder();
});
