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
async function mockBackend(page, pdf = null, extra = {}) {
  await page.addInitScript(({ pdf, extra }) => {
    window.__TAURI__ = { core: { invoke: async (command, args) => {
      if (command === 'startup_paths') return { files: [] };
      if (command === 'app_info') return { version: 'test', pointages: 'test' };
      if (command === 'get_pointage') return { lines: [] };
      if (command === 'parse_path' && args.path.includes('missing')) throw new Error('Fichier introuvable');
      if (command === 'save_text') { window.__saved = args; return true; }
      if (command === 'parse_file' || command === 'parse_path') return {
        format: 'CII', root: 'CrossIndustryInvoice', doc_hash: 'fixture', header: [], lines: [],
        rows: [{ title: 'Référence', tag: 'ID', value: 'FAC-2026-123', path: 'Invoice/ID' }],
        xml_pretty: '<Invoice>FAC-2026-123</Invoice>', summary: [], sections: [], warnings: [],
        pdf: pdf ? { base64: pdf, filename: 'synthetic.pdf' } : null,
        ...extra,
      };
      return {};
    } } };
  }, { pdf, extra });
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
  // L'onglet apparaît dès le début de la reprise : attendre sa fin avant d'ajouter un document.
  await page.waitForFunction(() => !workspaceRestoring);
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

test('contrôles affichés, doublon signalé et export CSV des lignes visibles', async ({ page }) => {
  const cell = (title, value) => ({ title, value, path: 'Invoice/x' });
  const line = (id, name, qty, price, total) => ({ fields: [], cells: {
    id: cell('N° de ligne', id), name: cell('Designation', name), qty: cell('Quantite', qty),
    price: cell('Prix unitaire HT', price), total: cell('Total ligne HT', total),
  } });
  await mockBackend(page, null, {
    summary: [{ title: 'N° de facture', value: 'F-1' }, { title: 'Vendeur', value: 'Test Seller' }],
    lines_columns: [
      { key: 'id', title: 'N°', align: 'left' }, { key: 'name', title: 'Designation', align: 'left' },
      { key: 'qty', title: 'Quantite', align: 'right' }, { key: 'price', title: 'P.U. HT', align: 'right' },
      { key: 'total', title: 'Total HT', align: 'right' }, { key: 'detail', title: 'Détail', align: 'left' },
    ],
    lines: [line('1', 'Toner; noir', '2', '50.00 EUR', '100.00 EUR'), line('2', '=SUM(A1)', '1.5', '-3.00 EUR', '-4.50 EUR')],
    controles: [
      { regle: 'Mentions essentielles présentes', etat: 'conforme', attendu: '', constate: '', ecart: '', path: '', detail: '' },
      { regle: 'Total TTC = total HT + total TVA', etat: 'ecart', attendu: '120.00', constate: '120.01', ecart: '0.01', path: 'Invoice/ID', detail: '100.00 + 20.00' },
    ],
  });
  await page.goto(url);
  await page.locator('#file-input').setInputFiles([
    { name: 'one.xml', mimeType: 'text/xml', buffer: Buffer.from('<Invoice/>') },
    { name: 'two.xml', mimeType: 'text/xml', buffer: Buffer.from('<Invoice/>') },
  ]);
  await expect(page.locator('.file-item .badge.err')).toHaveCount(2);
  await page.getByRole('button', { name: 'Données', exact: true }).click();
  const controls = page.locator('#controls');
  await expect(controls).toHaveAttribute('open', '');
  await expect(controls.locator('summary')).toContainText('1 écart');
  await expect(controls.locator('summary')).toContainText('1 alerte');
  await expect(controls.locator('tr.ctl-ecart')).toContainText('120.01');
  await expect(controls.locator('tr.ctl-alerte')).toContainText('XML identique : one.xml');
  await page.locator('#btn-lines-export').click();
  await expect.poll(() => page.evaluate(() => window.__saved?.filename)).toBe('two-lignes.csv');
  expect(await page.evaluate(() => window.__saved.content)).toBe(
    '\uFEFFPointée;N°;Designation;Quantite;P.U. HT;Total HT;Devise\r\n' +
    'non;1;"Toner; noir";2;50,00;100,00;EUR\r\n' +
    "non;2;'=SUM(A1);1,5;-3,00;-4,50;EUR\r\n");
  await page.locator('#lines-search').fill('toner');
  await page.locator('#btn-lines-export').click();
  await expect.poll(() => page.evaluate(() => window.__saved.content.split('\r\n').length)).toBe(3);
  await controls.locator('tr.ctl-ecart').click();
  await expect(page.locator('#tab-xml')).toHaveClass(/active/);
});

test('tableau multi-factures : totaux, filtres, export et menu contextuel', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await mockBackend(page, null, {
    synthese: { numero: 'F-1', type: '380', avoir: false, date: '2026-10-03', echeance: '2026-09-01', jours_echeance: -31,
      week_end: true, vendeur: 'Test Seller', acheteur: 'Buyer', devise: 'EUR', ht: '1000.00', tva: '200.00', ttc: '1200.00', a_payer: '1200.00' },
    controles: [
      { regle: 'Total TTC = total HT + total TVA', etat: 'ecart', attendu: '1200.00', constate: '1200.01', ecart: '0.01', path: 'Invoice/ID', detail: '' },
    ],
  });
  await page.goto(url);
  await expect(page.locator('#tab-batch')).toHaveCount(0);
  await page.locator('#file-input').setInputFiles([
    { name: 'one.xml', mimeType: 'text/xml', buffer: Buffer.from('<Invoice/>') },
    { name: 'two.xml', mimeType: 'text/xml', buffer: Buffer.from('<Invoice/>') },
  ]);
  await expect(page.locator('#fv-name')).toHaveText('two.xml');
  await page.evaluate(async () => { await addPaths({ files: ['C:/missing.xml'] }); });
  await page.locator('#tab-batch').click();
  await expect(page.locator('#batch-view')).toBeVisible();
  await expect(page.locator('#file-view')).toBeHidden();
  const rows = page.locator('#batch-table tbody tr.batch-row');
  await expect(rows).toHaveCount(3);
  await expect(page.locator('#batch-count')).toHaveText('3 documents');
  await expect(rows.first()).toContainText('1 écart, doublon');
  await expect(rows.first()).toContainText('échue depuis 31 j');
  await expect(rows.last()).toContainText('Erreur de lecture');
  await expect(page.locator('#batch-table tfoot tr')).toContainText('Total EUR — 2 documents');
  await expect(page.locator('#batch-table tfoot tr')).toContainText('2 400,00');
  await page.screenshot({ path: 'test-results/batch.png' });
  await page.locator('#batch-filter').selectOption('erreur');
  await expect(rows).toHaveCount(1);
  await page.locator('#batch-filter').selectOption('avoir');
  await expect(page.locator('.batch-empty')).toHaveText('Aucun document ne correspond au filtre.');
  await page.locator('#batch-filter').selectOption('echue');
  await expect(rows).toHaveCount(2);
  await expect(page.locator('#batch-count')).toHaveText('2 / 3 documents');
  await page.locator('#batch-export').click();
  await expect.poll(() => page.evaluate(() => window.__saved?.filename)).toBe('factures.csv');
  const csv = (await page.evaluate(() => window.__saved.content)).split('\r\n');
  expect(csv[0]).toBe('\uFEFFFichier;Vendeur;N°;Type;Date;Échéance;HT;TVA;TTC;À payer;Devise;Contrôles;Jours avant échéance;Détail des contrôles');
  expect(csv[1]).toBe('one.xml;Test Seller;F-1;Facture;2026-10-03;2026-09-01;1000,00;200,00;1200,00;1200,00;EUR;1 écart, doublon;-31;Total TTC = total HT + total TVA (0.01)');
  expect(csv).toHaveLength(4);

  await page.evaluate(() => { clipboardWrite = async text => { window.__clip = text; }; });
  await rows.first().locator('td').nth(1).click({ button: 'right' });
  const menu = page.locator('.ctx-menu');
  await expect(menu).toBeVisible();
  await page.screenshot({ path: 'test-results/context-menu.png' });
  await menu.getByRole('menuitem', { name: 'Copier la cellule', exact: true }).click();
  await expect(menu).toHaveCount(0);
  await expect(page.locator('.toast')).toHaveText('Cellule copiée');
  expect(await page.evaluate(() => window.__clip)).toBe('Test Seller');
  await rows.first().locator('td').nth(6).click({ button: 'right' });
  await menu.locator('.ctx-formats').first().getByRole('menuitem', { name: 'JSON' }).click();
  expect(JSON.parse(await page.evaluate(() => window.__clip))).toMatchObject({ Fichier: 'one.xml', HT: '1000.00', Devise: 'EUR' });
  await rows.first().locator('td').nth(6).click({ button: 'right' });
  await menu.getByRole('menuitem', { name: 'Copier la colonne « HT »' }).click();
  expect(await page.evaluate(() => window.__clip)).toBe('1000.00\n1000.00');
  await rows.first().locator('td').nth(0).click({ button: 'right' });
  await menu.locator('.ctx-formats').nth(1).getByRole('menuitem', { name: 'Markdown' }).click();
  expect((await page.evaluate(() => window.__clip)).split('\n')[1]).toMatch(/^\| --- \| --- /);
  await rows.first().locator('td').nth(0).click({ button: 'right' });
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);

  await rows.first().click();
  await expect(page.locator('#fv-name')).toHaveText('one.xml');
  await expect(page.locator('#batch-view')).toBeHidden();
  expect(errors).toEqual([]);
});

test('barre de menus, onglets Accueil et Tableau fixes, menu d’onglet', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await mockBackend(page);
  await page.goto(url);
  const menubar = page.locator('#menubar');
  const drop = page.locator('.menubar-drop');
  await menubar.getByRole('button', { name: 'Fichier' }).click();
  await expect(drop.getByRole('menuitem', { name: 'Ouvrir des fichiers… Ctrl+O' })).toBeEnabled();
  await expect(drop.getByRole('menuitem', { name: 'Fermer tous les documents' })).toBeDisabled();
  await menubar.getByRole('button', { name: 'Affichage' }).hover();
  await expect(drop.getByRole('menuitem', { name: '✓ Accueil' })).toBeVisible();
  await expect(drop.getByRole('menuitem', { name: 'Tableau des factures' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(drop).toHaveCount(0);
  await expect(menubar.locator('[aria-expanded="true"]')).toHaveCount(0);

  await page.evaluate(async () => { await addPaths({ files: Array.from({ length: 30 }, (_, i) => `C:/facture-numero-${i}.xml`) }); });
  await expect(page.locator('.document-tab-group')).toHaveCount(30);
  // Le dernier onglet est sélectionné : la barre a défilé, Accueil et Tableau restent à gauche.
  const tabs = page.locator('#document-tabs');
  expect(await tabs.evaluate(nav => nav.scrollLeft)).toBeGreaterThan(500);
  const left = await tabs.evaluate(nav => nav.getBoundingClientRect().left);
  const home = tabs.getByRole('button', { name: 'Accueil', exact: true });
  expect((await home.boundingBox()).x).toBeCloseTo(left, 0);
  const fixedRight = await page.locator('.document-tabs-fixed').evaluate(el => el.getBoundingClientRect().right);
  expect((await page.locator('.document-tab-group.selected').boundingBox()).x).toBeGreaterThanOrEqual(fixedRight - 1);
  await tabs.evaluate(nav => { nav.scrollLeft = 0; });
  await page.evaluate(() => selectFile(state.files[0].id));
  expect((await page.locator('.document-tab-group.selected').boundingBox()).x).toBeGreaterThanOrEqual(fixedRight - 1);
  await page.screenshot({ path: 'test-results/menubar.png' });

  await menubar.getByRole('button', { name: 'Affichage' }).click();
  await drop.getByRole('menuitem', { name: 'Tableau des factures' }).click();
  await expect(page.locator('#batch-view')).toBeVisible();
  await menubar.getByRole('button', { name: 'Affichage' }).click();
  await expect(drop.getByRole('menuitem', { name: '✓ Tableau des factures' })).toBeVisible();
  await drop.getByRole('menuitem', { name: 'Document suivant Ctrl+Tab' }).click();
  await expect(page.locator('#fv-name')).toHaveText('facture-numero-0.xml');
  await menubar.getByRole('button', { name: 'Affichage' }).click();
  await drop.getByRole('menuitem', { name: 'XML brut' }).click();
  await expect(page.locator('#tab-raw')).toHaveClass(/active/);

  await page.locator('.document-tab-group').nth(0).click({ button: 'right' });
  await page.locator('.ctx-menu').getByRole('menuitem', { name: 'Fermer les autres' }).click();
  await expect(page.locator('.document-tab-group')).toHaveCount(1);
  await expect(page.locator('#fv-name')).toHaveText('facture-numero-0.xml');
  expect(errors).toEqual([]);
});
