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
      if (command === 'save_binary') { window.__binary = args; return true; }
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
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('fx-workspace'))?.files[0]?.view?.scroll?.pdf)).toBe(650);
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

test('exports Excel typés et rapport PDF paginé avec accents et commentaires', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await mockBackend(page, null, {
    synthese: { numero: '0000123', vendeur: 'Société Éléonore', acheteur: 'Client', date: '2026-10-04', devise: 'EUR', ht: '100.00', tva: '20.00', ttc: '120.00', a_payer: '120.00' },
    lines_columns: [{ key: 'name', title: 'Désignation', align: 'left' }, { key: 'amount', title: 'Montant', align: 'right' }],
    lines: [{ fields: [], cells: { name: { value: '=HYPERLINK("malicious")' }, amount: { value: '12.50 EUR' } } }, { fields: [], cells: { name: { value: 'Référence 0000123' }, amount: { value: '1234567890123456.78 EUR' } } }],
    controles: Array.from({ length: 65 }, (_, i) => ({ regle: 'Contrôle numéro ' + i, etat: 'ecart', attendu: '120.00', constate: '119.99', detail: 'Écart à vérifier auprès du fournisseur.' })),
  });
  await page.goto(url);
  await page.locator('#file-input').setInputFiles({ name: 'échéance.xml', mimeType: 'text/xml', buffer: Buffer.from('<Invoice/>') });
  await page.getByRole('button', { name: 'Données', exact: true }).click();
  await expect(page.locator('#anomaly-center .anomaly-card')).toHaveCount(50);
  await page.locator('#anomaly-center').getByRole('button', { name: 'Afficher davantage' }).click();
  await expect(page.locator('#anomaly-center .anomaly-card')).toHaveCount(65);
  await page.locator('#btn-lines-excel').click();
  await expect.poll(() => page.evaluate(() => window.__binary?.filename)).toBe('échéance-lignes.xlsx');
  const ExcelJS = require('exceljs');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(await page.evaluate(() => window.__binary.base64), 'base64'));
  const lines = workbook.getWorksheet('Lignes');
  expect(lines.getCell('B2').value).toBe('=HYPERLINK("malicious")');
  expect(lines.getCell('C2').value).toBe(12.5);
  expect(lines.getCell('C3').value).toBe('1234567890123456,78');
  expect(lines.getCell('D2').value).toBe('EUR');
  expect(lines.views[0].ySplit).toBe(1);
  await page.evaluate(() => { const f = getFile(state.selected); reviewCache.set(reviewKey(f), { status: 'Anomalie', comment: 'Échéance à corriger — été', lines: { 0: 'Quantité à confirmer' } }); });
  await page.locator('#btn-control-pdf').click();
  await expect.poll(() => page.evaluate(() => window.__binary?.filename)).toBe('échéance-controles.pdf');
  const pdf = Buffer.from(await page.evaluate(() => window.__binary.base64), 'base64');
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  const pdfPath = testInfo.outputPath('rapport-controles.pdf');
  fs.writeFileSync(pdfPath, pdf);
  const extracted = await page.evaluate(async () => {
    const bytes = Uint8Array.from(atob(window.__binary.base64), c => c.charCodeAt(0));
    const doc = await pdfjsLib.getDocument({ data: bytes }).promise;
    const texts = [];
    for (let i = 1; i <= doc.numPages; i++) texts.push((await (await doc.getPage(i)).getTextContent()).items.map(item => item.str).join(' '));
    return { pages: doc.numPages, texts };
  });
  expect(extracted.pages).toBeGreaterThan(2);
  const text = extracted.texts.join(' ');
  expect(text).toContain('Société Éléonore');
  expect(text).toContain('Échéance à corriger');
  expect(text).toContain('Quantité à confirmer');
  expect(text).toContain('Contrôle numéro 64');
  expect(text).toContain('Aide à la correction');
  expect(text).toContain('Action conseillée');
  expect(text).toContain('Non évalué');
  extracted.texts.forEach((text, i) => expect(text).toContain(`${i + 1} / ${extracted.pages}`));
  await page.evaluate(() => showBatch());
  await page.locator('#batch-excel').click();
  await expect.poll(() => page.evaluate(() => window.__binary?.filename)).toBe('factures.xlsx');
  const batchBook = new ExcelJS.Workbook();
  await batchBook.xlsx.load(Buffer.from(await page.evaluate(() => window.__binary.base64), 'base64'));
  expect(batchBook.getWorksheet('Factures').getCell('C2').value).toBe('0000123');
  expect(batchBook.getWorksheet('Factures').getCell('I2').value).toBe(120);
  expect(batchBook.getWorksheet('Totaux par devise').getCell('F2').value).toBe(120);
  await page.locator('#batch-search').fill('introuvable');
  await page.locator('#batch-excel').click();
  await expect.poll(() => page.locator('#batch-excel').isDisabled()).toBe(false);
  await batchBook.xlsx.load(Buffer.from(await page.evaluate(() => window.__binary.base64), 'base64'));
  expect(batchBook.getWorksheet('Factures').rowCount).toBe(1);
  // Une annulation n’affiche pas de succès ; une erreur rend le bouton à nouveau utilisable.
  await page.evaluate(() => { api.saveBinary = async () => false; document.querySelector('#batch-excel').textContent = 'Exporter Excel'; });
  await page.locator('#batch-excel').click();
  await expect(page.locator('#batch-excel')).toBeEnabled();
  await expect(page.locator('#batch-excel')).toHaveText('Exporter Excel');
  await page.evaluate(() => { api.saveBinary = async () => { throw new Error('Disque plein'); }; });
  await page.locator('#batch-excel').click();
  await expect(page.locator('#batch-excel')).toBeEnabled();
  await expect(page.getByText('Export impossible : Disque plein')).toBeVisible();
  expect(errors).toEqual([]);
});

test('centre d’anomalies : valeurs, sources, filtres, demande copiée et occurrence XML exacte', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await mockBackend(page, null, {
    format: 'UBL', synthese: { numero: 'F-ANOM', vendeur: 'Fournisseur', devise: 'EUR' },
    xml_pretty: '<Invoice xmlns:cbc="urn:cbc" xmlns:cac="urn:cac"><cbc:ID>F-ANOM</cbc:ID><cac:InvoiceLine><cbc:LineExtensionAmount>50.00</cbc:LineExtensionAmount></cac:InvoiceLine><cac:InvoiceLine><cbc:LineExtensionAmount>50.01</cbc:LineExtensionAmount></cac:InvoiceLine></Invoice>',
    rows: [{ path: 'Invoice', title: 'Facture', tag: 'Invoice', value: '' },
      { path: 'Invoice/ID', title: 'Numéro', tag: 'ID', value: 'F-ANOM' },
      { path: 'Invoice/InvoiceLine[1]/LineExtensionAmount', title: 'Montant de ligne', tag: 'LineExtensionAmount', value: '50.00' },
      { path: 'Invoice/InvoiceLine[2]/LineExtensionAmount', title: 'Montant de ligne', tag: 'LineExtensionAmount', value: '50.01' }],
    controles: [
      { famille: 'calcul', etat: 'ecart', regle: 'Total TTC à recalculer', constate: '120.01', attendu: '120.00', ecart: '0.01', path: 'Invoice/ID', detail: 'Vérifier la TVA' },
      { famille: 'historique', etat: 'alerte', regle: 'IBAN nouveau pour ce fournisseur', detail: 'FR76...' },
    ],
    regles: { evaluees: 1, non_conformes: 1, liste: [{ id: 'BR-07', libelle: 'Nom de l’acheteur', etat: 'non_conforme', detail: 'Absent du XML.', constate: 'Absent du XML', attendu: 'Valeur renseignée', path: '' }] },
    xsd: { evalue: true, ok: false, total: 2, schema: 'UBL 2.1', lignes_origine: true, erreurs: [{ message: 'Invalid decimal', ligne: 4, colonne: 8 }] },
    warnings: ['<img src=x onerror="window.__xss=true">'],
  });
  await page.addInitScript(() => sessionStorage.setItem('mock-schematron', JSON.stringify({
    evalue: true, non_conformes: 1, erreurs: [{ id: 'BR-CO-10', flag: 'fatal', texte: 'Line amounts must be consistent', location: '/Invoice/cac:InvoiceLine[2]/cbc:LineExtensionAmount[1]' }],
    br_fr: { evalue: true, non_conformes: 1, erreurs: [{ id: 'BR-FR-01', flag: 'fatal', texte: 'Mention française requise', location: '/Invoice/cbc:ID' }] },
  })));
  await page.goto(url);
  await page.evaluate(() => { clipboardWrite = async text => { window.__clip = text; }; });
  await page.locator('#file-input').setInputFiles({ name: 'anomalies.xml', mimeType: 'text/xml', buffer: Buffer.from('<Invoice/>') });
  await page.getByRole('button', { name: 'Données', exact: true }).click();
  const center = page.locator('#anomaly-center');
  await expect(center.locator('.anomaly-card')).toHaveCount(7);
  const total = center.locator('.anomaly-card').filter({ hasText: 'Total TTC à recalculer' });
  await expect(total).toContainText('120.01'); await expect(total).toContainText('120.00');
  await expect(total).toContainText('Recalculer les montants');
  await expect(center.locator('.anomaly-card[data-rule="BR-07"]')).toContainText('Valeur renseignée');
  await expect(center.locator('.anomaly-card[data-rule="BR-FR-01"]')).toContainText('périmètre');
  await expect(center.locator('.anomaly-card[data-source="xsd"]')).toContainText('Ligne 4, colonne 8 du XML d’origine');
  await expect(center).toContainText('seules les 1 premières');
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  await expect(center.locator('img')).toHaveCount(0);
  await page.locator('#anomaly-source').selectOption('coherence');
  await page.locator('#anomaly-severity').selectOption('ecart');
  await expect(center.locator('.anomaly-card')).toHaveCount(1);
  await page.locator('#anomaly-copy-all').click();
  const request = await page.evaluate(() => window.__clip);
  expect(request).toContain('F-ANOM'); expect(request).toContain('120.01'); expect(request).toContain('120.00');
  expect(request).not.toContain('IBAN'); expect(request).not.toContain('BR-FR');
  await page.locator('#anomaly-search').fill('introuvable');
  await expect(page.locator('#anomaly-copy-all')).toBeDisabled();
  await expect(center).toContainText('Aucune anomalie ne correspond');
  await page.locator('#anomaly-search').fill('');
  await page.locator('#anomaly-source').selectOption('schematron');
  await page.locator('#anomaly-severity').selectOption('all');
  await expect(center.locator('.anomaly-card')).toHaveCount(1);
  await expect(center.locator('.anomaly-card')).toContainText('50.01');
  await center.getByRole('button', { name: 'Voir le champ dans le XML' }).click();
  await expect(page.locator('#tab-xml')).toHaveClass(/active/);
  await expect(page.locator('#xml-table tr.flash')).toHaveAttribute('data-path', 'Invoice/InvoiceLine[2]/LineExtensionAmount');
  await page.getByRole('button', { name: 'Données', exact: true }).click();
  await expect(page.locator('#anomaly-source')).toHaveValue('schematron');
  await page.locator('#anomaly-source').selectOption('coherence');
  await page.locator('#anomaly-search').fill('IBAN');
  await expect(center.locator('.anomaly-card')).toHaveCount(1);
  await expect(center.locator('.anomaly-card')).toContainText('contact connu');
  await center.getByRole('button', { name: 'Copier la demande de vérification' }).click();
  expect(await page.evaluate(() => window.__clip)).toContain('si nécessaire');
  await page.locator('#anomaly-search').fill(''); await page.locator('#anomaly-source').selectOption('all');
  await page.evaluate(() => { const panel = document.querySelector("#anomaly-center"), pane = document.querySelector("main"); pane.scrollTop += panel.getBoundingClientRect().top - pane.getBoundingClientRect().top - 55; });
  await page.screenshot({ path: testInfo.outputPath('centre-anomalies.png') });
  await page.locator('#btn-control-report').click();
  const report = await page.evaluate(() => window.__report.report);
  expect(report.aide_correction.issues).toHaveLength(7);
  expect(report.aide_correction.issues[0]).toMatchObject({ found: '120.01', expected: '120.00' });
  expect(errors).toEqual([]);
});

test('centre d’anomalies : évaluation incomplète, actualisation et conservation de la recherche', async ({ page }) => {
  await mockBackend(page, null, {
    synthese: { numero: 'PARTIEL', vendeur: 'V' },
    controles: [{ famille: 'calcul', etat: 'non_verifiable', regle: 'Total TTC', detail: 'Total HT absent' }],
    xsd: { evalue: false, raison: 'XML non reconnu' },
  });
  await page.goto(url);
  await page.locator('#file-input').setInputFiles({ name: 'partiel.xml', mimeType: 'text/xml', buffer: Buffer.from('<Invoice/>') });
  await page.getByRole('button', { name: 'Données', exact: true }).click();
  await page.getByRole('button', { name: 'Ouvrir le centre d’anomalies' }).click();
  const center = page.locator('#anomaly-center');
  await expect(center).toContainText('Vérification à compléter');
  await expect(center).toContainText('Total HT absent');
  await expect(center).not.toContainText('Aucune anomalie relevée par les contrôles exécutés.');
  await expect(page.locator('#anomaly-copy-all')).toBeDisabled();
  await page.locator('#anomaly-search').fill('BR-03');
  await page.evaluate(() => {
    const f = getFile(state.selected);
    f.result.schematron = { evalue: true, non_conformes: 1, erreurs: [{ id: 'BR-03', texte: 'Invoice date missing', location: '/Invoice' }] };
    refreshSchematronViews(f);
  });
  await expect(page.locator('#anomaly-search')).toHaveValue('BR-03');
  await expect(page.locator('#anomaly-search')).toBeFocused();
  await expect(center.locator('.anomaly-card')).toHaveCount(1);
  await expect(center.locator('.anomaly-card')).toContainText('Non fournie par ce contrôle');
  await expect(center.locator('.anomaly-card')).toContainText('Compléter la donnée');
  // Les chemins non supportés ou ambigus ne naviguent pas vers un champ arbitraire.
  expect(await page.evaluate(() => resolveAnomalyPath(getFile(state.selected), '//*'))).toBeNull();
  expect(await page.evaluate(() => resolveAnomalyPath(getFile(state.selected), '/missing:Invoice'))).toBeNull();
});

test('lot complet : progression, anomalies transversales et PDF consolidé indépendant des filtres', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await mockBackend(page);
  await page.goto(url);
  await page.evaluate(() => {
    const invoice = (number, currency, amount, credit = false, broken = false) => ({
      format: 'UBL', root: 'Invoice', doc_hash: 'hash-' + number,
      xml_pretty: '<Invoice><ID>' + number + '</ID></Invoice>',
      rows: [{ path: 'Invoice/ID', title: 'N°', tag: 'ID', value: number }],
      header: [], summary: [], sections: [], warnings: [], lines: [],
      synthese: { numero: number, vendeur: 'Fournisseur ' + number, date: '2026-10-04',
        devise: currency, avoir: credit, ht: credit ? '25.00' : currency === 'CHF' ? '5.00' : '100.00',
        tva: credit ? '5.00' : currency === 'CHF' ? '0.00' : '20.00', ttc: amount, a_payer: amount },
      controles: broken ? Array.from({ length: 60 }, (_, i) => ({ famille: 'calcul', etat: 'ecart', regle: 'Total à vérifier ' + i,
        attendu: '120.00', constate: '120.01', ecart: '0.01', path: 'Invoice/ID', detail: 'Écart de TVA.' }))
        : [{ famille: 'calcul', etat: 'conforme', regle: 'Total TTC', attendu: amount, constate: amount }],
      regles: { evaluees: 1, non_conformes: 0, liste: [] },
      xsd: { evalue: true, ok: true, total: 0, erreurs: [], schema: 'UBL 2.1' },
    });
    window.__firstInvoice = invoice('A-1', 'EUR', '120.00', false, true);
    window.__validators = [];
    SchematronValidator.validate = () => new Promise(resolve => window.__validators.push(resolve));
    window.__loadJob = addSources([
      { name: 'facture-A.xml', load: () => new Promise(resolve => { window.__resolveFirst = resolve; }) },
      { name: 'avoir-B.xml', load: () => Promise.resolve(invoice('B-1', 'EUR', '30.00', true)) },
      { name: 'facture-C.xml', load: () => Promise.resolve(invoice('C-1', 'CHF', '5.00')) },
      { name: 'illisible.xml', load: () => Promise.reject(new Error('XML endommagé')) },
    ]);
    showBatch();
  });
  await expect(page.locator('#batch-progress-label')).toHaveText('0 / 4 documents analysés');
  await expect(page.locator('#batch-report')).toBeDisabled();
  await expect(page.locator('#batch-table')).toContainText('Lecture en cours');
  await page.evaluate(() => window.__resolveFirst(window.__firstInvoice));
  await page.evaluate(() => window.__loadJob);
  await expect(page.locator('#batch-view')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__validators.length)).toBe(3);
  await expect(page.locator('#batch-progress-label')).toHaveText('1 / 4 documents analysés');
  await expect(page.locator('#batch-audit-summary')).toContainText('3 en validation Schematron');
  await expect(page.locator('#batch-report')).toBeDisabled();
  expect(await page.evaluate(() => { try { batchReportSnapshot(); return 'success'; } catch (e) { return e.message; } }))
    .toContain('Attendez la fin');
  await page.evaluate(() => window.__validators.shift()({ evalue: true, ok: true, non_conformes: 0, non_evaluables: [], erreurs: [] }));
  await expect(page.locator('#batch-progress-label')).toHaveText('2 / 4 documents analysés');
  await page.evaluate(() => window.__validators.splice(0).forEach(resolve => resolve({ evalue: true, ok: true, non_conformes: 0, non_evaluables: [], erreurs: [] })));
  await expect(page.locator('#batch-progress-label')).toHaveText('4 / 4 documents analysés');
  await expect(page.locator('#batch-report')).toBeEnabled();
  await expect(page.locator('#batch-audit-summary')).toContainText('2 documents à examiner');
  await page.locator('#batch-anomalies summary').click();
  await expect(page.locator('#batch-anomaly-count')).toContainText('61 / 61 points');
  await expect(page.locator('#batch-anomaly-list .batch-issue')).toHaveCount(50);
  await page.locator('#batch-anomaly-more').click();
  await expect(page.locator('#batch-anomaly-list .batch-issue')).toHaveCount(61);
  await page.locator('#batch-anomaly-kind').selectOption('error');
  await expect(page.locator('#batch-anomaly-list .batch-issue')).toHaveCount(1);
  await expect(page.locator('#batch-anomaly-list')).toContainText('XML endommagé');
  await page.locator('#batch-anomaly-kind').selectOption('all');
  await page.locator('#batch-search').fill('aucune correspondance');
  await expect(page.locator('#batch-table tbody')).toContainText('Aucun document');
  await expect(page.locator('#batch-anomaly-count')).toContainText('61 / 61 points');
  await page.screenshot({ path: testInfo.outputPath('bilan-lot.png') });
  await page.locator('#batch-report').click();
  await expect.poll(() => page.evaluate(() => window.__binary?.filename)).toBe('bilan-factures.pdf');
  const pdf = Buffer.from(await page.evaluate(() => window.__binary.base64), 'base64');
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  fs.writeFileSync(testInfo.outputPath('bilan-lot.pdf'), pdf);
  const extracted = await page.evaluate(async () => {
    const bytes = Uint8Array.from(atob(window.__binary.base64), c => c.charCodeAt(0));
    const doc = await pdfjsLib.getDocument({ data: bytes }).promise;
    const pages = [];
    for (let i = 1; i <= doc.numPages; i++) pages.push((await (await doc.getPage(i)).getTextContent()).items.map(item => item.str).join(' '));
    return pages;
  });
  expect(extracted.length).toBeGreaterThan(2);
  const text = extracted.join(' ');
  for (const value of ['Bilan de 4 documents', 'EUR : 2 documents', 'TTC 90.00', 'CHF : 1 document',
    'facture-A.xml', 'avoir-B.xml', 'facture-C.xml', 'illisible.xml', 'XML endommagé', 'Total à vérifier 59'])
    expect(text).toContain(value);
  extracted.forEach((content, i) => expect(content).toContain(`${i + 1} / ${extracted.length}`));
  await page.locator('#batch-anomaly-kind').selectOption('ecart');
  await page.locator('#batch-anomaly-search').fill('Total à vérifier 59');
  await expect(page.locator('#batch-anomaly-list .batch-issue')).toHaveCount(1);
  await page.locator('#batch-anomaly-list .batch-issue button').click();
  await expect(page.locator('#file-view')).toBeVisible();
  await expect(page.locator('#fv-name')).toHaveText('facture-A.xml');
  await expect(page.locator('#tab-xml')).toHaveClass(/active/);
  expect(errors).toEqual([]);
});

test('échéancier : dates, devises, avoir non affecté, export filtré et accès facture', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await mockBackend(page);
  await page.goto(url);
  await page.evaluate(async () => {
    const day = offset => { const d = new Date(); d.setDate(d.getDate() + offset);
      return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-'); };
    window.__scheduleDates = { past: day(-1), today: day(0), future: day(1) };
    const item = (number, currency, amount, due, credit = false, seller = 'Vendeur') => ({
      format: 'XML', root: 'Invoice', rows: [], header: [], summary: [], sections: [], warnings: [], lines: [], controles: [],
      synthese: { numero: number, vendeur: seller, devise: currency, echeance: due, date: day(-10),
        avoir: credit, a_payer: credit ? '' : amount, ttc: amount },
    });
    const docs = [
      ['retard.xml', item('R-1', 'EUR', '100.00', day(-1), false, '=2+2')],
      ['jour.xml', item('J-1', 'EUR', '50.00', day(0))],
      ['avenir.xml', item('A-1', 'EUR', '75.00', day(1))],
      ['avoir.xml', item('C-1', 'EUR', '30.00', '', true)],
      ['chf.xml', item('S-1', 'CHF', '20.00', day(1))],
      ['inconnu.xml', item('U-1', 'EUR', '', '2026-02-30')],
    ];
    await addSources([...docs.map(([name, result]) => ({ name, load: () => Promise.resolve(result) })),
      { name: 'illisible.xml', load: () => Promise.reject(new Error('XML invalide')) }]);
    showBatch();
  });
  await expect(page.locator('#schedule-summary')).toContainText('6 documents avec synthèse');
  await expect(page.locator('#schedule-summary')).toContainText('1 échéance dépassée');
  await expect(page.locator('#schedule-summary')).toContainText('2 sans échéance');
  await expect(page.locator('#schedule-summary')).toContainText('EUR · solde indicatif 195,00');
  await expect(page.locator('#schedule-summary')).toContainText('CHF · solde indicatif 20,00');
  await expect(page.locator('#schedule-summary')).toContainText('1 montant indisponible');
  await expect(page.locator('#batch-schedule')).toContainText('ne prouve pas');
  await page.locator('#schedule-details summary').click();
  await expect(page.locator('.schedule-group')).toHaveCount(5);
  await expect(page.locator('.schedule-group').last()).toContainText('Sans échéance');
  await expect(page.locator('.schedule-group').last()).toContainText('−30,00');
  await expect(page.locator('.schedule-group').last()).toContainText('Montant indisponible');
  await page.locator('#batch-search').fill('aucune correspondance');
  await expect(page.locator('.batch-empty')).toBeVisible();
  await expect(page.locator('.schedule-group')).toHaveCount(5);
  await page.locator('#schedule-status').selectOption('overdue');
  await page.locator('#schedule-currency').selectOption('EUR');
  await expect(page.locator('.schedule-group')).toHaveCount(1);
  await expect(page.locator('#schedule-count')).toContainText('1 / 6 documents');
  await page.locator('#schedule-export').click();
  await expect.poll(() => page.evaluate(() => window.__saved?.filename)).toBe('echeancier.csv');
  const filteredCsv = await page.evaluate(() => window.__saved.content);
  expect(filteredCsv).toContain('retard.xml');
  expect(filteredCsv).not.toContain('avenir.xml');
  expect(filteredCsv).toContain("'=2+2");
  expect(filteredCsv).toContain('Total échéance');
  await page.locator('#schedule-status').selectOption('all');
  await page.locator('#schedule-currency').selectOption('all');
  await page.locator('#schedule-export').click();
  await expect.poll(() => page.evaluate(() => window.__saved.content.includes('avoir.xml'))).toBe(true);
  const csv = await page.evaluate(() => window.__saved.content);
  expect(csv).toContain('avoir.xml');
  expect(csv).toContain('-30,00');
  expect(csv).toContain('inconnu.xml');
  await page.screenshot({ path: testInfo.outputPath('echeancier.png') });
  await page.locator('.schedule-item button').filter({ hasText: 'avoir.xml' }).click();
  await expect(page.locator('#fv-name')).toHaveText('avoir.xml');
  expect(await page.evaluate(() => scheduleDate('2026-02-30'))).toBe('');
  expect(errors).toEqual([]);
});
