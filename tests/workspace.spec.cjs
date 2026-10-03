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
      if (command === 'validate_schematron') {
        window.__schematronCalls = [...(window.__schematronCalls || []), { format: args.format, priority: args.priority, library: args.library, xml: args.xml }];
        return JSON.parse(sessionStorage.getItem('mock-schematron') || '{}');
      }
      if (command === 'library_status') return window.__libraryBroken
        ? { ok: false, erreur: 'La bibliothèque (bibliotheque.sqlite) est illisible : file is not a database.', factures: 0, chemin: 'bibliotheque.sqlite' }
        : { ok: true, erreur: '', factures: 2, chemin: 'bibliotheque.sqlite' };
      if (command === 'library_search') {
        window.__libraryQueries = [...(window.__libraryQueries || []), args.query];
        const all = [
          { hash: 'h-old', fichier: 'ancienne.pdf', chemin: 'C:/archives/ancienne.pdf', format: 'CII', numero: 'F-2025-9', avoir: false, date: '2025-11-03', echeance: '', vendeur: 'Papeterie Durand SAS', acheteur: 'Buyer', devise: 'EUR', ht: '1000.00', tva: '200.00', ttc: '1200.00', a_payer: '1200.00', vue_le: '2026-09-30 10:00:00', revue_le: '2026-09-30 10:00:00', lignes: 4 },
          { hash: 'h-drop', fichier: 'deposee.pdf', chemin: '', format: 'UBL', numero: 'AV-7', avoir: true, date: '2025-10-01', echeance: '', vendeur: 'Nordik Transport', acheteur: 'Buyer', devise: 'EUR', ht: '50.00', tva: '10.00', ttc: '60.00', a_payer: '60.00', vue_le: '2026-09-29 10:00:00', revue_le: '2026-09-29 10:00:00', lignes: 1 },
        ].filter(row => !(window.__libraryRemoved || []).includes(row.hash));
        const q = args.query.trim().toLowerCase();
        const f = args.filters || {};
        const matching = all.filter(row => (!q || JSON.stringify(row).toLowerCase().includes(q))
          && (!f.dateMin || row.date >= f.dateMin) && (!f.dateMax || row.date && row.date <= f.dateMax)
          && (!f.fournisseur || row.vendeur.toLowerCase().includes(f.fournisseur.toLowerCase()))
          && (f.montantMin == null || Number(row.ttc) >= f.montantMin)
          && (f.montantMax == null || Number(row.ttc) <= f.montantMax));
        return { factures: matching.slice(f.offset || 0, (f.offset || 0) + 1000), total: all.length,
          correspondances: matching.length, offset: f.offset || 0, limite: 1000, tronque: false };
      }
      if (command === 'library_remove') { window.__libraryRemoved = [...(window.__libraryRemoved || []), args.hash]; return null; }
      if (command === 'library_reset') { window.__libraryBroken = false; return null; }
      if (command === 'library_prices') return [
        { date: '2026-08-01', numero: 'F-1', pu: '50.00', qte: '2', devise: 'EUR', fichier: 'f1.pdf', courante: false },
        { date: '2026-10-01', numero: 'F-9', pu: '52.50', qte: '2', devise: 'EUR', fichier: 'f9.pdf', courante: true },
      ];
      if (window.__dataBroken && ['get_reviews', 'set_review', 'get_pointage', 'set_pointage'].includes(command))
        throw new Error('pointages.json est illisible : JSON invalide. Rien n\'a été enregistré. Restaurez une sauvegarde depuis les Paramètres.');
      if (command === 'get_reviews') return JSON.parse(localStorage.getItem('mock-suivi') || '{}');
      if (command === 'set_review') {
        const all = JSON.parse(localStorage.getItem('mock-suivi') || '{}');
        all[args.key] = { ...args.review, filename: args.filename };
        localStorage.setItem('mock-suivi', JSON.stringify(all)); return null;
      }
      if (command === 'data_status') {
        const ok = !window.__dataBroken;
        const part = { chemin: 'x', ok, erreur: ok ? '' : 'pointages.json est illisible : JSON invalide.', entrees: 2, sauvegardes: ['pointages.sauvegarde-2026-10-01.json'] };
        return { pointages: part, suivi: { ...part, ok: true, erreur: '' } };
      }
      if (command === 'restore_backup') { window.__dataBroken = false; window.__restored = args.which; return 'pointages.sauvegarde-2026-10-01.json'; }
      if (command === 'export_data') { window.__exported = true; return true; }
      if (command === 'import_data') return { pointages: 3, suivi: 1 };
      if (command === 'save_control_report') { window.__report = args; return true; }
      if (command === 'print_window') { window.__printed = { theme: document.documentElement.dataset.theme, rules: document.querySelector('#rules')?.open }; return null; }
      if (command === 'parse_file' || command === 'parse_path' || command === 'library_open' || command === 'library_relink') return {
        ...(command.startsWith('library_') ? { filename: 'ancienne.pdf', replacement_path: 'C:/archives/ancienne.pdf' } : {}),
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
  await expect(page.locator('#quick-search')).toBeHidden();
  await expect(page.locator('.topbar')).toBeHidden();
  await page.locator('#btn-search').click();
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
  await page.locator('#quick-close').click();
  await expect(page.locator('#quick-search')).toBeHidden();
  await expect(page.locator('#xml-table .quick-hit')).toHaveCount(0);
  await page.keyboard.press('Control+f');
  await expect(page.locator('#quick-query')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#quick-search')).toBeHidden();
  await page.locator('#document-tabs').getByRole('button', { name: 'Accueil', exact: true }).click();
  await expect(page.locator('#empty-state')).toBeVisible();
  await expect(page.locator('#recent-files .recent-file')).toHaveCount(2);
  await page.screenshot({ path: 'test-results/workspace-home.png' });
  await page.locator('#recent-files .recent-file').filter({ hasText: 'alpha.xml' }).click();
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
  // Le message se ferme à la demande.
  await page.locator('#workspace-message-close').click();
  await expect(page.locator('#workspace-message')).toBeHidden();
  // Sans document, l'en-tête complet revient.
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#menubar').getByRole('button', { name: 'Fichier' }).click();
  await page.locator('.menubar-drop').getByRole('menuitem', { name: 'Fermer tous les documents' }).click();
  await expect(page.locator('.topbar')).toBeVisible();
  await expect(page.locator('#add-files')).toBeVisible();
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
  await expect(page.locator('#recent-files .recent-file')).toHaveCount(0);
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
      { regle: 'Mentions essentielles présentes', famille: 'mention', etat: 'conforme', attendu: '', constate: '', ecart: '', path: '', detail: '' },
      { regle: 'Total TTC = total HT + total TVA', famille: 'calcul', etat: 'ecart', attendu: '120.00', constate: '120.01', ecart: '0.01', path: 'Invoice/ID', detail: '100.00 + 20.00' },
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
      { regle: 'Total TTC = total HT + total TVA', famille: 'calcul', etat: 'ecart', attendu: '1200.00', constate: '1200.01', ecart: '0.01', path: 'Invoice/ID', detail: '' },
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
  await expect(rows.first()).toContainText('1 écart');
  await expect(rows.first()).toContainText('Non évaluées');
  await expect(rows.first()).toContainText('doublon');
  await expect(page.locator('#batch-note')).toContainText('Aucun verdict ne vaut certification');
  await expect(rows.first()).toContainText('échue depuis 31 j');
  await expect(rows.last()).toContainText('Non lue');
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

  // Filtres métier : fournisseur, montants et remise à zéro
  await page.locator('#batch-filter').selectOption('all');
  await expect(rows).toHaveCount(3);
  await page.locator('#batch-seller').fill('Inconnu');
  await expect(page.locator('.batch-empty')).toHaveText('Aucun document ne correspond au filtre.');
  await page.locator('#batch-seller').fill('Test');
  await expect(rows).toHaveCount(2);
  await page.locator('#batch-amount-min').fill('1500');
  await expect(page.locator('.batch-empty')).toHaveText('Aucun document ne correspond au filtre.');
  await page.locator('#batch-amount-min').fill('500');
  await page.locator('#batch-amount-max').fill('1300');
  await expect(rows).toHaveCount(2);
  await page.locator('#batch-reset-filters').click();
  await expect(rows).toHaveCount(3);
  await expect(page.locator('#batch-seller')).toHaveValue('');
  await expect(page.locator('#batch-amount-min')).toHaveValue('');

  await page.locator('#batch-filter').selectOption('echue');
  await expect(rows).toHaveCount(2);
  await page.locator('#batch-export').click();
  await expect.poll(() => page.evaluate(() => window.__saved?.filename)).toBe('factures.csv');
  const csv = (await page.evaluate(() => window.__saved.content)).split('\r\n');
  expect(csv[0]).toBe('\uFEFFFichier;Vendeur;N°;Type;Date;Échéance;HT;TVA;TTC;À payer;Devise;Calculs;Règles EN 16931;Schematron;Schéma XSD;Règles françaises;Conteneur PDF;Alertes;Vérification;Jours avant échéance;Détail des contrôles;Commentaire');
  expect(csv[1]).toBe('one.xml;Test Seller;F-1;Facture;2026-10-03;2026-09-01;1000,00;200,00;1200,00;1200,00;EUR;1 écart;Non évaluées;Non évalué;Non évalué;—;—;doublon;À vérifier;-31;Total TTC = total HT + total TVA (0.01);');
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

  // Les licences des composants embarqués sont consultables dans l'application.
  await menubar.getByRole('button', { name: 'Aide' }).click();
  await drop.getByRole('menuitem', { name: 'Licences des composants tiers' }).click();
  await expect(page.locator('#licenses-dialog')).toBeVisible();
  await expect(page.locator('#licenses-body')).toContainText('European Union Public Licence (EUPL) version 1.2');
  await expect(page.locator('#licenses-body')).toContainText('EUROPEAN UNION PUBLIC LICENCE v. 1.2');
  await expect(page.locator('#licenses-body')).toContainText('ConnectingEurope/eInvoicing-EN16931');
  await page.locator('#licenses-close').click();
  await expect(page.locator('#licenses-dialog')).toBeHidden();

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

  // Pas d'ascenseur horizontal : la liste des documents ouverts s'ouvre par le chevron et se filtre.
  expect(await tabs.evaluate(nav => nav.offsetHeight - nav.clientHeight)).toBe(0);
  await page.locator('#btn-doc-list').click();
  const picker = page.locator('.doc-picker');
  await expect(picker.getByRole('option')).toHaveCount(30);
  await picker.getByRole('textbox').fill('numero-17');
  await expect(picker.getByRole('option')).toHaveCount(1);
  await page.screenshot({ path: 'test-results/doc-picker.png' });
  await page.keyboard.press('Enter');
  await expect(picker).toHaveCount(0);
  await expect(page.locator('#fv-name')).toHaveText('facture-numero-17.xml');
  await page.keyboard.press('Control+e');
  await expect(picker).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(picker).toHaveCount(0);

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

  // Accueil : cinq documents récents, « Plus… » ouvre la liste complète, la croix en retire un.
  await page.locator('#document-tabs').getByRole('button', { name: 'Accueil', exact: true }).click();
  await expect(page.locator('#recent-files .recent-file')).toHaveCount(5);
  await page.locator('#recent-files .recent-more').click();
  await expect(page.locator('.doc-picker').getByRole('option')).toHaveCount(12);
  await page.screenshot({ path: 'test-results/welcome-recent.png' });
  await page.keyboard.press('Escape');
  await expect(page.locator('.doc-picker')).toHaveCount(0);
  const firstRecent = await page.locator('#recent-files .recent-file span').first().textContent();
  await page.locator('#recent-files .recent-row').first().hover();
  await page.locator('#recent-files .recent-remove').first().click();
  await expect(page.locator('#recent-files .recent-file')).toHaveCount(5);
  await expect(page.locator('#recent-files')).not.toContainText(firstRecent);
  expect(errors).toEqual([]);
});

test('suivi de vérification, rapport JSON, vue PDF et données, tableau persistant', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const cell = (title, value) => ({ title, value, path: 'Invoice/x' });
  await mockBackend(page, require('./fixtures.cjs').invoicePdf().toString('base64'), {
    synthese: { numero: 'F-1', type: '380', avoir: false, date: '2026-10-01', echeance: '', jours_echeance: null,
      week_end: false, vendeur: 'Test Seller', acheteur: 'Buyer', devise: 'EUR', ht: '100.00', tva: '20.00', ttc: '120.00', a_payer: '120.00' },
    controles: [{ regle: 'Total TTC = total HT + total TVA', famille: 'calcul', etat: 'conforme', attendu: '120.00', constate: '120.00', ecart: '', path: 'Invoice/ID', detail: '' }],
    lines_columns: [{ key: 'name', title: 'Désignation', align: 'left' }],
    lines: [{ fields: [], cells: { name: cell('Désignation', 'Toner') } }],
  });
  await page.goto(url);
  await page.locator('#file-input').setInputFiles({ name: 'suivi.pdf', mimeType: 'application/pdf', buffer: Buffer.from('test') });
  await expect(page.locator('.pdf-page')).toHaveCount(2);

  // Vue côte à côte : les deux volets sont visibles en même temps.
  await page.getByRole('button', { name: 'PDF et données', exact: true }).click();
  await expect(page.locator('#reading-panes')).toHaveClass('dual-reading');
  await expect(page.locator('#tab-pdf')).toBeVisible();
  await expect(page.locator('#tab-data #controls')).toBeVisible();
  await expect(page.locator('.pdf-page')).toHaveCount(2);

  // Suivi : statut et commentaires, enregistrés par empreinte du XML.
  const panel = page.locator('#tab-data .review-panel');
  await panel.locator('summary span').click();
  await page.getByLabel('Commentaire de la facture', { exact: true }).fill('À revoir avec le fournisseur');
  await page.getByLabel('Commentaire de la ligne', { exact: true }).fill('Quantité à confirmer');
  await panel.getByLabel('Vérification de suivi.pdf').selectOption('Anomalie');
  await panel.getByRole('button', { name: 'Pointer toutes les lignes' }).click();
  await expect(page.locator('#lines-pointed-count')).toHaveText('1 ligne pointée');

  await page.locator('#controls summary span').first().click();
  await page.locator('#btn-control-report').click();
  await expect.poll(() => page.evaluate(() => window.__report?.filename)).toBe('suivi-controles.json');
  const report = await page.evaluate(() => window.__report.report);
  expect(report).toMatchObject({ fichier: 'suivi.pdf', empreinte_xml: 'fixture', synthese: { ttc: '120.00' },
    suivi: { statut: 'Anomalie', commentaire: 'À revoir avec le fournisseur', lignes: { 0: 'Quantité à confirmer' } } });
  expect(report.controles).toHaveLength(1);

  // Le tableau reprend le statut, le filtre et l'export ; il est rouvert après rechargement.
  await page.locator('#tab-batch').click();
  const rows = page.locator('#batch-table tbody tr.batch-row');
  await expect(rows.first().getByLabel('Vérification de suivi.pdf')).toHaveValue('Anomalie');
  await page.locator('#batch-filter').selectOption('s:Vérifiée');
  await expect(rows).toHaveCount(0);
  await page.locator('#batch-filter').selectOption('s:Anomalie');
  await expect(rows).toHaveCount(1);
  await page.locator('#batch-search').fill('fournisseur');
  await expect(rows).toHaveCount(1);
  await page.locator('#batch-export').click();
  await expect.poll(() => page.evaluate(() => window.__saved?.content.split('\r\n')[1])).toContain(';Anomalie;;;À revoir avec le fournisseur');
  await rows.first().getByLabel('Vérification de suivi.pdf').selectOption('Vérifiée');
  await expect(rows).toHaveCount(0);
  await expect(page.locator('#batch-view')).toBeVisible();
  await page.reload();
  await expect(page.locator('#batch-view')).toBeVisible();
  await page.locator('#batch-filter').selectOption('all');
  await page.locator('#batch-table tbody tr.batch-row td').first().click();
  await expect(page.locator('#reading-panes')).toHaveClass('dual-reading');
  await expect(page.getByLabel('Commentaire de la facture', { exact: true })).toHaveValue('À revoir avec le fournisseur');
  await expect(page.locator('#tab-data').getByLabel('Vérification de suivi.pdf')).toHaveValue('Vérifiée');
  await page.screenshot({ path: 'test-results/dual.png' });
  expect(errors).toEqual([]);
});

test('règles EN 16931 affichées, filtrées dans le tableau, et impression', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const rule = (id, etat, detail = '') => ({ id, libelle: 'Énoncé de ' + id, etat, detail, path: 'Invoice/ID' });
  await mockBackend(page, null, {
    synthese: { numero: 'F-9', type: '380', avoir: false, date: '2026-10-01', echeance: '', jours_echeance: null,
      week_end: false, vendeur: 'Test Seller', acheteur: '', devise: 'EUR', ht: '100.00', tva: '20.00', ttc: '120.00', a_payer: '120.00' },
    controles: [{ regle: 'Total TTC = total HT + total TVA', famille: 'calcul', etat: 'conforme', attendu: '120.00', constate: '120.00', ecart: '', path: '', detail: '' }],
    regles: { niveau: 'Règles métier EN 16931 (implémentation native, hors Schematron officiel).', evaluees: 3, non_conformes: 1,
      liste: [rule('BR-02', 'conforme'), rule('BR-07', 'non_conforme', 'Absent du XML.'), rule('BR-CO-15', 'conforme')] },
    sections: [{ name: 'Vendeur', rows: [{ title: 'Raison sociale', value: 'Test Seller', path: 'Invoice/x' }] }],
  });
  await page.goto(url);
  await page.evaluate(() => localStorage.setItem('fx-theme', 'nuit'));
  await page.reload();
  await page.locator('#file-input').setInputFiles({ name: 'regles.xml', mimeType: 'text/xml', buffer: Buffer.from('<Invoice/>') });
  await expect(page.locator('.file-item .badge.warn').filter({ hasText: '1 règle EN 16931' })).toBeVisible();
  await page.getByRole('button', { name: 'Données', exact: true }).click();
  const rules = page.locator('#rules');
  await expect(rules).toHaveAttribute('open', '');
  // Verdicts séparés : des calculs cohérents n'effacent pas une règle non respectée.
  const verdicts = page.locator('#verdicts .ctl-chip');
  await expect(verdicts).toHaveText(['Lecture réussie', 'Calculs cohérents', '1 règle EN 16931 non respectée', 'Schematron officiel non évalué', 'Schéma XSD non évalué']);
  await expect(page.locator('#verdicts .verdict-note')).toContainText('Non contrôlés : conformité PDF/A-3 complète');
  await expect(page.locator('#verdicts .verdict-note')).toContainText('ne vaut certification');
  await expect(rules.locator('summary')).toContainText('1 non respectée');
  await expect(rules.locator('summary')).toContainText('2 respectées');
  await expect(rules.locator('tbody tr').first()).toContainText('BR-07');
  await expect(rules.locator('tbody tr').first()).toContainText('Absent du XML.');
  await expect(rules.locator('.rules-note')).toContainText('Ne remplace pas une validation XSD');
  await expect(page.locator('#controls')).not.toHaveAttribute('open', '');

  // Impression : blocs dépliés et thème clair pendant l'impression, puis état d'origine.
  await page.locator('#menubar').getByRole('button', { name: 'Fichier' }).click();
  await page.locator('.menubar-drop').getByRole('menuitem', { name: 'Imprimer… Ctrl+P' }).click();
  await expect.poll(() => page.evaluate(() => window.__printed)).toEqual({ theme: 'jour', rules: true });
  await expect(page.locator('#controls')).toHaveAttribute('open', '');
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('#menubar')).toBeHidden();
  await expect(page.locator('#sidebar')).toBeHidden();
  await expect(page.locator('#tab-data .review-panel')).toBeHidden();
  await expect(page.locator('#fv-name')).toBeVisible();
  await expect(rules).toBeVisible();
  await page.screenshot({ path: 'test-results/print.png', fullPage: true });
  await page.emulateMedia({ media: 'screen' });
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await expect(page.locator('#controls')).not.toHaveAttribute('open', '');
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('nuit');

  await page.locator('#btn-control-report').click();
  await expect.poll(() => page.evaluate(() => window.__report?.report.regles_en16931?.non_conformes)).toBe(1);
  expect(await page.evaluate(() => window.__report.report.verdicts)).toEqual({ lecture: 'Lecture réussie', calculs: 'Calculs cohérents',
    regles_en16931: '1 règle EN 16931 non respectée', schema_xsd: 'Schéma XSD non évalué', schematron: 'Schematron officiel non évalué', conteneur: null, regles_francaises: null, autres_alertes: 0, non_controle: ['conformité PDF/A-3 complète du fichier (ses déclarations et quelques points de structure sont contrôlés)', 'règles nationales autres que françaises (XRechnung, Peppol…)'] });
  await page.locator('#tab-batch').click();
  await expect(page.locator('#batch-table tbody tr.batch-row')).toContainText('1 non respectée');
  await expect(page.locator('#batch-table tbody tr.batch-row')).toContainText('Cohérents');
  await page.locator('#batch-filter').selectOption('regles');
  await expect(page.locator('#batch-table tbody tr.batch-row')).toHaveCount(1);
  await rules.page().locator('#batch-export').click();
  await expect.poll(() => page.evaluate(() => window.__saved?.content.split('\r\n')[1])).toContain(';BR-07;');
  expect(errors).toEqual([]);
});

test('pointages et suivi : fichier illisible signalé, restauration, export, import, reprise de l’ancien stockage', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const cell = (title, value) => ({ title, value, path: 'Invoice/x' });
  await mockBackend(page, null, {
    doc_hash: 'abc', lines_columns: [{ key: 'name', title: 'Désignation', align: 'left' }],
    lines: [{ fields: [], cells: { name: cell('Désignation', 'Toner') } }],
  });
  // Suivi enregistré par une version précédente dans le stockage de la WebView.
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('seeded')) {
      sessionStorage.setItem('seeded', '1');
      localStorage.setItem('fx-review:abc', JSON.stringify({ status: 'Anomalie', comment: 'Ancien commentaire', lines: {} }));
    }
  });
  await page.goto(url);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('fx-review:abc'))).toBeNull();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('mock-suivi')).abc)).toMatchObject({ status: 'Anomalie', comment: 'Ancien commentaire' });
  await page.locator('#file-input').setInputFiles({ name: 'protege.xml', mimeType: 'text/xml', buffer: Buffer.from('<Invoice/>') });
  await page.getByRole('button', { name: 'Données', exact: true }).click();
  await expect(page.getByLabel('Commentaire de la facture', { exact: true })).toHaveValue('Ancien commentaire');

  // Un commentaire tapé est écrit dans le fichier, sans attendre la fermeture.
  await page.getByLabel('Commentaire de la facture', { exact: true }).fill('Nouveau commentaire');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('mock-suivi')).abc.comment)).toBe('Nouveau commentaire');

  // Paramètres : état, export, import.
  await page.locator('#btn-settings').click();
  await expect(page.locator('#data-status-text')).toContainText('Pointages : 2 factures, 1 sauvegarde quotidienne');
  await expect(page.locator('#data-restore')).toBeHidden();
  await page.locator('#data-export').click();
  await expect.poll(() => page.evaluate(() => window.__exported)).toBe(true);
  await page.locator('#data-import').click();
  await expect(page.locator('#workspace-message')).toContainText('Import terminé : 3 pointage(s) et 1 suivi(s)');
  await page.locator('#settings-close').click();

  // Fichier illisible : l'erreur est visible, pointer une ligne ne passe pas sous silence.
  await page.evaluate(() => { window.__dataBroken = true; });
  await page.locator('.point-btn').first().click();
  await expect(page.locator('#workspace-message')).toContainText('pointages.json est illisible');
  await expect(page.locator('#workspace-message')).toContainText('ouvrez les Paramètres pour restaurer une sauvegarde');
  await page.locator('#btn-settings').click();
  await expect(page.locator('#data-status-text .data-status-error')).toContainText('Rien n\'est écrasé');
  await expect(page.locator('#data-restore')).toBeVisible();
  await page.locator('#data-restore').click();
  await expect.poll(() => page.evaluate(() => window.__restored)).toBe('pointages');
  await expect(page.locator('#workspace-message')).toContainText('Sauvegarde restaurée : pointages.sauvegarde-2026-10-01.json');
  await expect(page.locator('#data-restore')).toBeHidden();
  expect(errors).toEqual([]);
});

test('bibliothèque : recherche, ouverture, retrait, historique des prix, réglage et base illisible', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  const cell = (title, value) => ({ title, value, path: 'Invoice/x' });
  await mockBackend(page, null, {
    synthese: { numero: 'F-9', type: '380', avoir: false, date: '2026-10-01', echeance: '', jours_echeance: null, week_end: false,
      vendeur: 'Papeterie Durand SAS', acheteur: 'Buyer', devise: 'EUR', ht: '100.00', tva: '20.00', ttc: '120.00', a_payer: '120.00',
      lignes: [{ ref: 'PAP-A4', nom: 'Papier A4', qte: '2', pu: '52.50', total: '105.00' }] },
    controles: [{ regle: 'IBAN différent des factures précédentes de ce fournisseur', etat: 'alerte', attendu: '', constate: '', ecart: '', path: 'Invoice/IBAN', detail: 'Cette facture : FR76… Précédemment : FR14…' }],
    lines_columns: [{ key: 'name', title: 'Désignation', align: 'left' }, { key: 'detail', title: 'Détail', align: 'left' }],
    lines: [{ fields: [{ title: 'Désignation', value: 'Papier A4', path: 'Invoice/x' }], cells: { name: cell('Désignation', 'Papier A4') } }],
  });
  await page.goto(url);
  // L'onglet Bibliothèque est disponible sans aucun document ouvert.
  await page.locator('#tab-library').click();
  const rows = page.locator('#library-table tbody tr');
  await expect(rows).toHaveCount(2);
  await expect(page.locator('#library-count')).toHaveText('2 résultats / 2 factures');
  await expect(rows.first()).toContainText('Papeterie Durand SAS');
  await expect(rows.first()).toContainText('1 200,00');
  await expect(rows.nth(1)).toContainText('Avoir');
  await page.locator('#library-search').fill('nordik');
  await expect(rows).toHaveCount(1);
  await expect(page.locator('#library-count')).toHaveText('1 résultat / 2 factures');
  await page.locator('#library-search').fill('introuvable');
  await expect(page.locator('#library-empty')).toHaveText('Aucune facture ne correspond à la recherche.');
  await page.locator('#library-search').fill('');
  await expect(rows).toHaveCount(2);

  // Fichier déposé : emplacement inconnu, on le dit. Fichier connu : il est rouvert par son chemin.
  await rows.nth(1).locator('td').first().click();
  await expect(page.locator('#workspace-message')).toContainText('son emplacement n\'est pas connu');
  await rows.first().locator('td').first().click();
  await expect(page.locator('#fv-name')).toHaveText('ancienne.pdf');
  await expect(page.locator('#library-view')).toBeHidden();

  // L'alerte tirée de l'historique apparaît dans les contrôles ; historique des prix dans le détail de ligne.
  await page.getByRole('button', { name: 'Données', exact: true }).click();
  await expect(page.locator('#controls')).toContainText('IBAN différent des factures précédentes');
  await page.locator('.detail-btn').first().click();
  await page.locator('.price-history-btn').first().click();
  const history = page.locator('.price-history table tbody tr');
  await expect(history).toHaveCount(2);
  await expect(history.nth(1)).toContainText('F-9 (cette facture)');
  await expect(history.nth(1).locator('.price-up')).toHaveText('+5,0 %');

  // Retrait d'une entrée.
  await page.locator('#menubar').getByRole('button', { name: 'Affichage' }).click();
  await page.locator('.menubar-drop').getByRole('menuitem', { name: 'Bibliothèque' }).click();
  await rows.nth(1).getByRole('button', { name: 'Retirer deposee.pdf de la bibliothèque' }).click();
  await expect(rows).toHaveCount(1);

  // Réglage : désactivée, les analyses ne sont plus enregistrées.
  await page.locator('#btn-settings').click();
  await expect(page.locator('#library-status-text')).toContainText('2 factures enregistrées');
  await page.locator('#set-library').selectOption('off');
  await page.locator('#settings-close').click();
  expect(await page.evaluate(() => settings.library)).toBe('off');

  // Base illisible : signalée au démarrage, réinitialisable, sans bloquer la lecture.
  await page.addInitScript(() => { window.__libraryBroken = true; });
  await page.reload();
  await expect(page.locator('#workspace-message')).toContainText('est illisible');
  await expect(page.locator('#workspace-message')).toContainText('Les factures restent lisibles');
  await page.locator('#btn-settings').click();
  await expect(page.locator('#library-status-text')).toHaveClass(/data-status-error/);
  await expect(page.locator('#library-clear')).toBeHidden();
  await page.locator('#library-reset').click();
  await expect(page.locator('#workspace-message')).toContainText('Bibliothèque réinitialisée');
  await expect(page.locator('#library-reset')).toBeHidden();
  expect(errors).toEqual([]);
});

test('Schematron officiel : verdicts respecté, non respecté, partiel et non évalué', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await mockBackend(page, null, {
    synthese: { numero: 'X', vendeur: 'V', devise: 'EUR' },
    sections: [{ name: 'Vendeur', rows: [{ title: 'Raison sociale', value: 'V', path: 'Invoice/x' }] }],
  });
  await page.goto(url);
  // Le moteur de validation est dans l'application : plus de moteur XSLT ni d'eval dans la page.
  expect(await page.evaluate(() => typeof SaxonJS)).toBe('undefined');
  const open = async (name, result) => {
    await page.evaluate(r => sessionStorage.setItem('mock-schematron', JSON.stringify(r)), result);
    await page.locator('#file-input').setInputFiles({ name, mimeType: 'text/xml', buffer: Buffer.from('<Invoice/>') });
    await expect(page.locator('#fv-name')).toHaveText(name);
    await page.getByRole('button', { name: 'Données', exact: true }).click();
  };
  const base = { evalue: true, version_regles: '1.3.16', regles_declenchees: 42, non_conformes: 0, avertissements: 0, non_evaluables: [], erreurs: [], duree_ms: 120 };
  const verdicts = page.locator('#verdicts');
  const section = page.locator('#schematron-rules');

  await open('respecte.xml', { ...base, ok: true });
  await expect(verdicts).toContainText('Schematron officiel respecté');
  await expect(section).toContainText('Aucune règle bloquante enfreinte');
  await expect(section).toContainText('EN 16931 v1.3.16');
  await expect(section).toContainText('42 contextes examinés en 120 ms');
  // Le moteur reçoit le XML du document et son format.
  expect(await page.evaluate(() => window.__schematronCalls[0])).toMatchObject({ format: 'CII', library: true, xml: '<Invoice>FAC-2026-123</Invoice>' });

  // Résultat gardé d'une session précédente : signalé comme tel, sans durée de calcul.
  await open('repris.xml', { ...base, ok: true, depuis_cache: true });
  await expect(section).toContainText('42 contextes examinés, résultat repris de la bibliothèque.');
  await expect(section).not.toContainText('120 ms');

  // Profil Factur-X autre qu'EN 16931 : le jeu de règles appliqué est nommé.
  await open('extended.xml', { ...base, ok: true, jeu_regles: 'Factur-X, profil EXTENDED', version_regles: '1.09.2' });
  await expect(section).toContainText('Règles Schematron officielles Factur-X, profil EXTENDED, v1.09.2 (FNFE-MPE et FeRD, Apache 2.0)');
  await expect(section).not.toContainText('Commission européenne');

  await open('ctc-fr.xml', { ...base, ok: true, jeu_regles: 'EXTENDED-CTC-FR (FNFE-MPE, réforme française)', version_regles: '1.4.0.04',
    br_fr: { version: '1.4.0.04', ok: true, non_conformes: 0, avertissements: 0, non_evaluables: [], erreurs: [] } });
  await expect(section).toContainText('Règles Schematron officielles du profil français EXTENDED-CTC-FR, v1.4.0.04 (FNFE-MPE, dépôt France_RFE)');
  await expect(section).toContainText('Toutes les règles de la réforme française sont respectées');
  await expect(verdicts).toContainText('Règles françaises BR-FR respectées');
  // Règle française enfreinte : verdict à part, celui du Schematron reste « respecté ».
  await open('br-fr.xml', { ...base, ok: true, br_fr: { version: '1.4.0.04', ok: false, non_conformes: 1, avertissements: 0, non_evaluables: [], erreurs: [
    { id: 'BR-FR-05_BT-22_PMT', flag: 'fatal', texte: 'BR-FR-05/BT-22 : La mention relative aux frais de recouvrement (code PMT) est absente.', location: '/rsm:CrossIndustryInvoice/rsm:ExchangedDocument' },
  ] } });
  await expect(verdicts).toContainText('Schematron officiel respecté');
  await expect(verdicts).toContainText('1 règle française BR-FR non respectée');
  await expect(section).toHaveAttribute('open', '');
  await expect(section).toContainText('Aucune règle bloquante enfreinte');
  await expect(section.locator('#br-fr-rules')).toContainText('1 règle de la réforme française non respectée');
  await expect(section.locator('tr.ctl-ecart')).toContainText('BR-FR-05_BT-22_PMT');
  await expect(section).toContainText('ne changent pas celui du Schematron');
  // Facture hors réforme : aucune mention des règles françaises.
  await open('hors-reforme.xml', { ...base, ok: true });
  await expect(section).not.toContainText('BR-FR');
  await expect(verdicts).not.toContainText('BR-FR');

  await open('enfreint.xml', { ...base, ok: false, non_conformes: 1, avertissements: 1, erreurs: [
    { id: 'BR-CO-15', flag: 'fatal', texte: '[BR-CO-15]-Invoice total amount with VAT = Invoice total amount without VAT + Invoice total VAT amount.', location: '/rsm:CrossIndustryInvoice' },
    { id: 'CII-SR-173', flag: 'warning', texte: '[CII-SR-173]-Avertissement de syntaxe', location: '/rsm:CrossIndustryInvoice/x' },
  ] });
  await expect(verdicts).toContainText('1 règle Schematron officiel non respectée');
  await expect(section).toHaveAttribute('open', '');
  await expect(section).toContainText('1 règle bloquante non respectée · 1 avertissement');
  await expect(section.locator('tr.ctl-ecart')).toContainText('BR-CO-15');
  await expect(section.locator('tr.ctl-ecart')).toContainText('Emplacement : /rsm:CrossIndustryInvoice');
  await expect(section.locator('tr.ctl-alerte')).toContainText('CII-SR-173');

  // Une règle que le moteur n'a pas pu évaluer empêche d'afficher « respecté ».
  await open('partiel.xml', { ...base, ok: false, non_evaluables: ['BR-DEC-23'] });
  await expect(verdicts).toContainText('Schematron officiel : 1 règle non évaluable');
  await expect(verdicts).not.toContainText('Schematron officiel respecté');
  await expect(section).toContainText('BR-DEC-23');

  // Document non reconnu, puis réponse inattendue du moteur : jamais « respecté ».
  await open('inconnu.xml', { evalue: false, ok: false, erreur_moteur: 'Aucune règle officielle ne s\'applique à ce document (racine ou espace de noms non reconnu)' });
  await expect(verdicts).toContainText('Schematron officiel non évalué');
  await expect(section).toContainText('Aucune règle officielle ne s\'applique');
  await open('muet.xml', {});
  await expect(verdicts).toContainText('Schematron officiel non évalué');
  await expect(verdicts).not.toContainText('Schematron officiel respecté');

  // Le tableau reprend les verdicts.
  await page.locator('#tab-batch').click();
  await expect(page.locator('#batch-table tbody tr.batch-row')).toHaveCount(10);
  expect(errors).toEqual([]);
});

test('schéma XSD : erreurs listées avec leur ligne, verdict dédié', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await mockBackend(page, null, {
    synthese: { numero: 'X', vendeur: 'V', devise: 'EUR' },
    sections: [{ name: 'Vendeur', rows: [{ title: 'Raison sociale', value: 'V', path: 'Invoice/x' }] }],
    xsd: { evalue: true, ok: false, schema: 'Factur-X 1.09.2, profil BASIC', total: 2, erreurs: [
      { message: "Unexpected element 'Inconnu' in sequence", ligne: 23, colonne: 41 },
      { message: "Attribute 'bidule' is not allowed", ligne: 25, colonne: null },
    ] },
  });
  await page.goto(url);
  await page.locator('#file-input').setInputFiles({ name: 'structure.xml', mimeType: 'text/xml', buffer: Buffer.from('<Invoice/>') });
  await expect(page.locator('#fv-name')).toHaveText('structure.xml');
  await page.getByRole('button', { name: 'Données', exact: true }).click();
  await expect(page.locator('#verdicts')).toContainText('2 erreurs de schéma XSD');
  const section = page.locator('#xsd-errors');
  await expect(section).toHaveAttribute('open', '');
  await expect(section).toContainText('2 erreurs de structure');
  await expect(section.locator('li').first()).toHaveText("Ligne 23, colonne 41 : Unexpected element 'Inconnu' in sequence");
  await expect(section.locator('li').nth(1)).toHaveText("Ligne 25 : Attribute 'bidule' is not allowed");
  await expect(section).toContainText('Schéma Factur-X 1.09.2, profil BASIC');
  await expect(section).toContainText("Les lignes sont celles de l'onglet « XML brut »");
  expect(errors).toEqual([]);
});


test('contrôles partagés : tableau, filtres, rapport complet et synthèse navigable', async ({ page }) => {
  const sch = { evalue: true, non_conformes: 1, non_evaluables: ['BR-X'], erreurs: [{ id: 'BR-1', flag: 'fatal', texte: 'Erreur métier' }],
    br_fr: { ok: false, non_conformes: 1, non_evaluables: [], erreurs: [{ id: 'BR-FR-1', texte: 'Mention absente', flag: 'fatal' }] } };
  await mockBackend(page, null, {
    synthese: { numero: 'TEST', vendeur: 'V', devise: 'EUR' },
    controles: [{ famille: 'calcul', etat: 'conforme', regle: 'Total', attendu: '120', constate: '120' }],
    regles: { evaluees: 1, non_conformes: 0, liste: [] },
    xsd: { evalue: true, ok: false, total: 1, erreurs: [{ ligne: 2, message: 'Élément inattendu' }] }, schematron: sch,
  });
  await page.goto(url);
  await page.locator('#file-input').setInputFiles({ name: 'controle.xml', mimeType: 'text/xml', buffer: Buffer.from('<Invoice/>') });
  await page.getByRole('button', { name: 'Données', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Synthèse des vérifications' })).toContainText('contrôle incomplet');
  await page.screenshot({ path: 'test-results/control-summary.png' });
  await page.locator('.action-summary').getByRole('button', { name: '1 erreur de schéma XSD' }).click();
  await expect(page.locator('#xsd-errors')).toBeFocused();
  await page.locator('#btn-control-report').click();
  const report = await page.evaluate(() => window.__report.report);
  expect(report.schematron).toEqual(sch);
  expect(report.regles_francaises).toEqual(sch.br_fr);
  expect(report.etats_controles.schematron.partiel).toBe(true);
  expect(report.etats_controles.xsd.etat).toBe('ecart');
  await page.locator('#tab-batch').click();
  for (const filter of ['xsd', 'schematron', 'france', 'incomplet']) {
    await page.locator('#batch-filter').selectOption(filter);
    await expect(page.locator('#batch-table tbody tr.batch-row')).toHaveCount(1);
  }
  await page.locator('#batch-export').click();
  expect(await page.evaluate(() => window.__saved.content)).toContain('1 non-conformité;1 erreur;1 règle BR-FR');
  const absent = await page.evaluate(() => invoiceVerdicts({ status: 'ok', result: { synthese: {} } }));
  expect(absent.schematron.etat).toBe('non_verifiable');
  expect(absent.xsd.etat).toBe('non_verifiable');
  const pending = await page.evaluate(() => invoiceVerdicts({ status: 'ok', result: { synthese: {}, _schematronRunning: true } }));
  expect(pending.schematron.etat).toBe('info');
});

test('bibliothèque : navigation des pages et filtres transmis au moteur', async ({ page }) => {
  await mockBackend(page);
  await page.goto(url);
  await page.evaluate(() => {
    window.__filterCalls = [];
    api.librarySearch = async (query, filters) => {
      window.__filterCalls.push({ query, ...filters });
      const filtered = !!filters.dateMax;
      const all = ['A', 'B', 'C'].map(hash => ({ hash, fichier: hash + '.xml', numero: hash }));
      const rows = filtered ? all.slice(2) : all;
      return { total: 3, correspondances: rows.length, offset: filters.offset, limite: 2, factures: rows.slice(filters.offset, filters.offset + 2) };
    };
  });
  await page.locator('#tab-library').click();
  await expect(page.locator('#library-table tbody tr')).toHaveCount(2);
  await page.locator('#library-pagination').getByRole('button', { name: 'Suivant' }).click();
  await expect(page.locator('#library-table tbody')).toContainText('C.xml');
  await expect(page.locator('#library-pagination')).toContainText('3–3 sur 3');
  await page.locator('#library-date-to').fill('2020-12-31');
  await page.locator('#library-date-to').dispatchEvent('change');
  await expect(page.locator('#library-pagination')).toBeHidden();
  await expect(page.locator('#library-count')).toHaveText('1 résultat / 3 factures');
  expect(await page.evaluate(() => window.__filterCalls.at(-1))).toMatchObject({ dateMax: '2020-12-31', offset: 0 });
});

test('archive ambiguë : choix explicite, XML seul, annulation et reprise', async ({ page }) => {
  await mockBackend(page);
  await page.addInitScript(() => {
    const original = window.__TAURI__.core.invoke;
    window.__TAURI__.core.invoke = async (command, args, options) => {
      if (command === 'parse_file') {
        const selection = options?.headers?.['x-archive-selection'];
        if (!selection) return { archive_choices: { xml: [{ index: 0, name: 'a.xml' }, { index: 1, name: 'b.xml' }], pdf: [{ index: 2, name: 'a.pdf' }] } };
        window.__selection = JSON.parse(selection);
        return { ...await original(command, args, options), archive_selection: window.__selection };
      }
      return original(command, args, options);
    };
  });
  await page.goto(url);
  await page.locator('#file-input').setInputFiles({ name: 'lot.zip', mimeType: 'application/zip', buffer: Buffer.from('archive') });
  const dialog = page.getByRole('dialog', { name: 'Choisir une facture dans l’archive' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('XML', { exact: true }).selectOption('1');
  await dialog.getByRole('button', { name: 'Ouvrir la sélection' }).click();
  await expect(page.locator('#fv-name')).toHaveText('lot.zip');
  expect(await page.evaluate(() => window.__selection)).toEqual({ xml: 1, pdf: null });
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('fx-workspace')).files[0].source.selection)).toEqual({ xml: 1, pdf: null });
  await page.reload();
  await expect(page.locator('#fv-name')).toHaveText('lot.zip');
  await expect(dialog).toHaveCount(0);
  await page.locator('#file-input').setInputFiles({ name: 'annule.zip', mimeType: 'application/zip', buffer: Buffer.from('archive2') });
  await dialog.getByRole('button', { name: 'Annuler', exact: true }).click();
  await expect.poll(() => page.evaluate(() => state.files.find(f => f.name === 'annule.zip')?.error)).toContain('annulée');
});

test('retrouver un fichier : annulation et erreur préservent la bibliothèque, succès ouvre la facture', async ({ page }) => {
  await mockBackend(page);
  await page.goto(url);
  await page.locator('#tab-library').click();
  const locate = page.getByRole('button', { name: 'Retrouver le fichier deposee.pdf', exact: true });
  await page.evaluate(() => { api.libraryRelink = async () => null; });
  await locate.click();
  await expect(page.locator('#library-table tbody tr')).toHaveCount(2);
  await page.evaluate(() => { api.libraryRelink = async () => { throw new Error('Empreinte XML différente'); }; });
  await locate.click();
  await expect(page.locator('#workspace-message')).toContainText('Empreinte XML différente');
  await expect(locate).toBeEnabled();
  await page.evaluate(() => { api.libraryRelink = async () => ({ filename: 'retrouve.xml', replacement_path: 'C:/retrouve.xml', doc_hash: 'h-drop', format: 'XML', rows: [], sections: [] }); });
  await locate.click();
  await expect(page.locator('#fv-name')).toHaveText('retrouve.xml');
  await expect(page.locator('#workspace-message')).toContainText('empreinte XML vérifiée');
});
