"use strict";

/* Échéancier indicatif des documents ouverts. Aucun état de paiement n'est déduit. */
const schedule = { status: "all", currency: "all" };

function scheduleDate(value) {
  const raw = String(value || "").trim();
  const match = /^(\d{4})-?(\d{2})-?(\d{2})(?:$|T)/.exec(raw);
  if (!match) return "";
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(+year, +month - 1, +day));
  return date.getUTCFullYear() === +year && date.getUTCMonth() === +month - 1 && date.getUTCDate() === +day
    ? year + "-" + month + "-" + day : "";
}

function scheduleCents(value) {
  return decimalCents(value);
}

function scheduleToday() {
  const now = new Date();
  return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0")].join("-");
}

function scheduleEntries(today = scheduleToday()) {
  const hashes = new Set();
  return state.files.filter(f => {
    if (f.status !== "ok" || !f.result?.synthese) return false;
    const hash = f.result.doc_hash;
    if (!hash) return true;
    if (hashes.has(hash)) return false;
    hashes.add(hash);
    return true;
  }).map(f => {
    const s = f.result.synthese, credit = !!s.avoir;
    // Un avoir porte une réduction, pas un décaissement. Son TTC est sa valeur, même sans montant « à payer ».
    const cents = scheduleCents(credit ? s.ttc : s.a_payer);
    const due = scheduleDate(s.echeance);
    const supplierKey = s.vendeur_tva || s.vendeur_id_legal || s.vendeur || f.id;
    const probable = [...duplicateChecks(f), ...(f.result.controles || [])]
      .some(check => check.famille === "historique" && check.regle.startsWith("Doublon probable"));
    const kind = probable ? "review" : credit ? "credit" : "invoice";
    return { f, filename: f.name, seller: s.vendeur || "", number: s.numero || "", currency: s.devise || "",
      supplierKey, kind, credit, cents: cents == null ? null : credit ? -(cents < 0n ? -cents : cents) : cents, due,
      status: !due ? "undated" : due < today ? "overdue" : due === today ? "today" : "upcoming" };
  }).sort((a, b) => (a.due || "9999-99-99").localeCompare(b.due || "9999-99-99") ||
    a.currency.localeCompare(b.currency, "fr") || a.filename.localeCompare(b.filename, "fr"));
}

function scheduleGroups(entries) {
  const groups = new Map();
  for (const entry of entries) {
    const seller = entry.kind === "credit" ? entry.seller : "";
    const due = entry.kind === "credit" ? "" : entry.due;
    const key = JSON.stringify([entry.kind, due, entry.currency, entry.kind === "credit" ? entry.supplierKey : ""]);
    if (!groups.has(key)) groups.set(key, { due, seller, kind: entry.kind, currency: entry.currency,
      status: entry.status, entries: [], total: 0n, known: 0, missing: 0 });
    const group = groups.get(key);
    group.entries.push(entry);
    if (entry.cents == null) group.missing++;
    else { group.total += entry.cents; group.known++; }
  }
  return [...groups.values()];
}

function scheduleVisible(entries = scheduleEntries()) {
  return entries.filter(entry => (schedule.status === "all" || entry.status === schedule.status) &&
    (schedule.currency === "all" || entry.currency === schedule.currency));
}

function scheduleMoney(cents) {
  return decimalCentsFormat(cents);
}

function scheduleDateLabel(due) {
  return due ? due.slice(8, 10) + "/" + due.slice(5, 7) + "/" + due.slice(0, 4) : "Sans échéance";
}

function scheduleStatusLabel(status) {
  return { overdue: "Échéance dépassée", today: "Échéance aujourd’hui", upcoming: "À venir", undated: "Sans échéance" }[status];
}

function scheduleCount(n, singular, plural = singular + "s") {
  return n + " " + (n > 1 ? plural : singular);
}

function renderSchedule() {
  if (!state.batch || state.selected || byId("batch-view").hidden) return;
  const entries = scheduleEntries();
  if (schedule.currency !== "all" && !entries.some(entry => entry.currency === schedule.currency)) schedule.currency = "all";
  const visible = scheduleVisible(entries), groups = scheduleGroups(visible);
  const summary = byId("schedule-summary");
  summary.replaceChildren();
  const totals = new Map();
  const readable = state.files.filter(f => f.status === "ok" && f.result?.synthese).length;
  const copies = readable - entries.length;
  const missing = state.files.length - readable;
  for (const entry of entries) {
    const t = totals.get(entry.currency) || { total: 0n, known: 0, missing: 0, credits: 0, review: 0 };
    if (entry.kind === "credit") t.credits++;
    else if (entry.kind === "review") t.review++;
    else if (entry.cents == null) t.missing++;
    else { t.known++; t.total += entry.cents; }
    totals.set(entry.currency, t);
  }
  const overview = Object.assign(document.createElement("p"), { className: "verdict-note",
    textContent: scheduleCount(entries.length, "document") + " avec synthèse" +
      " · " + scheduleCount(entries.filter(e => e.status === "overdue" && e.kind === "invoice").length, "échéance dépassée", "échéances dépassées") +
      " · " + entries.filter(e => !e.due).length + " sans échéance" +
      (copies ? " · " + scheduleCount(copies, "copie exclue", "copies exclues") : "") +
      (missing ? " · " + scheduleCount(missing, "document") + " sans synthèse" : "") });
  summary.appendChild(overview);
  for (const [currency, total] of totals) {
    summary.appendChild(Object.assign(document.createElement("div"), { className: "schedule-total",
      textContent: (currency || "Sans devise") + " · montant facturé à échéance " +
        (total.known ? scheduleMoney(total.total) : "indisponible") +
        " · " + scheduleCount(total.credits, "avoir non affecté", "avoirs non affectés") +
        " · " + scheduleCount(total.review, "pièce à arbitrer", "pièces à arbitrer") +
        (total.missing ? " · " + scheduleCount(total.missing, "montant indisponible", "montants indisponibles") : "") }));
  }
  const currencySelect = byId("schedule-currency");
  const currencyOptions = [...totals.keys()].sort((a, b) => a.localeCompare(b, "fr"));
  currencySelect.replaceChildren(Object.assign(document.createElement("option"), { value: "all", textContent: "Toutes les devises" }),
    ...currencyOptions.map(currency => Object.assign(document.createElement("option"), { value: currency,
      textContent: currency || "Sans devise" })));
  currencySelect.value = schedule.currency;
  byId("schedule-count").textContent = visible.length + " / " + entries.length + " documents · " + scheduleCount(groups.length, "groupe");
  const container = byId("schedule-groups");
  container.replaceChildren();
  if (!visible.length) container.appendChild(Object.assign(document.createElement("p"), { className: "notice",
    textContent: entries.length ? "Aucun document ne correspond aux filtres de l’échéancier." : "Aucune facture avec synthèse ouverte." }));
  for (const group of groups) {
    const block = Object.assign(document.createElement("article"), { className: "schedule-group" });
    const head = Object.assign(document.createElement("div"), { className: "schedule-group-head" });
    head.appendChild(Object.assign(document.createElement("strong"), { textContent: (group.kind === "credit" ? "Avoirs non affectés · " + (group.seller || "Vendeur inconnu")
      : group.kind === "review" ? "Doublons probables à arbitrer · " + scheduleDateLabel(group.due)
      : scheduleDateLabel(group.due)) + " · " + (group.currency || "Sans devise") }));
    if (group.kind !== "credit") head.appendChild(Object.assign(document.createElement("span"), { className: "schedule-status schedule-" + group.status,
      textContent: scheduleStatusLabel(group.status) }));
    head.appendChild(Object.assign(document.createElement("span"), { textContent: scheduleCount(group.entries.length, "document") + (group.kind === "review" ? "" : " · total " +
      (group.known ? scheduleMoney(group.total) : "indisponible")) +
      (group.missing ? " · " + scheduleCount(group.missing, "montant indisponible", "montants indisponibles") : "") }));
    block.appendChild(head);
    const list = Object.assign(document.createElement("div"), { className: "schedule-items" });
    for (const entry of group.entries) {
      const item = Object.assign(document.createElement("div"), { className: "schedule-item" });
      const open = Object.assign(document.createElement("button"), { type: "button", className: "btn btn-sm",
        textContent: entry.filename + (entry.number ? " · " + entry.number : "") });
      open.addEventListener("click", () => selectFile(entry.f.id));
      item.appendChild(open);
      item.appendChild(Object.assign(document.createElement("span"), { textContent: entry.seller || "Vendeur inconnu" }));
      item.appendChild(Object.assign(document.createElement("span"), { textContent: entry.kind === "review" ? "À arbitrer" : entry.credit ? "Avoir" : "Facture" }));
      item.appendChild(Object.assign(document.createElement("strong"), { textContent: entry.cents == null ? "Montant indisponible" :
        (entry.cents < 0n ? "−" : "") + scheduleMoney(entry.cents < 0n ? -entry.cents : entry.cents) + " " + (entry.currency || "") }));
      list.appendChild(item);
    }
    block.appendChild(list); container.appendChild(block);
  }
}

function scheduleExportRows() {
  const entries = scheduleVisible(), groups = scheduleGroups(entries);
  const rows = [["Ligne", "Échéance", "Devise", "Situation", "Fichier", "Fournisseur", "Numéro", "Type", "Montant signé", "Règlement"]];
  for (const group of groups) {
    for (const entry of group.entries) rows.push(["Document", entry.due, entry.currency, scheduleStatusLabel(entry.status),
      entry.filename, entry.seller, entry.number, entry.kind === "review" ? (entry.credit ? "Avoir à arbitrer" : "Facture à arbitrer") : entry.credit ? "Avoir" : "Facture",
      entry.cents == null ? "" : decimalCentsText(entry.cents).replace(".", ","), "Inconnu"]);
    if (group.kind !== "review") rows.push([
      group.kind === "credit" ? "Total avoirs non affectés" : "Total échéance", group.due, group.currency,
      group.kind === "credit" ? "" : scheduleStatusLabel(group.status), "", group.seller, "", "",
      group.known ? decimalCentsText(group.total).replace(".", ",") : "", "Inconnu"]);
  }
  return rows;
}

function wireSchedule() {
  byId("schedule-status").addEventListener("change", event => { schedule.status = event.target.value; renderSchedule(); });
  byId("schedule-currency").addEventListener("change", event => { schedule.currency = event.target.value; renderSchedule(); });
  byId("schedule-export").addEventListener("click", async event => {
    const button = event.currentTarget, old = button.textContent;
    button.disabled = true;
    try {
      const csv = "\uFEFF" + scheduleExportRows().map(row => row.map(csvCell).join(";")).join("\r\n") + "\r\n";
      if (await api.saveText("echeancier.csv", csv)) button.textContent = "Exporté";
    } catch (error) { workspaceNotice("Export de l’échéancier impossible : " + (error?.message || error)); }
    finally { button.disabled = false; setTimeout(() => { button.textContent = old; }, 1200); }
  });
}
