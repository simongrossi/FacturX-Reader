const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { invoice, cii, rowsFrom } = require('./checks-fixtures.cjs');
const scope = {}; vm.runInNewContext(fs.readFileSync(require.resolve('../web/checks.js'), 'utf8'), scope);
const analyze = scope.InvoiceChecks.analyze;
const rule = (result, id) => analyze(result).checks.find(check => check.id === id);
function change(result, suffix, value) { result.rows.find(row => row.path.endsWith(suffix)).value = value; return result; }
test('UBL : lignes avec quantité de base, frais/remises, deux taux, acompte et arrondi', () => {
  const report = analyze(invoice());
  assert.equal(report.checks.length, 13);
  for (const check of report.checks) assert.equal(check.status, 'conforme', `${check.id}: ${check.detail}`);
  assert.equal(rule(invoice(), 'due').expected, '126.51');
});
test('CII : valeurs brutes, lignes et TVA', () => {
  const report = analyze(cii());
  for (const check of report.checks) assert.equal(check.status, 'conforme', check.id);
  assert.equal(rule(cii(), 'ttc').expected, '120.00');
});
test('Écarts TTC et net à payer, différence signée et chemins de provenance', () => {
  const r = change(invoice(), 'TaxInclusiveAmount', '147');
  assert.equal(rule(r, 'ttc').status, 'ecart');
  assert.equal(rule(r, 'ttc').difference, '0.50');
  assert.equal(rule(r, 'due').expected, '127.01');
  assert.ok(rule(r, 'ttc').paths.includes('Invoice/LegalMonetaryTotal/TaxInclusiveAmount'));
});
test('TVA : base incohérente détectée même lorsque base × taux est cohérent', () => {
  const r = change(invoice(), 'TaxSubtotal[1]/TaxableAmount', '80');
  change(r, 'TaxSubtotal[1]/TaxAmount', '16');
  assert.equal(rule(r, 'vat-base-1').status, 'ecart');
  assert.equal(rule(r, 'vat-rate-1').status, 'conforme');
  assert.equal(rule(r, 'vat-total').status, 'ecart');
});
test('Profil sans lignes ni ventilation TVA : non vérifiable, pas anomalie', () => {
  const r = invoice(); r.rows = r.rows.filter(row => !row.path.includes('/InvoiceLine') && !row.path.includes('/TaxSubtotal'));
  assert.equal(rule(r, 'line-total').status, 'non_verifiable');
  assert.equal(rule(r, 'vat-total').status, 'non_verifiable');
  assert.equal(rule(r, 'ttc').status, 'conforme');
});
test('Avoirs : montants positifs et montants négatifs conservés pour les contrôles', () => {
  for (const negative of [false, true]) {
    const r = invoice(true, negative);
    for (const check of analyze(r).checks) assert.equal(check.status, 'conforme', check.id);
    assert.equal(rule(r, 'due').actual, negative ? '-126.51' : '126.51');
  }
});
test('Devise de comptabilité distincte exclue, devise inconnue non vérifiable', () => {
  const r = cii();
  const tax = r.rows.find(row => row.tag === 'TaxTotalAmount');
  const original = tax.path; tax.path = original + '[1]';
  r.rows.push({ ...tax, path: original + '[2]', value: '999', attrs: { currencyID: 'USD' } });
  assert.equal(rule(r, 'ttc').status, 'conforme');
  r.rows = r.rows.filter(row => row.tag !== 'InvoiceCurrencyCode');
  assert.equal(rule(r, 'ttc').status, 'non_verifiable');
});
test('Prix invalide, quantité de base nulle, unités incompatibles : non vérifiable', () => {
  for (const r of [change(invoice(), 'InvoiceLine[1]/Price/PriceAmount', 'NaN'), change(invoice(), 'InvoiceLine[1]/Price/BaseQuantity', '0')]) assert.equal(rule(r, 'line-1').status, 'non_verifiable');
  const r = invoice(); r.rows.find(row => row.path.endsWith('InvoiceLine[1]/Price/BaseQuantity')).attrs.unitCode = 'KGM';
  assert.equal(rule(r, 'line-1').status, 'non_verifiable');
});
test('Tolérance de ligne annoncée, précision supplémentaire affichée sans disparaître', () => {
  assert.equal(rule(change(invoice(), 'InvoiceLine[1]/LineExtensionAmount', '100.02'), 'line-1').status, 'conforme');
  assert.equal(rule(change(invoice(), 'InvoiceLine[1]/LineExtensionAmount', '100.03'), 'line-1').status, 'ecart');
  const check = rule(change(invoice(), 'TaxInclusiveAmount', '146.501'), 'ttc');
  assert.equal(check.status, 'ecart'); assert.equal(check.actual, '146.501'); assert.equal(check.difference, '0.001');
});
test('Calcul exact 0.1 + 0.2 et structure absente', () => {
  const r = { format: 'UBL', root: 'Invoice', rows: rowsFrom('Invoice', { DocumentCurrencyCode: 'EUR', LegalMonetaryTotal: { TaxExclusiveAmount: '0.1', TaxInclusiveAmount: '0.3' }, TaxTotal: { TaxAmount: '0.2' } }) };
  assert.equal(rule(r, 'ttc').status, 'conforme');
  assert.equal(analyze({ format: 'UBL', root: 'Invoice', rows: [] }).checks[0].status, 'non_verifiable');
  assert.equal(analyze({ format: 'XML', root: 'Other', rows: [] }).checks[0].status, 'non_applicable');
  assert.equal(analyze({ format: 'UBL', root: 'Invoice', rows: rowsFrom('Invoice', { DocumentCurrencyCode: 'EUR' }) }).checks[0].status, 'non_verifiable');
});
test('Taxe non TVA non applicable, TVA ambiguë non vérifiable', () => {
  const r = invoice(); change(r, 'TaxSubtotal[1]/TaxCategory/TaxScheme/ID', 'OTHER');
  assert.equal(rule(r, 'vat-rate-1').status, 'non_applicable');
  const duplicate = invoice(); change(duplicate, 'TaxSubtotal[2]/TaxCategory/Percent', '20');
  assert.equal(rule(duplicate, 'vat-base-2').status, 'non_verifiable');
  assert.equal(rule(duplicate, 'vat-rate-2').status, 'non_verifiable');
});
test('Arrondi demi-unité éloignée de zéro et division par une quantité de base non décimale', () => {
  for (const [ht, ttc] of [['0.005', '0.01'], ['-0.005', '-0.01']]) {
    const r = { format: 'UBL', root: 'Invoice', rows: rowsFrom('Invoice', { DocumentCurrencyCode: 'EUR', LegalMonetaryTotal: { TaxExclusiveAmount: ht, TaxInclusiveAmount: ttc }, TaxTotal: { TaxAmount: '0' } }) };
    assert.equal(rule(r, 'ttc').status, 'conforme');
    assert.equal(rule(r, 'ttc').expected, ttc);
  }
  const r = invoice(); change(r, 'InvoiceLine[1]/InvoicedQuantity', '1');
  change(r, 'InvoiceLine[1]/Price/PriceAmount', '1'); change(r, 'InvoiceLine[1]/Price/BaseQuantity', '3');
  change(r, 'InvoiceLine[1]/LineExtensionAmount', '0.33');
  assert.equal(rule(r, 'line-1').expected, '0.33'); assert.equal(rule(r, 'line-1').status, 'conforme');
});
