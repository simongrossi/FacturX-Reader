// Windows/WebView2 : vrai exécutable et vraies commandes Rust, profil jetable.
const { chromium, expect } = require('@playwright/test');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { invoicePdf } = require('./fixtures.cjs');
async function main() {
  if (process.platform !== 'win32') throw new Error('Ce scénario natif utilise WebView2 sous Windows.');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'facturx-p0-'));
  const fixture = path.join(root, 'synthetic.pdf');
  fs.writeFileSync(fixture, invoicePdf());
  const dataDir = path.join(root, 'data');
  fs.mkdirSync(dataDir);
  const exe = path.resolve(process.env.FACTURX_TEST_EXE || 'src-tauri/target/debug/facturx-reader.exe');
  let child, browser;
  const errors = [];
  async function freePort() { return new Promise(resolve => {
    const server = net.createServer().listen(0, '127.0.0.1', () => {
      const port = server.address().port; server.close(() => resolve(port));
    });
  }); }
  async function launch() {
    const port = await freePort();
    child = spawn(exe, [], { windowsHide: true, env: { ...process.env,
      // Pointages et suivi dans le dossier jetable : jamais dans les données de l'utilisateur.
      FACTURX_DATA_DIR: dataDir,
      WEBVIEW2_USER_DATA_FOLDER: path.join(root, 'webview'),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
    }, stdio: 'ignore' });
    let launchError; child.on('error', error => { launchError = error; });
    for (let i = 0; i < 100; i++) {
      if (launchError) throw launchError;
      try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`); break; }
      catch { await new Promise(resolve => setTimeout(resolve, 200)); }
    }
    if (!browser) throw new Error('WebView2 non accessible après lancement.');
    let page;
    for (let i = 0; i < 100; i++) {
      page = browser.contexts().flatMap(context => context.pages()).find(page => page.url().includes('tauri.localhost'));
      if (page) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!page) throw new Error('Fenêtre Tauri introuvable.');
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => typeof workspaceReady !== 'undefined' && workspaceReady);
    return page;
  }
  async function stop(page) {
    // Fermer la fenêtre de notre processus, comme avec la croix de l'application.
    const exited = new Promise(resolve => child.once('exit', resolve));
    const closeHelper = path.resolve(__dirname, 'close-window.ps1');
    const close = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', closeHelper, String(child.pid)], { windowsHide: true, stdio: 'ignore' });
    await new Promise(resolve => close.once('exit', resolve));
    let forced = false;
    const timeout = setTimeout(() => { forced = true; child.kill(); }, 5000);
    await exited; clearTimeout(timeout);
    await browser.close(); browser = null;
    await new Promise(resolve => setTimeout(resolve, 500));
    if (forced) throw new Error('La fenêtre native ne s’est pas fermée normalement.');
  }
  try {
    let page = await launch();
    await expect(page.locator('.document-tab-group')).toHaveCount(0);
    await page.evaluate(async fixture => { await addPaths({ files: [fixture] }); }, fixture);
    await expect(page.locator('.pdf-page')).toHaveCount(2);
    await expect(page.locator('#fv-badges')).toContainText('2026-10-02');
    await page.getByRole('button', { name: 'Données', exact: true }).click();
    await expect(page.locator('#tab-data')).toContainText("Date d'émission");
    await page.getByRole('button', { name: 'PDF', exact: true }).click();
    await page.locator('#pdf-zoom').selectOption('1.5');
    await page.waitForFunction(() => !workspaceScrollTarget && state.zoom === 1.5 && getFile(state.selected)?.rendered.pdf);
    await page.evaluate(() => { document.querySelector('.main').scrollTop = 650; });
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('fx-workspace')).files[0].view.scroll.pdf)).toBe(650);
    await stop(page);
    page = await launch();
    await expect(page.locator('#fv-name')).toHaveText('synthetic.pdf');
    await expect(page.locator('.pdf-page')).toHaveCount(2);
    try { await expect.poll(() => page.evaluate(() => document.querySelector('.main').scrollTop)).toBe(650); }
    catch (error) {
      console.error('Reprise native :', await page.evaluate(() => ({ saved: workspaceRead('fx-workspace', {}), view: getFile(state.selected)?.view, pending: workspaceScrollTarget, tab: state.tab })));
      throw error;
    }
    await expect(page.locator('#pdf-zoom')).toHaveValue('1.5');
    await page.locator('#btn-search').click();
    await page.locator('#quick-query').fill('TEST-P0');
    await expect(page.locator('#xml-table .quick-hit')).toHaveCount(1);
    await page.locator('#quick-close').click();
    await page.locator('#tab-batch').click();
    await expect(page.locator('#batch-table tfoot tr')).toContainText('Total EUR — 1 document');
    await expect(page.locator('#batch-table tfoot tr')).toContainText('100,00');
    await expect(page.locator('#batch-table tfoot tr')).toContainText('120,00');
    await page.locator('#batch-table tbody tr.batch-row td').first().click();
    await page.getByRole('button', { name: 'PDF et données', exact: true }).click();
    await expect(page.locator('#reading-panes')).toHaveClass('dual-reading');
    await expect(page.locator('#controls tr').filter({ hasText: 'Total TTC = total HT + total TVA' })).toContainText('Conforme');
    await expect(page.locator('#verdicts .ctl-chip').first()).toHaveText('Lecture réussie');
    await expect(page.locator('#verdicts')).toContainText('Calculs cohérents');
    await expect(page.locator('#verdicts')).toContainText('EN 16931 non respectée');
    await expect(page.locator('#controls tr').filter({ hasText: 'Mentions essentielles' })).toContainText('Nom de l\'acheteur');
    await page.locator('#tab-data .review-panel summary span').click();
    await page.getByLabel('Commentaire de la facture', { exact: true }).fill('Test natif P2');
    await page.locator('#tab-data').getByLabel('Vérification de synthetic.pdf').selectOption('Vérifiée');
    await page.locator('#file-input').setInputFiles({ name: 'deposited.pdf', mimeType: 'application/pdf', buffer: invoicePdf() });
    await expect(page.locator('#fv-name')).toHaveText('deposited.pdf');
    await stop(page);
    fs.unlinkSync(fixture);
    page = await launch();
    await expect(page.locator('.document-tab-group')).toHaveCount(2);
    await expect(page.locator('#fv-name')).toHaveText('deposited.pdf');
    await expect(page.locator('.pdf-page')).toHaveCount(2);
    await expect(page.locator('#workspace-message')).toContainText('1 document');
    await page.getByRole('button', { name: 'PDF et données', exact: true }).click();
    await expect(page.getByLabel('Commentaire de la facture', { exact: true })).toHaveValue('Test natif P2');
    await expect(page.locator('#tab-data').getByLabel('Vérification de deposited.pdf')).toHaveValue('Vérifiée');
    // Bibliothèque : la facture analysée par le moteur y figure, une seule fois (même XML déposé deux fois).
    await page.locator('#tab-library').click();
    await expect(page.locator('#library-table tbody tr')).toHaveCount(1);
    await expect(page.locator('#library-table tbody tr')).toContainText('TEST-P0');
    await expect(page.locator('#library-table tbody tr')).toContainText('Test Seller');
    await expect(page.locator('#library-table tbody tr')).toContainText('120,00');
    await page.locator('#library-search').fill('introuvable');
    await expect(page.locator('#library-table tbody tr')).toHaveCount(0);
    await page.locator('#library-search').fill('test-p0');
    await expect(page.locator('#library-table tbody tr')).toHaveCount(1);
    await page.locator('#library-table tbody tr td').first().click();
    await expect(page.locator('#fv-name')).toHaveText('deposited.pdf');
    if (!fs.existsSync(path.join(dataDir, 'bibliotheque.sqlite'))) throw new Error('bibliotheque.sqlite absent du dossier de données.');
    // Le suivi est écrit dans suivi.json du dossier de données, pas dans la WebView.
    const suiviFile = path.join(dataDir, 'suivi.json');
    const suivi = Object.values(JSON.parse(fs.readFileSync(suiviFile, 'utf8')));
    if (suivi.length !== 1 || suivi[0].comment !== 'Test natif P2' || suivi[0].status !== 'Vérifiée')
      throw new Error('suivi.json inattendu : ' + JSON.stringify(suivi));
    if (errors.length) throw new Error(errors.join('\n'));
    await stop(page);

    // Fichiers illisibles : signalés au démarrage, jamais écrasés, puis restaurés.
    const pointagesFile = path.join(dataDir, 'pointages.json');
    const broken = '{ "abc": { "lines": [1, ';
    fs.writeFileSync(pointagesFile, broken);
    fs.writeFileSync(path.join(dataDir, 'pointages.sauvegarde-2026-10-01.json'), JSON.stringify({ abc: { filename: 'a.pdf', updated: '2026-10-01 09:00:00', lines: [1, 2] } }));
    fs.copyFileSync(suiviFile, path.join(dataDir, 'suivi.sauvegarde-2026-10-01.json'));
    fs.writeFileSync(suiviFile, 'pas du json');
    page = await launch();
    await expect(page.locator('#workspace-message')).toContainText('pointages.json est illisible');
    await expect(page.locator('#workspace-message')).toContainText('suivi.json est illisible');
    await page.getByRole('button', { name: 'PDF et données', exact: true }).click();
    await page.locator('#tab-data').getByLabel('Vérification de deposited.pdf').selectOption('Anomalie');
    await expect(page.locator('#workspace-message')).toContainText('Rien ne sera écrasé');
    await expect(page.locator('#workspace-message')).toContainText('suivi.json est illisible');
    if (fs.readFileSync(pointagesFile, 'utf8') !== broken || fs.readFileSync(suiviFile, 'utf8') !== 'pas du json')
      throw new Error('Un fichier illisible a été modifié.');
    await page.locator('#btn-settings').click();
    await expect(page.locator('#data-status-text .data-status-error')).toHaveCount(2);
    await page.locator('#data-restore').click();
    await expect(page.locator('#workspace-message')).toContainText('Sauvegarde restaurée');
    await expect(page.locator('#data-status-text')).toContainText('Pointages : 1 facture');
    await expect(page.locator('#data-status-text .data-status-error')).toHaveCount(0);
    await page.locator('#settings-close').click();
    await expect(page.locator('#tab-data').getByLabel('Vérification de deposited.pdf')).toHaveValue('Vérifiée');
    if (JSON.parse(fs.readFileSync(pointagesFile, 'utf8')).abc.lines.length !== 2) throw new Error('Pointages non restaurés.');
    if (!fs.readdirSync(dataDir).some(name => name.startsWith('pointages.illisible-'))) throw new Error('Fichier illisible non conservé.');
    if (errors.length) throw new Error(errors.join('\n'));
    await stop(page);
    console.log('Native Windows OK : Rust, PDF 2 pages, reprise, recherche, tableau, contrôles du moteur, double lecture, suivi dans suivi.json, fichiers illisibles signalés puis restaurés.');
  } finally {
    if (child && child.exitCode === null) child.kill();
    if (browser) await browser.close().catch(() => {});
    // Le profil jetable peut rester verrouillé brièvement par WebView2.
    if (path.dirname(path.resolve(root)) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith('facturx-p0-')) {
      throw new Error('Chemin du profil temporaire inattendu : nettoyage refusé.');
    }
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
