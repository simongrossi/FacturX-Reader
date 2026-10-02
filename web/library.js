"use strict";

/* Bibliothèque locale : toutes les factures déjà analysées, entre les sessions.
   Les données viennent de la base tenue par le moteur (bibliotheque.sqlite). */

const library = { query: "", timer: null, token: 0, warned: new Set() };

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
  await addPaths({ files: [row.chemin] });
}

async function renderLibrary() {
  const token = ++library.token;
  const table = byId("library-table");
  const count = byId("library-count");
  let result;
  try { result = await api.librarySearch(library.query); }
  catch (error) {
    if (token !== library.token) return;
    table.replaceChildren();
    count.textContent = "";
    byId("library-empty").hidden = false;
    byId("library-empty").textContent = String((error && error.message) || error);
    return;
  }
  if (token !== library.token) return;
  const rows = (result && result.factures) || [];
  const total = (result && result.total) || 0;
  count.textContent = (rows.length === total ? total + " facture" + (total > 1 ? "s" : "")
    : rows.length + " / " + total + " factures") + (result && result.tronque ? " (1000 premières)" : "");
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
    library.query = e.target.value;
    clearTimeout(library.timer);
    library.timer = setTimeout(renderLibrary, 200);
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
