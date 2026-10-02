// Données synthétiques représentant les feuilles XML retournées par le moteur Rust.
const value = (text, attrs = {}) => ({ $value: String(text), $attrs: attrs });
function rowsFrom(root, data) {
  const rows = [];
  function visit(path, tag, node) {
    if (node && typeof node === 'object' && !('$value' in node)) {
      for (const [name, item] of Object.entries(node)) {
        const list = Array.isArray(item) ? item : [item];
        list.forEach((child, i) => visit(`${path}/${name}${list.length > 1 ? `[${i + 1}]` : ''}`, name, child));
      }
    } else rows.push({ path, tag, value: node?.$value ?? String(node), attrs: node?.$attrs || {}, title: tag });
  }
  visit(root, root, data); return rows;
}
function invoice(credit = false, negative = false) {
  const n = amount => String(negative ? -amount : amount);
  const category = rate => ({ ID: 'S', Percent: rate, TaxScheme: { ID: 'VAT' } });
  const adjustment = (charge, amount, rate) => ({ ChargeIndicator: String(charge), Amount: n(amount), TaxCategory: category(rate) });
  const root = credit ? 'CreditNote' : 'Invoice';
  const data = {
    DocumentCurrencyCode: 'EUR', InvoiceTypeCode: credit ? '381' : '380',
    LegalMonetaryTotal: { LineExtensionAmount: n(130), AllowanceTotalAmount: n(10), ChargeTotalAmount: n(5), TaxExclusiveAmount: n(125), TaxInclusiveAmount: n(146.5), PrepaidAmount: n(20), PayableRoundingAmount: n(0.01), PayableAmount: n(126.51) },
    AllowanceCharge: [adjustment(false, 10, 20), adjustment(true, 5, 10)],
    TaxTotal: { TaxAmount: value(n(21.5), { currencyID: 'EUR' }), TaxSubtotal: [
      { TaxableAmount: n(90), TaxAmount: n(18), TaxCategory: category(20) },
      { TaxableAmount: n(35), TaxAmount: n(3.5), TaxCategory: category(10) },
    ] },
    [credit ? 'CreditNoteLine' : 'InvoiceLine']: [
      { [credit ? 'CreditedQuantity' : 'InvoicedQuantity']: value(n(2), { unitCode: 'C62' }), LineExtensionAmount: n(100), Price: { PriceAmount: '50', BaseQuantity: value(1, { unitCode: 'C62' }) }, Item: { ClassifiedTaxCategory: category(20) } },
      { [credit ? 'CreditedQuantity' : 'InvoicedQuantity']: '1', LineExtensionAmount: n(30), Price: { PriceAmount: n(60), BaseQuantity: '2' }, Item: { ClassifiedTaxCategory: category(10) }, AllowanceCharge: [adjustment(true, 2, 10), adjustment(false, 2, 10)] },
    ],
  };
  // Le prix de la première ligne reste positif lorsque la quantité est négative.
  return { format: 'UBL', root, rows: rowsFrom(root, data), header: [], summary: [], sections: [], lines: [], doc_hash: 'checks-fixture', xml_pretty: '<Invoice/>' };
}
function cii() {
  const root = 'CrossIndustryInvoice';
  const category = { TypeCode: 'VAT', CategoryCode: 'S', RateApplicablePercent: '20' };
  return { format: 'CII', root, header: [], summary: [], sections: [], lines: [], doc_hash: 'cii-checks', xml_pretty: '<CrossIndustryInvoice/>', rows: rowsFrom(root, {
    ExchangedDocument: { ID: 'CII-TEST', TypeCode: '380' },
    SupplyChainTradeTransaction: {
      IncludedSupplyChainTradeLineItem: {
        SpecifiedLineTradeAgreement: { NetPriceProductTradePrice: { ChargeAmount: '50', BasisQuantity: '1' } },
        SpecifiedLineTradeDelivery: { BilledQuantity: '2' },
        SpecifiedLineTradeSettlement: { SpecifiedTradeSettlementLineMonetarySummation: { LineTotalAmount: '100' }, ApplicableTradeTax: category },
      },
      ApplicableHeaderTradeSettlement: {
        InvoiceCurrencyCode: 'EUR', ApplicableTradeTax: { ...category, BasisAmount: '100', CalculatedAmount: '20' },
        SpecifiedTradeSettlementHeaderMonetarySummation: { LineTotalAmount: '100', TaxBasisTotalAmount: '100', TaxTotalAmount: value(20, { currencyID: 'EUR' }), GrandTotalAmount: '120', DuePayableAmount: '120' },
      },
    },
  }) };
}
module.exports = { invoice, cii, rowsFrom, value };
