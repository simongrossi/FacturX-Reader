const { test, expect } = require('@playwright/test');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
let server, url;
test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    const file = path.join(__dirname, '../web', req.url === '/' ? 'index.html' : req.url.split('?')[0]);
    res.setHeader('Content-Type', file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
    fs.readFile(file, (err, data) => { res.statusCode = err ? 404 : 200; res.end(err ? '' : data); });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(() => server.close());
test('Contrôles : écarts visibles, chemin XML surligné, rapport et échéance distincte', async ({ page }) => {
  const result = require('./checks-fixtures.cjs').invoice();
  result.rows.find(row => row.tag === 'TaxInclusiveAmount').value = '147';
  result.header = [{ title: "Date d'échéance", value: '2000-01-01' }];
  await page.addInitScript(result => {
    window.__TAURI__ = { core: { invoke: async (command, args) => {
      if (command === 'startup_paths') return { files: [] };
      if (command === 'get_pointage') return { lines: [] };
      if (command === 'parse_file') return result;
      if (command === 'save_control_report') { if (window.failReport) throw new Error('Écriture refusée'); window.savedControlReport = args; return true; }
      return {};
    } } };
  }, result);
  await page.goto(url);
  await page.locator('#file-input').setInputFiles({ name: 'controle.xml', mimeType: 'text/xml', buffer: Buffer.from('test') });
  await page.getByRole('button', { name: 'Données', exact: true }).click();
  const panel = page.locator('.checks-panel');
  await expect(panel).toContainText('Échéance passée (2000-01-01). Le paiement effectif n’est pas connu.');
  const ttc = panel.locator('details').filter({ hasText: 'TTC = HT + TVA' });
  await ttc.locator('summary').click();
  await expect(ttc).toContainText('Attendu : 146.50 · XML : 147.00 · Écart (XML − attendu) : 0.50 EUR');
  await expect(ttc.locator('summary')).toContainText('Écart détecté');
  await ttc.getByRole('button', { name: 'Invoice/LegalMonetaryTotal/TaxInclusiveAmount', exact: true }).click();
  await expect(page.locator('#tab-xml')).toHaveClass(/active/);
  await expect(page.locator('.control-hit')).toHaveCount(1);
  await page.getByRole('button', { name: 'Données', exact: true }).click();
  await page.getByRole('button', { name: 'Exporter le rapport de contrôle' }).click();
  const saved = await page.evaluate(() => savedControlReport);
  expect(saved.filename).toBe('controle-controles.json');
  expect(saved.report.checks.find(c => c.id === 'ttc').difference).toBe('0.50');
  expect(saved.report.doc_hash).toBe(result.doc_hash);
  await panel.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/controls.png' });
  await page.evaluate(() => { window.failReport = true; });
  await page.getByRole('button', { name: 'Exporter le rapport de contrôle' }).click();
  await expect(page.locator('#workspace-message')).toContainText('Export du rapport impossible');
  await expect(page.getByRole('button', { name: 'Exporter le rapport de contrôle' })).toBeEnabled();
});
async function mockBatch(page) {
  await page.addInitScript(pdf => {
    window.__TAURI__ = { core: { invoke: async (command, args, options) => {
      if (command === 'startup_paths') return { files: [] };
      if (command === 'get_pointage') return { lines: [] };
      if (!['parse_file', 'parse_path'].includes(command)) return {};
      const name = command === 'parse_path' ? args.path.split('/').pop() : decodeURIComponent(options.headers['x-filename']);
      const credit = name.includes('credit'), usd = name.includes('usd'), missing = name.includes('missing');
      const currency = usd ? 'USD' : 'EUR', amount = credit ? '-0.10' : '0.20';
      return {
        format: 'UBL', root: credit ? 'CreditNote' : 'Invoice', doc_hash: name,
        header: [{ title: 'Devise', value: currency }],
        summary: [{ title: 'Vendeur', value: usd ? 'Supplier US' : 'Fournisseur Paris' }, { title: 'N° de facture', value: name }],
        lines_columns: [{ key: 'name', title: 'Désignation', align: 'left' }],
        lines: Array.from({ length: 35 }, (_, i) => ({ cells: { name: { value: `ARTICLE-${i}`, title: 'Désignation' } }, fields: [] })),
        rows: missing ? [] : [
          { tag: 'TaxAmount', value: '999', path: 'Invoice/TaxTotal/TaxSubtotal/TaxAmount' },
          ...['TaxExclusiveAmount', 'TaxInclusiveAmount'].map(tag => ({ tag, value: amount, path: `Invoice/LegalMonetaryTotal/${tag}` })),
          { tag: 'TaxAmount', value: '0.00', path: 'Invoice/TaxTotal/TaxAmount', attrs: { currencyID: currency } },
        ],
        sections: [], warnings: [], xml_pretty: '<Invoice/>', pdf: { base64: pdf, filename: name },
      };
    } } };
  }, require('./fixtures.cjs').invoicePdf().toString('base64'));
}
test('P2 : totaux exacts, avoir négatif, devises, absences et filtres', async ({ page }) => {
  await mockBatch(page); await page.goto(url);
  await page.locator('#file-input').setInputFiles(['invoice.xml', 'credit.xml', 'usd.xml', 'missing.pdf'].map(name => ({ name, mimeType: 'text/xml', buffer: Buffer.from('test') })));
  await page.getByRole('button', { name: 'Toutes les factures', exact: true }).click();
  await expect(page.locator('#overview-table tbody tr')).toHaveCount(4);
  await expect(page.locator('#overview-totals')).toContainText('EUR · 3 document(s) · HT : 0,10 (2/3 contributions) · TVA : 0,00 (2/3 contributions)');
  await expect(page.locator('#overview-totals')).toContainText('USD · 1 document(s) · HT : 0,20');
  await page.locator('#batch-xml').check();
  await expect(page.locator('#overview-table tbody tr')).toHaveCount(3);
  await page.locator('#batch-query').fill('Supplier US');
  await expect(page.locator('#overview-table tbody tr')).toHaveCount(1);
  await expect(page.locator('#file-list li:visible')).toHaveCount(1);
  await page.locator('#batch-query').fill('ARTICLE-34');
  await expect(page.locator('#overview-table tbody tr')).toHaveCount(3);
  await page.locator('#batch-query').fill('');
  await page.locator('#overview-table select').first().selectOption('Vérifiée');
  await page.locator('#batch-status').selectOption('Vérifiée');
  await expect(page.locator('#overview-table tbody tr')).toHaveCount(1);
  await page.reload();
  await expect(page.locator('#overview-view')).toBeVisible();
  await expect(page.locator('#overview-table select').first()).toHaveValue('Vérifiée');
  expect(await page.evaluate(() => batchFormat(batchAdd(batchDecimal('0.1'), batchDecimal('0.2'))))).toBe('0,30');
});
test('P2 : commentaires, pointage complet et double lecture persistante', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await mockBatch(page); await page.goto(url);
  await page.locator('#file-input').setInputFiles({ name: 'invoice.xml', mimeType: 'text/xml', buffer: Buffer.from('test') });
  await page.getByRole('button', { name: 'PDF et données', exact: true }).click();
  await page.waitForFunction(() => getFile(state.selected).rendered.data && getFile(state.selected).rendered.pdf && !workspaceScrollTarget);
  await page.getByLabel('Commentaire de la facture', { exact: true }).fill('À rapprocher du bon de commande');
  await page.getByLabel('Ligne à commenter').selectOption('2');
  await page.getByLabel('Commentaire de la ligne', { exact: true }).fill('Quantité à confirmer');
  await page.getByLabel('Vérification de invoice.xml').selectOption('Anomalie');
  await page.getByRole('button', { name: 'Pointer toutes les lignes' }).click();
  await expect.poll(() => page.evaluate(() => getFile(state.selected).pointed.size)).toBe(35);
  await page.evaluate(() => { document.querySelector('#tab-pdf').scrollTop = 240; document.querySelector('#tab-data').scrollTop = 310; });
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('fx-workspace')).files[0].view.dualScroll)).toEqual({ pdf: 240, data: 310 });
  await page.reload();
  await page.waitForFunction(() => getFile(state.selected)?.rendered.pdf && getFile(state.selected)?.rendered.data && !workspaceScrollTarget);
  await expect(page.locator('#reading-panes')).toHaveClass('dual-reading');
  await expect(page.getByLabel('Commentaire de la facture', { exact: true })).toHaveValue('À rapprocher du bon de commande');
  await page.getByLabel('Ligne à commenter').selectOption('2');
  await expect(page.getByLabel('Commentaire de la ligne', { exact: true })).toHaveValue('Quantité à confirmer');
  await expect(page.getByLabel('Vérification de invoice.xml')).toHaveValue('Anomalie');
  await expect.poll(() => page.evaluate(() => ({ pdf: byId('tab-pdf').scrollTop, data: byId('tab-data').scrollTop }))).toEqual({ pdf: 240, data: 310 });
  await page.screenshot({ path: 'test-results/p2-dual.png' });
  expect(errors).toEqual([]);
});
test('P2 : suivi illisible et écriture refusée signalés sans bloquer la lecture', async ({ page }) => {
  await mockBatch(page);
  await page.addInitScript(() => localStorage.setItem('fx-review:invoice.xml', '{broken'));
  await page.goto(url);
  await page.locator('#file-input').setInputFiles({ name: 'invoice.xml', mimeType: 'text/xml', buffer: Buffer.from('test') });
  await page.getByRole('button', { name: 'Données', exact: true }).click();
  await expect(page.locator('#workspace-message')).toContainText('Suivi de vérification illisible');
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) { if (key.startsWith('fx-review:')) throw new DOMException('Quota', 'QuotaExceededError'); return original.call(this, key, value); };
  });
  await page.getByLabel('Commentaire de la facture', { exact: true }).fill('Commentaire conservé en mémoire');
  await expect(page.locator('#workspace-message')).toContainText('n’a pas pu être enregistré');
  await page.getByRole('button', { name: 'XML brut', exact: true }).click();
  await page.getByRole('button', { name: 'Données', exact: true }).click();
  await expect(page.getByLabel('Commentaire de la facture', { exact: true })).toHaveValue('Commentaire conservé en mémoire');
});
async function mockBackend(page, pdf = null) {
  await page.addInitScript(pdf => {
    window.__TAURI__ = { core: { invoke: async (command, args) => {
      if (command === 'startup_paths') return { files: [] };
      if (command === 'app_info') return { version: 'test', pointages: 'test' };
      if (command === 'get_pointage') return { lines: [] };
      if (command === 'parse_path' && args.path.includes('missing')) throw new Error('Fichier introuvable');
      if (command === 'parse_file' || command === 'parse_path') return {
        format: 'CII', root: 'CrossIndustryInvoice', doc_hash: 'fixture', header: [], lines: [],
        rows: [{ title: 'Référence', tag: 'ID', value: 'FAC-2026-123', path: 'Invoice/ID' }],
        xml_pretty: '<Invoice>FAC-2026-123</Invoice>', summary: [], sections: [], warnings: [],
        pdf: pdf ? { base64: pdf, filename: 'synthetic.pdf' } : null,
      };
      return {};
    } } };
  }, pdf);
}
test('session, accueil, onglets, récents et recherche transversale', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await mockBackend(page);
  await page.goto(url);
  await expect(page.locator('#empty-state')).toBeVisible();
  await page.locator('#file-input').setInputFiles([
    { name: 'alpha.xml', mimeType: 'text/xml', buffer: Buffer.from('<Invoice/>') },
    { name: 'beta.xml', mimeType: 'text/xml', buffer: Buffer.from('<Invoice/>') },
  ]);
  await expect(page.locator('.document-tab-group')).toHaveCount(2);
  await page.getByRole('button', { name: 'XML brut', exact: true }).click();
  await page.reload();
  await expect(page.locator('.document-tab-group')).toHaveCount(2);
  await expect(page.locator('#fv-name')).toHaveText('beta.xml');
  await expect(page.locator('#tab-raw')).toHaveClass(/active/);
  await page.locator('#quick-query').fill('FAC-2026-\\d+');
  await page.locator('#quick-regex').check();
  await expect(page.locator('#quick-status')).toContainText('1 / 1');
  await expect(page.locator('#fv-name')).toHaveText('beta.xml');
  await page.locator('#document-tabs').getByRole('button', { name: 'alpha.xml', exact: true }).click();
  await expect(page.locator('#quick-status')).toContainText('1 / 1');
  await expect(page.locator('#fv-name')).toHaveText('alpha.xml');
  await page.locator('#document-tabs').getByRole('button', { name: 'Accueil', exact: true }).click();
  await expect(page.locator('#quick-status')).toContainText('Sélectionnez un document');
  await expect(page.locator('#quick-next')).toBeDisabled();
  await page.locator('#quick-scope').selectOption('all');
  await expect(page.locator('#quick-status')).toContainText('1 / 2');
  await expect(page.locator('#xml-table .quick-hit')).toHaveCount(1);
  await page.locator('#quick-next').click();
  await expect(page.locator('#quick-status')).toContainText('2 / 2');
  await page.locator('#quick-query').fill('');
  await page.locator('#document-tabs').getByRole('button', { name: 'Accueil', exact: true }).click();
  await expect(page.locator('#empty-state')).toBeVisible();
  await expect(page.locator('#recent-files button')).toHaveCount(2);
  await page.screenshot({ path: 'test-results/workspace-home.png' });
  await page.locator('#recent-files button').filter({ hasText: 'alpha.xml' }).click();
  await expect(page.locator('.document-tab-group')).toHaveCount(2);
  await page.getByRole('button', { name: 'Fermer alpha.xml', exact: true }).click();
  await expect(page.locator('.document-tab-group')).toHaveCount(1);
  await page.evaluate(() => {
    const settings = JSON.parse(localStorage.getItem('fx-settings') || '{}');
    settings.startup = 'home'; localStorage.setItem('fx-settings', JSON.stringify(settings));
  });
  await page.reload();
  await expect(page.locator('#empty-state')).toBeVisible();
  await expect(page.locator('.document-tab-group')).toHaveCount(0);
  await page.locator('#welcome-resume').click();
  await expect(page.locator('.document-tab-group')).toHaveCount(1);
  await page.evaluate(async () => { await addPaths({ files: ['C:/missing.xml'] }); });
  await expect(page.locator('.document-tab-group')).toHaveCount(2);
  await page.reload();
  await page.locator('#welcome-resume').click();
  await expect(page.locator('#workspace-message')).toContainText('1 document');
  await expect(page.locator('.document-tab-group')).toHaveCount(2);
  expect(errors).toEqual([]);
});

test('PDF multipage : zoom et position après changement de vue et rechargement', async ({ page }) => {
  await mockBackend(page, require('./fixtures.cjs').invoicePdf().toString('base64'));
  await page.goto(url);
  await page.locator('#file-input').setInputFiles({ name: 'synthetic.pdf', mimeType: 'application/pdf', buffer: Buffer.from('test') });
  await expect(page.locator('.pdf-page')).toHaveCount(2);
  await page.locator('#pdf-zoom').selectOption('1.5');
  await page.waitForFunction(() => getFile(state.selected)?.rendered.pdf && state.zoom === 1.5 && !workspaceScrollTarget);
  await page.evaluate(() => { document.querySelector('.main').scrollTop = 650; });
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('fx-workspace')).files[0].view.scroll.pdf)).toBe(650);
  await page.getByRole('button', { name: 'XML brut', exact: true }).click();
  await page.getByRole('button', { name: 'PDF', exact: true }).click();
  await expect.poll(() => page.evaluate(() => document.querySelector('.main').scrollTop)).toBe(650);
  await page.reload();
  await expect(page.locator('.pdf-page')).toHaveCount(2);
  await expect.poll(() => page.evaluate(() => document.querySelector('.main').scrollTop)).toBe(650);
  await expect(page.locator('#pdf-zoom')).toHaveValue('1.5');
});

test('nettoyage conserve la session, quota et copie manquante sont signalés', async ({ page }) => {
  await mockBackend(page);
  await page.goto(url);
  await page.locator('#file-input').setInputFiles({ name: 'kept.xml', mimeType: 'text/xml', buffer: Buffer.from('<Invoice/>') });
  await expect(page.locator('#fv-name')).toHaveText('kept.xml');
  await page.evaluate(async () => {
    await workspaceBlob('put', 'orphan', new Blob(['unused']));
    await clearWorkspaceHistory();
  });
  const stored = await page.evaluate(() => workspaceBlob('list'));
  expect(stored).toHaveLength(1);
  await expect(page.locator('#recent-files button')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('#fv-name')).toHaveText('kept.xml');
  await page.evaluate(async () => {
    const original = workspaceBlob;
    workspaceBlob = async (action, ...args) => {
      if (action === 'prune') return [{ key: 'full', size: WORKSPACE_CACHE_LIMIT }];
      return original(action, ...args);
    };
    try { await addFiles([new File(['x'], 'quota.xml')]); } finally { workspaceBlob = original; }
  });
  await expect(page.locator('#workspace-message')).toContainText('Limite de cache');
  await expect(page.locator('#fv-name')).toHaveText('quota.xml');
  await page.reload();
  await expect(page.locator('#workspace-message')).toContainText('1 document');
  await expect(page.locator('.document-tab-group')).toHaveCount(2);
});

test('session invalide et échec localStorage ne bloquent pas l’import', async ({ page }) => {
  await mockBackend(page);
  await page.goto(url);
  await page.evaluate(() => localStorage.setItem('fx-workspace', '{"files":42}'));
  await page.reload();
  await expect(page.locator('#workspace-message')).toContainText('illisible');
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new DOMException('Full', 'QuotaExceededError'); }; });
  await page.locator('#file-input').setInputFiles({ name: 'available.xml', mimeType: 'text/xml', buffer: Buffer.from('x') });
  await expect(page.locator('#fv-name')).toHaveText('available.xml');
  await expect(page.locator('#workspace-message')).toContainText('enregistrée');
});

test('lot volumineux : 500 documents, limites et reprise', async ({ page }) => {
  test.setTimeout(90000);
  await mockBackend(page);
  await page.goto(url);
  await page.evaluate(async () => { await addPaths({ files: Array.from({ length: 505 }, (_, i) => `C:/batch-${i}.xml`) }); });
  await expect(page.locator('.document-tab-group')).toHaveCount(500);
  await expect(page.locator('#workspace-message')).toContainText('500 documents');
  await page.reload();
  await expect(page.locator('.document-tab-group')).toHaveCount(500);
  await expect(page.locator('#fv-name')).toHaveText('batch-499.xml', { timeout: 60000 });
});
