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
  const raw = String(value ?? "").trim().replace(",", ".");
  if (!/^-?\d+(?:\.\d+)?$/.test(raw)) return null;
  const number = Number(raw);
  return Number.isFinite(number) && Math.abs(number) < 9e13 ? Math.round(number * 100) : null;
}

function scheduleToday() {
  const now = new Date();
  return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0")].join("-");
}

function scheduleEntries(today = scheduleToday()) {
  return state.files.filter(f => f.status === "ok" && f.result?.synthese).map(f => {
    const s = f.result.synthese, credit = !!s.avoir;
    // Un avoir porte une réduction, pas un décaissement. Son TTC est sa valeur, même sans montant « à payer ».
    const cents = scheduleCents(credit ? s.ttc : s.a_payer);
    const due = scheduleDate(s.echeance);
    return { f, filename: f.name, seller: s.vendeur || "", number: s.numero || "", currency: s.devise || "",
      credit, cents: cents == null ? null : credit ? -Math.abs(cents) : cents, due,
      status: !due ? "undated" : due < today ? "overdue" : due === today ? "today" : "upcoming" };
  }).sort((a, b) => (a.due || "9999-99-99").localeCompare(b.due || "9999-99-99") ||
    a.currency.localeCompare(b.currency, "fr") || a.filename.localeCompare(b.filename, "fr"));
}

function scheduleGroups(entries) {
  const groups = new Map();
  for (const entry of entries) {
    const key = entry.due + "\u0000" + entry.currency;
    if (!groups.has(key)) groups.set(key, { due: entry.due, currency: entry.currency, status: entry.status,
      entries: [], net: 0, known: 0, missing: 0, credits: 0 });
    const group = groups.get(key);
    group.entries.push(entry);
    if (entry.credit) group.credits++;
    if (entry.cents == null) group.missing++;
    else { group.net += entry.cents; group.known++; }
  }
  return [...groups.values()];
}

function scheduleVisible(entries = scheduleEntries()) {
  return entries.filter(entry => (schedule.status === "all" || entry.status === schedule.status) &&
    (schedule.currency === "all" || entry.currency === schedule.currency));
}

function scheduleMoney(cents) {
  return batchMoney.format(cents / 100);
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
  for (const entry of entries) {
    const t = totals.get(entry.currency) || { count: 0, known: 0, net: 0, credits: 0, undatedCredits: 0, missing: 0 };
    t.count++;
    if (entry.credit) { t.credits++; if (!entry.due) t.undatedCredits++; }
    if (entry.cents == null) t.missing++;
    else { t.known++; t.net += entry.cents; }
    totals.set(entry.currency, t);
  }
  const overview = Object.assign(document.createElement("p"), { className: "verdict-note",
    textContent: scheduleCount(entries.length, "document") + " avec synthèse" +
      " · " + scheduleCount(entries.filter(e => e.status === "overdue" && !e.credit).length, "échéance dépassée", "échéances dépassées") +
      " · " + entries.filter(e => !e.due).length + " sans échéance" +
      (state.files.length > entries.length ? " · " + scheduleCount(state.files.length - entries.length, "document") + " sans synthèse" : "") });
  summary.appendChild(overview);
  for (const [currency, total] of totals) {
    summary.appendChild(Object.assign(document.createElement("div"), { className: "schedule-total",
      textContent: (currency || "Sans devise") + " · solde indicatif " +
        (total.known ? scheduleMoney(total.net) : "indisponible") +
        " · " + scheduleCount(total.credits, "avoir") + ", dont " + total.undatedCredits + " sans échéance" +
        (total.missing ? " · " + scheduleCount(total.missing, "montant indisponible", "montants indisponibles") : "") }));
  }
  const currencySelect = byId("schedule-currency");
  const currencyOptions = [...totals.keys()].sort((a, b) => a.localeCompare(b, "fr"));
  currencySelect.replaceChildren(Object.assign(document.createElement("option"), { value: "all", textContent: "Toutes les devises" }),
    ...currencyOptions.map(currency => Object.assign(document.createElement("option"), { value: currency,
      textContent: currency || "Sans devise" })));
  currencySelect.value = schedule.currency;
  byId("schedule-count").textContent = visible.length + " / " + entries.length + " documents · " + scheduleCount(groups.length, "groupe") + " par date et devise";
  const container = byId("schedule-groups");
  container.replaceChildren();
  if (!visible.length) container.appendChild(Object.assign(document.createElement("p"), { className: "notice",
    textContent: entries.length ? "Aucun document ne correspond aux filtres de l’échéancier." : "Aucune facture avec synthèse ouverte." }));
  for (const group of groups) {
    const block = Object.assign(document.createElement("article"), { className: "schedule-group" });
    const head = Object.assign(document.createElement("div"), { className: "schedule-group-head" });
    head.appendChild(Object.assign(document.createElement("strong"), { textContent: scheduleDateLabel(group.due) + " · " + (group.currency || "Sans devise") }));
    head.appendChild(Object.assign(document.createElement("span"), { className: "schedule-status schedule-" + group.status,
      textContent: scheduleStatusLabel(group.status) }));
    head.appendChild(Object.assign(document.createElement("span"), { textContent: scheduleCount(group.entries.length, "document") + " · solde " +
      (group.known ? scheduleMoney(group.net) : "indisponible") +
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
      item.appendChild(Object.assign(document.createElement("span"), { textContent: entry.credit ? "Avoir" : "Facture" }));
      item.appendChild(Object.assign(document.createElement("strong"), { textContent: entry.cents == null ? "Montant indisponible" :
        (entry.cents < 0 ? "−" : "") + scheduleMoney(Math.abs(entry.cents)) + " " + (entry.currency || "") }));
      list.appendChild(item);
    }
    block.appendChild(list); container.appendChild(block);
  }
}

function scheduleExportRows() {
  const entries = scheduleVisible(), groups = scheduleGroups(entries);
  const rows = [["Ligne", "Échéance", "Devise", "Situation", "Fichier", "Fournisseur", "Numéro", "Type", "Montant signé"]];
  for (const group of groups) {
    for (const entry of group.entries) rows.push(["Document", entry.due, entry.currency, scheduleStatusLabel(entry.status),
      entry.filename, entry.seller, entry.number, entry.credit ? "Avoir" : "Facture",
      entry.cents == null ? "" : (entry.cents / 100).toFixed(2).replace(".", ",")]);
    rows.push(["Total échéance", group.due, group.currency, scheduleStatusLabel(group.status), "", "", "", "",
      group.known ? (group.net / 100).toFixed(2).replace(".", ",") : ""]);
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
