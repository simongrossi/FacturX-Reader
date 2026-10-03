"use strict";

/* Bibliothèque locale : toutes les factures déjà analysées, entre les sessions.
   Les données viennent de la base tenue par le moteur (bibliotheque.sqlite). */

const library = {
  query: "",
  offset: 0,
  timer: null,
  token: 0,
  warned: new Set(),
  dateMin: "",
  dateMax: "",
  montantMin: "",
  montantMax: "",
  fournisseur: "",
};

const LIBRARY_COLS = [
  { key: "date", title: "Date" },
  { key: "vendeur", title: "Vendeur" },
  { key: "numero", title: "N°" },
  { key: "type", title: "Type" },
  { key: "ht", title: "HT", num: true },
  { key: "tva", title: "TVA", num: true },
  { key: "ttc", title: "TTC", num: true },
  { key: "devise", title: "Devise" },
  { key: "lignes", title: "Lignes", num: true, plain: true },
  { key: "vue_le", title: "Vue le" },
  { key: "fichier", title: "Fichier" },
];

/* Une bibliothèque indisponible est signalée une fois, sans gêner la lecture des factures. */
function libraryNotice(message) {
  if (!message || library.warned.has(message)) return;
  library.warned.add(message);
  workspaceNotice(message + " Les factures restent lisibles ; ouvrez les Paramètres pour réinitialiser la bibliothèque.");
}

async function openLibraryInvoice(row) {
  const open = state.files.find((f) => f.result && f.result.doc_hash === row.hash);
  if (open) { selectFile(open.id); return; }
  if (!row.chemin) {
    workspaceNotice("« " + row.fichier + " » a été ajouté par dépôt : son emplacement n'est pas connu. Rouvrez le fichier d'origine.");
    return;
  }
  try { await openLibraryResult(await api.libraryOpen(row.hash)); }
  catch (error) { workspaceNotice(String(error)); }
}

async function openLibraryResult(result) {
  if (!result) return;
  const path = result.replacement_path;
  const name = result.filename || path.split(/[\\/]/).pop();
  await addSources([{ name, source: { key: path, path, name, selection: result.archive_selection }, load: async () => result }]);
}

async function relinkLibraryInvoice(row, button) {
  button.disabled = true;
  try {
    const result = await api.libraryRelink(row.hash);
    if (!result) return;
    workspaceNotice("Fichier retrouvé : empreinte XML vérifiée. Aucun original n’a été copié.");
    await openLibraryResult(result);
  } catch (error) { workspaceNotice(String(error)); }
  finally { button.disabled = false; }
}

async function renderLibrary() {
  const token = ++library.token;
  const table = byId("library-table");
  const count = byId("library-count");
  let result;
  try { result = await api.librarySearch(library.query, {
    dateMin: library.dateMin, dateMax: library.dateMax, fournisseur: library.fournisseur,
    montantMin: library.montantMin === "" ? null : Number(library.montantMin),
    montantMax: library.montantMax === "" ? null : Number(library.montantMax), offset: library.offset,
  }); }
  catch (error) {
    if (token !== library.token) return;
    table.replaceChildren();
    if (byId("library-pagination")) byId("library-pagination").hidden = true;
    count.textContent = "";
    byId("library-empty").hidden = false;
    byId("library-empty").textContent = String((error && error.message) || error);
    return;
  }
  if (token !== library.token) return;
  const rows = (result && result.factures) || [];
  const total = result.total || 0;
  const matching = result.correspondances ?? rows.length;
  library.offset = result.offset || 0;
  const limit = result.limite || 1000;
  count.textContent = matching + " résultat" + (matching > 1 ? "s" : "") + " / " + total + " factures";
  let pager = byId("library-pagination");
  if (!pager) {
    pager = document.createElement("div");
    pager.id = "library-pagination";
    pager.className = "lines-tools";
    table.closest(".section").after(pager);
  }
  pager.replaceChildren();
  pager.hidden = matching <= limit;
  for (const [label, offset, disabled] of [
    ["Précédent", library.offset - limit, library.offset === 0],
    ["Suivant", library.offset + limit, library.offset + rows.length >= matching],
  ]) {
    const button = Object.assign(document.createElement("button"), { type: "button", className: "btn", textContent: label, disabled });
    button.addEventListener("click", () => { library.offset = offset; renderLibrary(); });
    pager.appendChild(button);
  }
  pager.appendChild(Object.assign(document.createElement("span"), {
    textContent: `${library.offset + 1}–${library.offset + rows.length} sur ${matching}`,
  }));
  const empty = byId("library-empty");
  empty.hidden = rows.length > 0;
  empty.textContent = total ? "Aucune facture ne correspond à la recherche."
    : "La bibliothèque est vide : les factures ouvertes y sont ajoutées automatiquement.";

  table.replaceChildren();
  if (!rows.length) return;
  const trh = table.createTHead().insertRow();
  for (const col of LIBRARY_COLS) {
    const th = document.createElement("th");
    th.textContent = col.title;
    if (col.num) th.classList.add("num");
    trh.appendChild(th);
  }
  trh.appendChild(document.createElement("th"));
  const tbody = table.createTBody();
  for (const row of rows) {
    const tr = tbody.insertRow();
    tr.className = "batch-row";
    tr.title = row.chemin || "Emplacement inconnu (fichier ajouté par dépôt)";
    tr.addEventListener("click", () => openLibraryInvoice(row));
    for (const col of LIBRARY_COLS) {
      const td = tr.insertCell();
      let v = col.key === "type" ? (row.avoir ? "Avoir" : "Facture")
        : col.key === "vue_le" ? String(row.vue_le || "").slice(0, 10) : row[col.key] ?? "";
      td.dataset.value = v;
      if (col.num) td.classList.add("num");
      if (col.num && !col.plain) td.textContent = v === "" ? "—" : batchMoney.format(parseFloat(v));
      else td.textContent = v === "" ? "—" : v;
    }
    const action = tr.insertCell();
    action.className = "col-detail";
    const locate = Object.assign(document.createElement("button"), { type: "button", className: "btn btn-sm", textContent: "Retrouver le fichier" });
    locate.setAttribute("aria-label", "Retrouver le fichier " + row.fichier);
    locate.addEventListener("click", (e) => { e.stopPropagation(); relinkLibraryInvoice(row, locate); });
    action.appendChild(locate);
    const remove = Object.assign(document.createElement("button"), { type: "button", className: "icon-btn", textContent: "✕" });
    remove.title = "Retirer de la bibliothèque";
    remove.setAttribute("aria-label", "Retirer " + row.fichier + " de la bibliothèque");
    remove.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirm("Retirer « " + row.fichier + " » de la bibliothèque ?\nLe fichier lui-même n'est pas supprimé.")) return;
      try { await api.libraryRemove(row.hash); } catch (error) { workspaceNotice(String(error)); }
      renderLibrary();
    });
    action.appendChild(remove);
  }
}

function showLibrary() {
  captureDocumentView();
  state.selected = null;
  state.batch = false;
  state.library = true;
  workspaceScrollTarget = null;
  state.renderToken++;
  state.pdfDoc = null; state.pdfSource = null;
  renderList(); renderFileView();
}

/* Historique des prix d'un article chez le fournisseur de la facture (détail d'une ligne). */
async function showPriceHistory(f, idx, box, button) {
  const line = ((f.result.synthese || {}).lignes || [])[idx];
  box.querySelector(".price-history")?.remove();
  const wrap = Object.assign(document.createElement("div"), { className: "price-history" });
  box.appendChild(wrap);
  if (!line || (!line.ref && !line.nom)) { wrap.textContent = "Cet article n'a ni référence ni désignation : pas d'historique."; return; }
  button.disabled = true;
  try {
    const rows = await api.libraryPrices(f.result.doc_hash, line.ref || "", line.nom || "");
    if (!rows || rows.length < 2) {
      wrap.textContent = "Aucune autre facture de ce fournisseur avec cet article dans la bibliothèque.";
      return;
    }
    const table = document.createElement("table");
    table.className = "line-detail-table";
    table.innerHTML = "<thead><tr><th>Date</th><th>Facture</th><th class='num'>Quantité</th><th class='num'>P.U. HT</th><th class='num'>Variation</th></tr></thead>";
    const tbody = table.createTBody();
    let previous = null;
    for (const row of rows) {
      const tr = tbody.insertRow();
      if (row.courante) tr.className = "price-current";
      const price = parseFloat(row.pu);
      const change = previous && !isNaN(price) ? ((price - previous) / previous) * 100 : null;
      const cells = [row.date, row.numero + (row.courante ? " (cette facture)" : ""), row.qte, row.pu + (row.devise ? " " + row.devise : ""),
        change == null || Math.abs(change) < 0.05 ? "—" : (change > 0 ? "+" : "") + change.toFixed(1).replace(".", ",") + " %"];
      cells.forEach((text, i) => {
        const td = tr.insertCell();
        td.textContent = text || "—";
        if (i >= 2) td.classList.add("num");
        if (i === 4 && change != null && Math.abs(change) >= 0.05) td.classList.add(change > 0 ? "price-up" : "price-down");
      });
      if (!isNaN(price) && price !== 0) previous = price;
    }
    wrap.appendChild(table);
  } catch (error) {
    wrap.textContent = String((error && error.message) || error);
  } finally { button.disabled = false; }
}

async function refreshLibraryStatus(warn) {
  let status;
  try { status = await api.libraryStatus(); } catch { return; }
  if (!status || typeof status.ok !== "boolean") return;
  const text = byId("library-status-text");
  text.className = "setting-help" + (status.ok ? "" : " data-status-error");
  text.textContent = status.ok
    ? status.factures + " facture" + (status.factures > 1 ? "s" : "") + " enregistrée" + (status.factures > 1 ? "s" : "") + " · " + status.chemin
    : status.erreur;
  byId("library-reset").hidden = status.ok;
  byId("library-clear").hidden = !status.ok;
  if (warn && !status.ok) libraryNotice(status.erreur);
}

function wireLibrary() {
  byId("library-search").addEventListener("input", (e) => {
    library.offset = 0;
    library.query = e.target.value;
    clearTimeout(library.timer);
    library.timer = setTimeout(renderLibrary, 200);
  });
  const dateFrom = byId("library-date-from");
  if (dateFrom) dateFrom.addEventListener("change", (e) => { library.dateMin = e.target.value; library.offset = 0; renderLibrary(); });
  const dateTo = byId("library-date-to");
  if (dateTo) dateTo.addEventListener("change", (e) => { library.dateMax = e.target.value; library.offset = 0; renderLibrary(); });
  const amtMin = byId("library-amount-min");
  if (amtMin) amtMin.addEventListener("input", (e) => { library.montantMin = e.target.value; library.offset = 0; renderLibrary(); });
  const amtMax = byId("library-amount-max");
  if (amtMax) amtMax.addEventListener("input", (e) => { library.montantMax = e.target.value; library.offset = 0; renderLibrary(); });
  const seller = byId("library-seller");
  if (seller) seller.addEventListener("input", (e) => { library.fournisseur = e.target.value.trim(); library.offset = 0; renderLibrary(); });
  const resetBtn = byId("library-reset-filters");
  if (resetBtn) resetBtn.addEventListener("click", () => {
    library.offset = 0;
    library.dateMin = "";
    library.dateMax = "";
    library.montantMin = "";
    library.montantMax = "";
    library.fournisseur = "";
    if (dateFrom) dateFrom.value = "";
    if (dateTo) dateTo.value = "";
    if (amtMin) amtMin.value = "";
    if (amtMax) amtMax.value = "";
    if (seller) seller.value = "";
    renderLibrary();
  });
  byId("btn-settings").addEventListener("click", () => refreshLibraryStatus(false));
  byId("library-clear").addEventListener("click", async () => {
    if (!confirm("Vider la bibliothèque ?\nLes fichiers, les pointages et le suivi ne sont pas touchés ; l'historique des IBAN et des prix repart de zéro.")) return;
    try { await api.libraryClear(); } catch (error) { workspaceNotice(String(error)); }
    await refreshLibraryStatus(false);
    if (state.library) renderLibrary();
  });
  byId("library-reset").addEventListener("click", async () => {
    try {
      await api.libraryReset();
      library.warned.clear();
      workspaceNotice("Bibliothèque réinitialisée. La base illisible a été conservée à côté.");
    } catch (error) { workspaceNotice(String(error)); }
    await refreshLibraryStatus(false);
    if (state.library) renderLibrary();
  });
}
