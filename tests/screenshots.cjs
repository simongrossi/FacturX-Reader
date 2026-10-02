// Captures d'écran du README, à partir de factures entièrement fictives analysées
// par le vrai moteur Rust (exemple `dump`). Aucune donnée réelle.
//
//   npm run screenshots
const { chromium } = require('@playwright/test');
const { execFileSync } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/* SIRET et n° de TVA fictifs, avec clés de contrôle valides (Luhn, modulo 97). */
function luhnDigit(digits) {
  let sum = 0;
  [...digits].reverse().forEach((c, i) => { let d = +c; if (i % 2 === 0) { d *= 2; if (d > 9) d -= 9; } sum += d; });
  return String((10 - (sum % 10)) % 10);
}
function fakeIds(base) {
  const siren = base + luhnDigit(base);
  const siret = siren + '0001' + luhnDigit(siren + '0001');
  return { siret, vat: 'FR' + String((12 + 3 * (Number(siren) % 97)) % 97).padStart(2, '0') + siren };
}

const BUYER = { name: 'Menuiserie Lefèvre SARL', street: '12 rue des Tilleuls', city: 'Tours', zip: '37000' };
const INVOICES = [
  {
    file: 'Papeterie-Durand_F-2026-0142.pdf', number: 'F-2026-0142', type: '380', date: '20260924', due: '20261030',
    seller: { name: 'Papeterie Durand SAS', street: '8 avenue de la Gare', city: 'Orléans', zip: '45000', ...fakeIds('12345678') },
    iban: 'FR7630006000011234567890189',
    lines: [
      ['PAP-A4-80', 'Papier A4 80 g — carton de 5 ramettes', '12', 'C62', '21.90'],
      ['ENV-C5-500', 'Enveloppes C5 blanches — boîte de 500', '4', 'C62', '18.50'],
      ['CLA-A4-DOS8', 'Classeurs à levier dos 8 cm', '30', 'C62', '2.35'],
      ['TON-HP-415X', 'Toner noir haute capacité', '2', 'C62', '129.00'],
    ],
  },
  {
    file: 'Atelier-Lumen_FA-0917.pdf', number: 'FA-0917', type: '380', date: '20260828', due: '20260927',
    seller: { name: 'Atelier Lumen SARL', street: '3 impasse des Forges', city: 'Blois', zip: '41000', ...fakeIds('98765432') },
    iban: 'FR7630006000011234567890189', ttcOffset: 1,
    lines: [
      ['LED-PAN-60', 'Panneau LED 60 × 60 cm 40 W', '18', 'C62', '34.90'],
      ['POSE-H', 'Pose et raccordement', '6.5', 'HUR', '52.00'],
      ['DEPL', 'Déplacement', '1', 'C62', '45.00'],
    ],
  },
  {
    file: 'Nordik-Transport_AV-2026-031.pdf', number: 'AV-2026-031', type: '381', date: '20260915', due: '',
    seller: { name: 'Nordik Transport SAS', street: '41 quai du Port', city: 'Nantes', zip: '44000', ...fakeIds('45612378') },
    iban: '',
    lines: [['PAL-RET', 'Reprise de palettes non conformes', '5', 'C62', '24.00']],
  },
];

const cents = (text) => Math.round(parseFloat(text) * 100);
const money = (c) => (c / 100).toFixed(2);
const tag = (name, body, attrs = '') => `<ram:${name}${attrs}>${body}</ram:${name}>`;
const date = (name, value) => tag(name, `<udt:DateTimeString format="102">${value}</udt:DateTimeString>`);
const party = (name, p) => tag(name, tag('Name', p.name) +
  (p.siret ? tag('SpecifiedLegalOrganization', tag('ID', p.siret, ' schemeID="0002"')) : '') +
  tag('PostalTradeAddress', tag('PostcodeCode', p.zip) + tag('LineOne', p.street) + tag('CityName', p.city) + tag('CountryID', 'FR')) +
  (p.vat ? tag('SpecifiedTaxRegistration', tag('ID', p.vat, ' schemeID="VA"')) : ''));

function invoiceXml(inv) {
  const lines = inv.lines.map(([ref, name, qty, unit, price], i) => {
    const total = Math.round(parseFloat(qty) * cents(price));
    return { ref, name, qty, unit, price, total, id: String(i + 1) };
  });
  const ht = lines.reduce((sum, l) => sum + l.total, 0);
  const tva = Math.round(ht * 0.2);
  const ttc = ht + tva + (inv.ttcOffset || 0);
  const items = lines.map((l) => tag('IncludedSupplyChainTradeLineItem',
    tag('AssociatedDocumentLineDocument', tag('LineID', l.id)) +
    tag('SpecifiedTradeProduct', tag('SellerAssignedID', l.ref) + tag('Name', l.name)) +
    tag('SpecifiedLineTradeAgreement', tag('NetPriceProductTradePrice', tag('ChargeAmount', l.price))) +
    tag('SpecifiedLineTradeDelivery', tag('BilledQuantity', l.qty, ` unitCode="${l.unit}"`)) +
    tag('SpecifiedLineTradeSettlement',
      tag('ApplicableTradeTax', tag('TypeCode', 'VAT') + tag('CategoryCode', 'S') + tag('RateApplicablePercent', '20.00')) +
      tag('SpecifiedTradeSettlementLineMonetarySummation', tag('LineTotalAmount', money(l.total)))))).join('');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
<rsm:ExchangedDocumentContext>${tag('GuidelineSpecifiedDocumentContextParameter', tag('ID', 'urn:cen.eu:en16931:2017'))}</rsm:ExchangedDocumentContext>
<rsm:ExchangedDocument>${tag('ID', inv.number)}${tag('TypeCode', inv.type)}${date('IssueDateTime', inv.date)}</rsm:ExchangedDocument>
<rsm:SupplyChainTradeTransaction>${items}
${tag('ApplicableHeaderTradeAgreement', party('SellerTradeParty', inv.seller) + party('BuyerTradeParty', BUYER))}
${tag('ApplicableHeaderTradeDelivery', '')}
${tag('ApplicableHeaderTradeSettlement',
    tag('InvoiceCurrencyCode', 'EUR') +
    (inv.iban ? tag('SpecifiedTradeSettlementPaymentMeans', tag('TypeCode', '58') + tag('PayeePartyCreditorFinancialAccount', tag('IBANID', inv.iban))) : '') +
    tag('ApplicableTradeTax', tag('CalculatedAmount', money(tva)) + tag('TypeCode', 'VAT') + tag('BasisAmount', money(ht)) + tag('CategoryCode', 'S') + tag('RateApplicablePercent', '20.00')) +
    tag('SpecifiedTradePaymentTerms', tag('Description', inv.due ? 'Paiement à 30 jours' : 'Avoir à déduire du prochain règlement') + (inv.due ? date('DueDateDateTime', inv.due) : '')) +
    tag('SpecifiedTradeSettlementHeaderMonetarySummation',
      tag('LineTotalAmount', money(ht)) + tag('TaxBasisTotalAmount', money(ht)) +
      tag('TaxTotalAmount', money(tva), ' currencyID="EUR"') + tag('GrandTotalAmount', money(ttc)) + tag('DuePayableAmount', money(ttc))))}
</rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>`;
  return { xml, lines, ht, tva, ttc };
}

/* PDF d'une page (texte Helvetica, WinAnsi) avec le XML en pièce jointe. */
function invoicePdf(inv) {
  const { xml, lines, ht, tva, ttc } = invoiceXml(inv);
  const esc = (s) => s.replace(/[\\()]/g, '\\$&').replace(/—/g, '-').replace(/×/g, 'x');
  const text = (x, y, size, s, bold) => `BT /${bold ? 'F2' : 'F1'} ${size} Tf ${x} ${y} Td (${esc(s)}) Tj ET`;
  const fr = (c) => money(c).replace('.', ',') + ' EUR';
  const kind = inv.type === '381' ? 'AVOIR' : 'FACTURE';
  const ops = [
    text(50, 780, 20, inv.seller.name, true),
    text(50, 762, 10, `${inv.seller.street} - ${inv.seller.zip} ${inv.seller.city}`),
    text(50, 748, 10, `SIRET ${inv.seller.siret} - TVA ${inv.seller.vat}`),
    text(380, 780, 16, `${kind} ${inv.number}`, true),
    text(380, 762, 10, `Date : ${inv.date.slice(6)}/${inv.date.slice(4, 6)}/${inv.date.slice(0, 4)}`),
    text(380, 700, 11, BUYER.name, true), text(380, 686, 10, BUYER.street), text(380, 672, 10, `${BUYER.zip} ${BUYER.city}`),
    '0.85 g 50 618 495 20 re f 0 g',
    text(56, 624, 10, 'Reference', true), text(150, 624, 10, 'Designation', true), text(390, 624, 10, 'Qte', true),
    text(430, 624, 10, 'P.U. HT', true), text(490, 624, 10, 'Total HT', true),
    ...lines.flatMap((l, i) => {
      const y = 600 - i * 20;
      return [text(56, y, 10, l.ref), text(150, y, 10, l.name), text(390, y, 10, l.qty),
        text(430, y, 10, l.price.replace('.', ',')), text(490, y, 10, money(l.total).replace('.', ','))];
    }),
    text(390, 470, 11, 'Total HT'), text(480, 470, 11, fr(ht)),
    text(390, 452, 11, 'TVA 20 %'), text(480, 452, 11, fr(tva)),
    text(390, 430, 13, 'Total TTC', true), text(480, 430, 13, fr(ttc), true),
    inv.iban ? text(50, 380, 10, `Reglement par virement - IBAN ${inv.iban}`) : '',
  ].join('\n');
  const stream = (body, extra = '') => `<< ${extra}/Length ${Buffer.byteLength(body, 'latin1')} >>\nstream\n${body}\nendstream`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R /Names << /EmbeddedFiles << /Names [(factur-x.xml) 7 0 R] >> >> >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    stream(ops),
    '<< /Type /Filespec /F (factur-x.xml) /UF (factur-x.xml) /EF << /F 8 0 R >> >>',
    null,
  ];
  // Le flux XML est en UTF-8 ; le reste du fichier en Latin-1 (texte WinAnsi).
  const chunks = [Buffer.from('%PDF-1.7\n', 'latin1')];
  const offsets = [];
  const size = () => chunks.reduce((sum, c) => sum + c.length, 0);
  objects.forEach((object, i) => {
    offsets.push(size());
    if (object === null) {
      const body = Buffer.from(xml, 'utf8');
      chunks.push(Buffer.from(`${i + 1} 0 obj\n<< /Type /EmbeddedFile /Subtype /text#2Fxml /Length ${body.length} >>\nstream\n`, 'latin1'), body, Buffer.from('\nendstream\nendobj\n', 'latin1'));
    } else chunks.push(Buffer.from(`${i + 1} 0 obj\n${object}\nendobj\n`, 'latin1'));
  });
  const xref = size();
  chunks.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('') +
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`, 'latin1'));
  return Buffer.concat(chunks);
}

async function main() {
  const root = path.join(__dirname, '..');
  const dump = path.join(root, 'src-tauri/target/debug/examples/dump' + (process.platform === 'win32' ? '.exe' : ''));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'facturx-shots-'));
  const results = {};
  for (const inv of INVOICES) {
    const file = path.join(tmp, inv.file);
    fs.writeFileSync(file, invoicePdf(inv));
    results[inv.file] = JSON.parse(execFileSync(dump, [file], { maxBuffer: 64 * 1024 * 1024 }).toString('utf8'));
  }
  const server = http.createServer((req, res) => {
    const file = path.join(root, 'web', req.url === '/' ? 'index.html' : req.url.split('?')[0]);
    res.setHeader('Content-Type', file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.svg') ? 'image/svg+xml' : 'text/html');
    fs.readFile(file, (err, data) => { res.statusCode = err ? 404 : 200; res.end(err ? '' : data); });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 });
  await page.addInitScript((results) => {
    window.__TAURI__ = { core: { invoke: async (command, args, options) => {
      if (command === 'startup_paths') return { files: [] };
      if (command === 'app_info') return { version: 'demo', pointages: 'demo' };
      if (command === 'get_pointage') return { lines: [0, 1] };
      if (command === 'parse_file') return results[decodeURIComponent(options.headers['x-filename'])];
      return {};
    } } };
  }, results);
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const out = path.join(root, 'docs/screenshots');
  fs.mkdirSync(out, { recursive: true });
  const shot = async (name) => { await page.waitForTimeout(400); await page.screenshot({ path: path.join(out, name) }); };

  await page.locator('#file-input').setInputFiles(INVOICES.map((inv) => ({ name: inv.file, mimeType: 'application/pdf', buffer: Buffer.from('x') })));
  await page.locator('.pdf-page').first().waitFor();

  await page.locator('#tab-batch').click();
  await page.locator('#batch-table tbody tr.batch-row').nth(2).waitFor();
  await shot('tableau.png');

  await page.locator('#batch-table tbody tr.batch-row', { hasText: 'FA-0917' }).locator('td').first().click();
  await page.getByRole('button', { name: 'Données', exact: true }).click();
  await page.locator('#controls').waitFor();
  await shot('controles.png');

  await page.locator('#document-tabs').getByRole('button', { name: INVOICES[0].file, exact: true }).click();
  await page.getByRole('button', { name: 'PDF et données', exact: true }).click();
  await page.locator('#tab-data .lines-section').waitFor();
  await page.locator('.pdf-page canvas').first().waitFor();
  await page.locator('#pdf-zoom').selectOption('1');
  await page.evaluate(() => document.querySelector('#tab-data .lines-section').scrollIntoView());
  await shot('pdf-et-donnees.png');

  await browser.close();
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('Captures enregistrées dans docs/screenshots/');
}
main().catch((error) => { console.error(error); process.exit(1); });
