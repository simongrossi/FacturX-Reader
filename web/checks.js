/* Contrôles locaux de cohérence sur les valeurs XML brutes, indépendants du suivi manuel. */
(function(global) {
  "use strict";
  const abs = n => n < 0n ? -n : n;
  const gcd = (a, b) => { a = abs(a); while (b) [a, b] = [b, a % b]; return a || 1n; };
  function rational(n, d = 1n) { if (!d) return null; if (d < 0n) { n = -n; d = -d; } const g = gcd(n, d); return { n: n / g, d: d / g }; }
  const zero = rational(0n);
  function decimal(value) {
    const m = /^([+-]?)(\d{1,40})(?:\.(\d{1,12}))?$/.exec(String(value ?? "").trim());
    return m ? rational(BigInt((m[1] === "-" ? "-" : "") + m[2] + (m[3] || "")), 10n ** BigInt((m[3] || "").length)) : null;
  }
  const add = (a, b) => a && b ? rational(a.n * b.d + b.n * a.d, a.d * b.d) : null;
  const sub = (a, b) => a && b ? add(a, rational(-b.n, b.d)) : null;
  const mul = (a, b) => a && b ? rational(a.n * b.n, a.d * b.d) : null;
  const div = (a, b) => a && b ? rational(a.n * b.d, a.d * b.n) : null;
  const sum = values => values.reduce(add, zero);
  function cents(a) {
    if (!a) return null;
    const scaled = abs(a.n) * 100n, quotient = scaled / a.d;
    return (a.n < 0n ? -1n : 1n) * (quotient + (scaled % a.d * 2n >= a.d ? 1n : 0n));
  }
  function money(a) {
    if (!a) return null;
    let remainder = abs(a.n) % a.d, fraction = "";
    while (remainder && fraction.length < 18) {
      remainder *= 10n; fraction += String(remainder / a.d); remainder %= a.d;
    }
    return (a.n < 0n ? "-" : "") + String(abs(a.n) / a.d) + "." + fraction.padEnd(2, "0") + (remainder ? "…" : "");
  }
  function tree(rows) {
    const root = { path: "", name: "", children: new Map() };
    for (const row of rows || []) {
      if (!row.path || row.binary) continue;
      let node = root;
      for (const segment of row.path.split("/")) {
        if (!node.children.has(segment)) node.children.set(segment, { name: segment.replace(/\[\d+\]$/, ""), path: node.path ? node.path + "/" + segment : segment, children: new Map() });
        node = node.children.get(segment);
      }
      node.row = row;
    }
    return root;
  }
  const children = (node, names) => [...(node?.children.values() || [])].filter(n => names.split("|").includes(n.name));
  const one = (node, names) => { const list = children(node, names); return list.length === 1 ? list[0] : null; };
  const at = (node, path) => path.split("/").reduce((n, part) => one(n, part), node);
  const text = node => node?.row?.value?.trim() || "";
  function analyze(result) {
    const checks = [], root = one(tree(result.rows), result.root || "");
    const ubl = result.format === "UBL", cii = result.format === "CII";
    if ((!ubl && !cii) || !root) return { version: 1, currency: null, checks: [{ id: "structure", label: "Structure prise en charge", status: !ubl && !cii ? "non_applicable" : "non_verifiable", expected: null, actual: null, difference: null, paths: [], detail: "Contrôles disponibles pour UBL et CII structurés. Les feuilles XML nécessaires doivent être disponibles." }] };
    const txn = one(root, "SupplyChainTradeTransaction");
    const header = ubl ? root : one(txn, "ApplicableHeaderTradeSettlement|ApplicableTradeSettlement");
    const totals = ubl ? one(root, "LegalMonetaryTotal") : one(header, "SpecifiedTradeSettlementHeaderMonetarySummation");
    const currency = text(one(header, ubl ? "DocumentCurrencyCode" : "InvoiceCurrencyCode"));
    const knownCurrency = /^[A-Z]{3}$/.test(currency);
    if (!header || !totals) return { version: 1, currency: knownCurrency ? currency : null, checks: [{ id: "structure", label: "Totaux de la facture", status: "non_verifiable", expected: null, actual: null, difference: null, paths: [], detail: "Bloc de totaux absent ou ambigu. Les contrôles ne peuvent pas être exécutés." }] };
    const number = (node, optional = false) => {
      if (!knownCurrency) return null;
      if (!node) return optional ? zero : null;
      if (node.row?.attrs?.currencyID && node.row.attrs.currencyID !== currency) return null;
      return decimal(text(node));
    };
    function field(node, tag, optional = false) {
      const entries = children(node, tag);
      return entries.length > 1 ? null : number(entries[0], optional);
    }
    function check(id, label, expected, actual, sources, detail = "", tolerance = 0n, status = null) {
      const difference = sub(actual, expected);
      const valid = expected && actual;
      checks.push({ id, label, status: status || (!valid ? "non_verifiable" : abs(difference.n * 100n) <= tolerance * difference.d ? "conforme" : "ecart"),
        expected: money(expected), actual: money(actual), difference: money(difference),
        paths: [...new Set(sources.filter(Boolean).map(n => n.path))],
        detail: detail || (!valid ? "Valeur absente, ambiguë, invalide ou devise incompatible. Aucun montant manquant n’est supposé nul, sauf un élément optionnel absent." : "Comparaison des montants XML, à deux décimales.") });
    }
    const rounded = a => a ? rational(cents(a), 100n) : null;
    function adjustments(node, ciiMode = false) {
      const groups = children(node, ciiMode ? "SpecifiedTradeAllowanceCharge" : "AllowanceCharge");
      const allowance = [], charge = [], all = [];
      for (const group of groups) {
        const indicator = text(ciiMode ? at(group, "ChargeIndicator/Indicator") : one(group, "ChargeIndicator"));
        const amountNode = one(group, ciiMode ? "ActualAmount" : "Amount");
        const amount = number(amountNode); all.push(amountNode || group);
        if (["true", "1"].includes(indicator)) charge.push(amount);
        else if (["false", "0"].includes(indicator)) allowance.push(amount);
        else { allowance.push(null); charge.push(null); }
      }
      return { allowance: sum(allowance), charge: sum(charge), groups, sources: all };
    }
    const lines = children(ubl ? root : txn, ubl ? "InvoiceLine|CreditNoteLine" : "IncludedSupplyChainTradeLineItem|SpecifiedTradeLineItem");
    const lineAmounts = [], lineNodes = [], taxInputs = [];
    function taxKey(node, ciiMode) {
      const type = text(ciiMode ? one(node, "TypeCode") : at(node, "TaxScheme/ID"));
      const category = text(one(node, ciiMode ? "CategoryCode" : "ID"));
      const rate = decimal(text(one(node, ciiMode ? "RateApplicablePercent" : "Percent")));
      return type === "VAT" && category && rate ? `${category}:${rate.n}/${rate.d}` : null;
    }
    for (const [index, line] of lines.entries()) {
      const st = cii ? one(line, "SpecifiedLineTradeSettlement|IncludedLineTradeSettlement") : null;
      const netNode = ubl ? one(line, "LineExtensionAmount") : at(st, "SpecifiedTradeSettlementLineMonetarySummation/LineTotalAmount");
      const net = number(netNode); lineAmounts.push(net); lineNodes.push(netNode || line);
      const price = ubl ? one(line, "Price") : at(line, "SpecifiedLineTradeAgreement|IncludedLineTradeAgreement/NetPriceProductTradePrice|NetPrice");
      const qtyNode = ubl ? one(line, "InvoicedQuantity|CreditedQuantity") : at(line, "SpecifiedLineTradeDelivery|IncludedLineTradeDelivery/BilledQuantity");
      const priceNode = one(price, ubl ? "PriceAmount" : "ChargeAmount"), baseNode = one(price, "BaseQuantity|BasisQuantity");
      const qty = number(qtyNode), unitPrice = number(priceNode);
      let base = field(price, "BaseQuantity|BasisQuantity", true);
      if (!baseNode && base) base = rational(1n);
      if (qtyNode?.row?.attrs?.unitCode && baseNode?.row?.attrs?.unitCode && qtyNode.row.attrs.unitCode !== baseNode.row.attrs.unitCode) base = null;
      const adjustmentsForLine = adjustments(ubl ? line : st, cii);
      const expected = add(sub(div(mul(qty, unitPrice), base), adjustmentsForLine.allowance), adjustmentsForLine.charge);
      check(`line-${index + 1}`, `Ligne ${index + 1} : quantité × prix / quantité de base − remises + frais`, rounded(expected), net,
        [qtyNode, priceNode, baseNode, netNode, ...adjustmentsForLine.sources], "Prix net XML utilisé, sans reprendre le prix calculé pour l’affichage. Tolérance de 0,02 unité monétaire sur la ligne ; division par zéro ou unités incompatibles : non vérifiable.", 2n);
      const category = one(ubl ? one(line, "Item") : st, ubl ? "ClassifiedTaxCategory" : "ApplicableTradeTax");
      taxInputs.push({ key: taxKey(category, cii), amount: net, node: netNode || line });
    }
    const lineTotalNode = one(totals, ubl ? "LineExtensionAmount" : "LineTotalAmount");
    check("line-total", "Somme des lignes HT = total des lignes", lines.length ? rounded(sum(lineAmounts)) : null, number(lineTotalNode), [...lineNodes, lineTotalNode],
      lines.length ? "Addition des montants nets XML des lignes." : "Aucune ligne détaillée : ce contrôle est non vérifiable, ce n’est pas une anomalie.");
    const globalAdjustments = adjustments(header, cii);
    const allowanceNode = one(totals, "AllowanceTotalAmount"), chargeNode = one(totals, "ChargeTotalAmount");
    check("allowances", "Somme des remises globales", globalAdjustments.allowance, field(totals, "AllowanceTotalAmount", true), [...globalAdjustments.sources, allowanceNode], "Remises absentes : zéro. Les éléments présents doivent fournir leur montant et leur indicateur.");
    check("charges", "Somme des frais globaux", globalAdjustments.charge, field(totals, "ChargeTotalAmount", true), [...globalAdjustments.sources, chargeNode], "Frais absents : zéro. Les éléments présents doivent fournir leur montant et leur indicateur.");
    const htNode = one(totals, ubl ? "TaxExclusiveAmount" : "TaxBasisTotalAmount");
    check("ht", "HT = total des lignes − remises globales + frais globaux", rounded(add(sub(number(lineTotalNode), field(totals, "AllowanceTotalAmount", true)), field(totals, "ChargeTotalAmount", true))), number(htNode), [lineTotalNode, allowanceNode, chargeNode, htNode]);
    for (const group of globalAdjustments.groups) {
      const category = one(group, cii ? "CategoryTradeTax" : "TaxCategory");
      const indicator = text(cii ? at(group, "ChargeIndicator/Indicator") : one(group, "ChargeIndicator"));
      const amountNode = one(group, cii ? "ActualAmount" : "Amount");
      let amount = number(amountNode);
      if (["false", "0"].includes(indicator)) amount = sub(zero, amount);
      else if (!["true", "1"].includes(indicator)) amount = null;
      taxInputs.push({ key: taxKey(category, cii), amount, node: amountNode || group });
    }
    const taxTotals = ubl ? children(header, "TaxTotal").filter(t => {
      const amt = one(t, "TaxAmount"); return !amt?.row?.attrs?.currencyID || amt.row.attrs.currencyID === currency;
    }) : [];
    const taxTotalNode = ubl ? (taxTotals.length === 1 ? one(taxTotals[0], "TaxAmount") : null) : (() => {
      const nodes = children(totals, "TaxTotalAmount").filter(n => !n.row?.attrs?.currencyID || n.row.attrs.currencyID === currency);
      return nodes.length === 1 ? nodes[0] : null;
    })();
    const taxGroups = ubl ? taxTotals.flatMap(t => children(t, "TaxSubtotal")) : children(header, "ApplicableTradeTax");
    const taxAmounts = [], taxNodes = [], keys = new Set();
    for (const [index, group] of taxGroups.entries()) {
      const category = ubl ? one(group, "TaxCategory") : group;
      const type = text(ubl ? at(category, "TaxScheme/ID") : one(category, "TypeCode"));
      const key = taxKey(category, cii);
      const baseNode = one(group, ubl ? "TaxableAmount" : "BasisAmount"), amountNode = one(group, ubl ? "TaxAmount" : "CalculatedAmount");
      const rateNode = one(category, ubl ? "Percent" : "RateApplicablePercent");
      const amount = number(amountNode); taxAmounts.push(type === "VAT" ? amount : null); taxNodes.push(amountNode || group);
      const duplicate = key && keys.has(key); if (key) keys.add(key);
      const expectedBase = lines.length && key && !duplicate && taxInputs.every(t => t.key && t.amount) ? rounded(sum(taxInputs.filter(t => t.key === key).map(t => t.amount))) : null;
      check(`vat-base-${index + 1}`, `TVA ${index + 1} : base par catégorie et taux`, expectedBase, number(baseNode), [baseNode, ...taxInputs.filter(t => t.key === key).map(t => t.node)],
        "Regroupement des lignes et des remises/frais globaux par code de catégorie et taux. Absence de lignes, catégorie ambiguë ou taux absent : non vérifiable.", 0n, type && type !== "VAT" ? "non_applicable" : null);
      check(`vat-rate-${index + 1}`, `TVA ${index + 1} : base × taux / 100`, rounded(div(mul(number(baseNode), number(rateNode)), rational(100n))), amount, [baseNode, rateNode, amountNode],
        "Arrondi local à deux décimales, demi-unité éloignée de zéro. Ce contrôle strict peut signaler un écart accepté par certaines règles normatives.", 0n, type && type !== "VAT" ? "non_applicable" : !type || duplicate ? "non_verifiable" : null);
    }
    check("vat-total", "Somme des TVA par catégorie = TVA totale", taxGroups.length ? rounded(sum(taxAmounts)) : null, number(taxTotalNode), [...taxNodes, taxTotalNode], taxGroups.length ? "Addition des montants de TVA dans la devise de la facture." : "Ventilation TVA absente : non vérifiable.");
    const ttcNode = one(totals, ubl ? "TaxInclusiveAmount" : "GrandTotalAmount");
    check("ttc", "TTC = HT + TVA", rounded(add(number(htNode), number(taxTotalNode))), number(ttcNode), [htNode, taxTotalNode, ttcNode]);
    const paidNode = one(totals, ubl ? "PrepaidAmount" : "TotalPrepaidAmount");
    const roundingNode = one(totals, ubl ? "PayableRoundingAmount" : "RoundingAmount");
    const dueNode = one(totals, ubl ? "PayableAmount" : "DuePayableAmount");
    check("due", "Net à payer = TTC − acomptes + arrondi", rounded(add(sub(number(ttcNode), field(totals, ubl ? "PrepaidAmount" : "TotalPrepaidAmount", true)), field(totals, ubl ? "PayableRoundingAmount" : "RoundingAmount", true))), number(dueNode), [ttcNode, paidNode, roundingNode, dueNode], "Acomptes et arrondi absents : zéro. Signe des montants XML conservé, y compris pour les avoirs. Ce contrôle ne confirme pas le paiement.");
    return { version: 1, currency: knownCurrency ? currency : null, checks };
  }
  global.InvoiceChecks = { analyze };
})(typeof window === "undefined" ? globalThis : window);

function renderChecks(f, pane) {
  const report = InvoiceChecks.analyze(f.result);
  const labels = { conforme: "Conforme au contrôle", ecart: "Écart détecté", non_verifiable: "Non vérifiable", non_applicable: "Non applicable" };
  const section = document.createElement("section"); section.className = "section checks-panel";
  const heading = document.createElement("h3"); heading.textContent = "Contrôles de cohérence";
  const note = document.createElement("p"); note.textContent = "Calculs sur les valeurs XML d’origine. Ils ne constituent pas une validation EN 16931, PDF/A, ni une confirmation de paiement. Montants arrondis à deux décimales ; prix et quantités calculés sans nombres flottants.";
  const summary = document.createElement("p"); summary.setAttribute("role", "status");
  summary.textContent = Object.entries(labels).map(([key, label]) => `${label} : ${report.checks.filter(c => c.status === key).length}`).join(" · ");
  const download = document.createElement("button"); download.className = "btn"; download.textContent = "Exporter le rapport de contrôle";
  download.onclick = async () => {
    download.disabled = true;
    try {
      await invoke("save_control_report", {
        filename: f.name.replace(/\.[^.]+$/, "") + "-controles.json",
        report: { ...report, filename: f.name, doc_hash: f.result.doc_hash, generated_at: new Date().toISOString(), policy: "decimal_exact; round_half_away_from_zero_2dp; line_tolerance_0.02", labels },
      });
    } catch (error) { workspaceNotice("Export du rapport impossible : " + String(error)); }
    finally { download.disabled = false; }
  };
  section.append(heading, note, summary, download);
  const due = (f.result.header || []).find(c => c.title === "Date d'échéance")?.value;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(due || "") || /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(due || "");
  if (m) {
    const iso = m[1].length === 4 ? `${m[1]}-${m[2]}-${m[3]}` : `${m[3]}-${m[2]}-${m[1]}`;
    const now = new Date(), today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    if (iso < today && Number.isFinite(Date.parse(iso)) && new Date(iso).toISOString().slice(0, 10) === iso) {
      const alert = document.createElement("p"); alert.className = "warning"; alert.textContent = `Échéance passée (${due}). Le paiement effectif n’est pas connu.`; section.append(alert);
    }
  }
  const list = document.createElement("div");
  for (const control of report.checks) {
    const detail = document.createElement("details"); detail.className = "check-result check-" + control.status;
    const title = document.createElement("summary"); title.textContent = `${labels[control.status]} — ${control.label}`;
    const amounts = document.createElement("p"); amounts.textContent = `Attendu : ${control.expected ?? "—"} · XML : ${control.actual ?? "—"} · Écart (XML − attendu) : ${control.difference ?? "—"} ${report.currency || "(devise inconnue)"}`;
    const explanation = document.createElement("p"); explanation.textContent = control.detail;
    detail.append(title, amounts, explanation);
    for (const path of control.paths) {
      const button = document.createElement("button"); button.className = "check-path"; button.textContent = path;
      button.onclick = () => {
        setTab("xml"); byId("xml-search").value = ""; filterXmlTable("");
        document.querySelectorAll(".control-hit").forEach(row => row.classList.remove("control-hit"));
        const row = [...byId("xml-table").querySelectorAll("tbody tr")].find(row => row.dataset.path === path);
        if (row) requestAnimationFrame(() => { row.classList.add("control-hit"); row.scrollIntoView({ block: "center" }); });
      };
      detail.append(button);
    }
    list.append(detail);
  }
  section.append(list);
  const review = pane.querySelector(".review-panel");
  if (review) review.after(section); else pane.prepend(section);
}
