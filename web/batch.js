"use strict";

/* Tableau multi-factures : une ligne par document ouvert, à partir de la synthèse
   et des contrôles calculés par le moteur. */

const batch = { query: "", filter: "all", sort: { key: "date", dir: 1 } };

const BATCH_COLS = [
  { key: "fichier", title: "Fichier" },
  { key: "vendeur", title: "Vendeur" },
  { key: "numero", title: "N°" },
  { key: "type", title: "Type" },
  { key: "date", title: "Date" },
  { key: "echeance", title: "Échéance" },
  { key: "ht", title: "HT", num: true },
  { key: "tva", title: "TVA", num: true },
  { key: "ttc", title: "TTC", num: true },
  { key: "a_payer", title: "À payer", num: true },
  { key: "devise", title: "Devise" },
  { key: "calculs", title: "Calculs", verdict: true },
  { key: "regles_txt", title: "Règles EN 16931", verdict: true },
  { key: "alertes_txt", title: "Alertes", verdict: true },
  { key: "suivi", title: "Vérification" },
];
const BATCH_MONEY = BATCH_COLS.filter((c) => c.num).map((c) => c.key);

const BATCH_FILTERS = {
  all: () => true,
  ecart: (r) => r.verdicts.calculs.etat === "ecart",
  alerte: (r) => r.verdicts.alertes > 0,
  regles: (r) => r.regles > 0,
  echue: (r) => r.jours != null && r.jours < 0,
  sanstva: (r) => r.lu && !(parseFloat(r.tva) > 0),
  weekend: (r) => r.weekEnd,
  doublon: (r) => r.doublon,
  avoir: (r) => r.avoir,
  erreur: (r) => !r.lu,
};

const batchMoney = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 8 });

function batchRows() {
  const files = state.files.filter((f) => f.status !== "loading");
  // Doublons : même XML, ou même vendeur et même numéro.
  const seen = new Map();
  const keysOf = (f) => {
    const r = f.result, s = r && r.synthese;
    return [r && r.doc_hash && "h:" + r.doc_hash, s && s.numero && s.vendeur && "n:" + s.vendeur + "\u0000" + s.numero]
      .filter(Boolean);
  };
  for (const f of files) for (const k of keysOf(f)) seen.set(k, (seen.get(k) || 0) + 1);

  return files.map((f) => {
    const r = f.result, s = (r && r.synthese) || null;
    const counts = { ecart: 0, alerte: 0, non_verifiable: 0, conforme: 0, info: 0 };
    for (const c of (r && r.controles) || []) counts[c.etat] = (counts[c.etat] || 0) + 1;
    const doublon = keysOf(f).some((k) => seen.get(k) > 1);
    const broken = ((r && r.regles && r.regles.liste) || []).filter((x) => x.etat === "non_conforme");
    const row = {
      f, lu: !!s, counts, doublon, regles: broken.length,
      fichier: f.name,
      vendeur: s ? s.vendeur : "", numero: s ? s.numero : "",
      type: s ? (s.avoir ? "Avoir" : "Facture") : "",
      avoir: !!(s && s.avoir), weekEnd: !!(s && s.week_end),
      date: s ? s.date : "", echeance: s ? s.echeance : "",
      jours: s ? s.jours_echeance : null,
      ht: s ? s.ht : "", tva: s ? s.tva : "", ttc: s ? s.ttc : "", a_payer: s ? s.a_payer : "",
      devise: s ? s.devise : "",
      suivi: f.status === "ok" ? readReview(f).status : "",
      commentaire: f.status === "ok" ? readReview(f).comment : "",
    };
    // Trois verdicts séparés : un calcul cohérent ne dit rien de la conformité à la norme.
    const v = invoiceVerdicts(f, doublon ? 1 : 0);
    row.verdicts = v;
    row.calculs = f.status === "error" ? "Non lue" : !s ? "Structure non reconnue" : v.calculs.court;
    row.regles_txt = s ? v.regles.court : "";
    const others = v.alertes - (doublon ? 1 : 0);
    row.alertes_txt = [others ? others + " alerte" + (others > 1 ? "s" : "") : "", doublon ? "doublon" : ""].filter(Boolean).join(", ");
    row.etatKey = v.calculs.etat;
    row.detail = f.status === "error" ? f.error
      : ((r && r.controles) || []).filter((c) => c.etat === "ecart" || c.etat === "alerte")
        .map((c) => c.regle + (c.ecart ? " (" + c.ecart + ")" : ""))
        .concat([...new Set(broken.map((x) => x.id))]).join(" | ");
    return row;
  });
}

function batchVisibleRows() {
  const q = batch.query.trim().toLowerCase();
  const filter = batch.filter.startsWith("s:") ? (r) => r.suivi === batch.filter.slice(2)
    : BATCH_FILTERS[batch.filter] || BATCH_FILTERS.all;
  let rows = batchRows().filter(filter);
  if (q) rows = rows.filter((r) => [...BATCH_COLS.map((c) => r[c.key]), r.commentaire].join(" ").toLowerCase().includes(q));
  const { key, dir } = batch.sort;
  const col = BATCH_COLS.find((c) => c.key === key);
  if (col) rows.sort((a, b) => {
    const av = a[key], bv = b[key];
    if (!av || !bv) return (av ? -1 : bv ? 1 : 0);   // valeurs vides en dernier
    const cmp = col.num ? parseFloat(av) - parseFloat(bv) : String(av).localeCompare(String(bv), "fr", { numeric: true });
    return cmp * dir;
  });
  return rows;
}

/* Totaux par devise, en centimes entiers ; les avoirs sont déduits. */
function batchTotals(rows) {
  const totals = new Map();
  for (const r of rows) {
    if (!r.lu) continue;
    const t = totals.get(r.devise) || { n: 0, avoirs: 0, ht: 0, tva: 0, ttc: 0, a_payer: 0 };
    t.n++;
    if (r.avoir) t.avoirs++;
    for (const k of BATCH_MONEY) t[k] += (r.avoir ? -1 : 1) * Math.round((parseFloat(r[k]) || 0) * 100);
    totals.set(r.devise, t);
  }
  return totals;
}

function batchExportRows() {
  const table = [[...BATCH_COLS.map((c) => c.title), "Jours avant échéance", "Détail des contrôles", "Commentaire"]];
  for (const r of batchVisibleRows()) {
    table.push([
      ...BATCH_COLS.map((c) => c.num ? String(r[c.key]).replace(".", ",") : String(r[c.key] ?? "")),
      r.jours == null ? "" : String(r.jours), r.detail || "", r.commentaire || "",
    ]);
  }
  return table;
}

function renderBatch() {
  const rows = batchVisibleRows();
  const total = state.files.filter((f) => f.status !== "loading").length;
  byId("batch-count").textContent = rows.length === total ? total + " documents" : rows.length + " / " + total + " documents";

  const table = byId("batch-table");
  table.replaceChildren();
  const thead = table.createTHead();
  const trh = thead.insertRow();
  for (const col of BATCH_COLS) {
    const th = document.createElement("th");
    const sorted = batch.sort.key === col.key;
    th.textContent = col.title + (sorted ? (batch.sort.dir > 0 ? "  ↑" : "  ↓") : "");
    if (col.num) th.classList.add("num");
    if (sorted) th.classList.add("sorted");
    th.title = "Trier par " + col.title;
    th.addEventListener("click", () => {
      batch.sort = sorted ? { key: col.key, dir: -batch.sort.dir } : { key: col.key, dir: 1 };
      renderBatch();
    });
    trh.appendChild(th);
  }
  const tbody = table.createTBody();
  for (const r of rows) {
    const tr = tbody.insertRow();
    tr.className = "batch-row batch-" + r.etatKey;
    tr.title = r.detail || "Ouvrir " + r.fichier;
    tr.addEventListener("click", () => selectFile(r.f.id));
    for (const col of BATCH_COLS) {
      const td = tr.insertCell();
      const v = r[col.key] ?? "";
      td.dataset.value = v;
      if (col.key === "suivi") {
        if (r.f.status !== "ok") continue;
        const select = reviewSelect(r.f);
        select.addEventListener("click", (e) => e.stopPropagation());
        select.addEventListener("change", () => renderBatch());
        td.appendChild(select);
      } else if (col.verdict) {
        const etat = col.key === "calculs" ? r.verdicts.calculs.etat : col.key === "regles_txt" ? r.verdicts.regles.etat : "alerte";
        if (v) td.appendChild(Object.assign(document.createElement("span"), { className: "ctl-chip ctl-" + etat, textContent: v }));
        else td.textContent = "—";
      } else if (col.num) {
        td.classList.add("num");
        td.textContent = v === "" ? "—" : batchMoney.format(parseFloat(v));
      } else if (col.key === "echeance" && r.jours != null && r.jours < 0) {
        td.textContent = v;
        td.appendChild(Object.assign(document.createElement("span"), { className: "note batch-late", textContent: "échue depuis " + -r.jours + " j" }));
      } else {
        td.textContent = v || "—";
      }
    }
  }
  if (!rows.length) {
    const td = tbody.insertRow().insertCell();
    td.colSpan = BATCH_COLS.length;
    td.className = "batch-empty";
    td.textContent = total ? "Aucun document ne correspond au filtre." : "Aucun document ouvert.";
  }

  const tfoot = table.createTFoot();
  for (const [devise, t] of batchTotals(rows)) {
    const tr = tfoot.insertRow();
    const label = tr.insertCell();
    label.colSpan = BATCH_COLS.findIndex((c) => c.num);
    label.textContent = "Total " + (devise || "sans devise") + " — " + t.n + " document" + (t.n > 1 ? "s" : "") +
      (t.avoirs ? ", dont " + t.avoirs + " avoir" + (t.avoirs > 1 ? "s" : "") + " déduit" + (t.avoirs > 1 ? "s" : "") : "");
    for (const k of BATCH_MONEY) {
      const td = tr.insertCell();
      td.className = "num";
      td.dataset.value = (t[k] / 100).toFixed(2);
      td.textContent = batchMoney.format(t[k] / 100);
    }
    tr.insertCell().textContent = devise;
    for (let i = 0; i < 4; i++) tr.insertCell();
  }
}

function showBatch() {
  captureDocumentView();
  state.selected = null;
  state.library = false;
  state.batch = true;
  workspaceScrollTarget = null;
  state.renderToken++;
  state.pdfDoc = null; state.pdfSource = null;
  renderList(); renderFileView();
}

function wireBatch() {
  byId("batch-search").addEventListener("input", (e) => { batch.query = e.target.value; renderBatch(); });
  byId("batch-filter").addEventListener("change", (e) => { batch.filter = e.target.value; renderBatch(); });
  byId("batch-copy").addEventListener("click", (e) =>
    copyText(batchExportRows().map((row) => row.map((v) => v.replace(/[\t\r\n]+/g, " ")).join("\t")).join("\n"), e.currentTarget));
  byId("batch-export").addEventListener("click", async (e) => {
    const btn = e.currentTarget, old = btn.textContent;
    try {
      const csv = "﻿" + batchExportRows().map((row) => row.map(csvCell).join(";")).join("\r\n") + "\r\n";
      if (await api.saveText("factures.csv", csv)) btn.textContent = "Exporté";
    } catch (error) { workspaceNotice("Export impossible : " + ((error && error.message) || error)); }
    setTimeout(() => { btn.textContent = old; }, 1200);
  });
}
