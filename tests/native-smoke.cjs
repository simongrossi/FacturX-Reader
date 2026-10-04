// Windows/WebView2 : vrai exécutable et vraies commandes Rust, profil jetable.
const { chromium, expect } = require('@playwright/test');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { invoicePdf } = require('./fixtures.cjs');
const { deflateSync } = require('node:zlib');
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
    // Port imposé par l'intégration continue, où il est inscrit dans l'application à la compilation
    // (voir checks.yml) : WebView2 y ignore la variable d'environnement ci-dessous.
    const port = Number(process.env.FACTURX_DEBUG_PORT) || await freePort();
    child = spawn(exe, [], { windowsHide: true, env: { ...process.env,
      // Pointages et suivi dans le dossier jetable : jamais dans les données de l'utilisateur.
      FACTURX_DATA_DIR: dataDir,
      WEBVIEW2_USER_DATA_FOLDER: path.join(root, 'webview'),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
    }, stdio: ['ignore', 'ignore', 'pipe'] });
    let launchError, exited = null, stderr = '', lastError = '';
    child.on('error', error => { launchError = error; });
    child.on('exit', (code, signal) => { exited = { code, signal }; });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4000); });
    // Premier lancement de WebView2 sur une machine d'intégration : nettement plus lent qu'en local.
    const attempts = Number(process.env.FACTURX_LAUNCH_SECONDS || 20) * 5;
    for (let i = 0; i < attempts; i++) {
      if (launchError) throw launchError;
      if (exited) throw new Error(`L'application s'est arrêtée au lancement (code ${exited.code}, signal ${exited.signal}). ${stderr}`);
      try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`); break; }
      catch (error) { lastError = String(error.message || error).split('\n')[0]; await new Promise(resolve => setTimeout(resolve, 200)); }
    }
    if (!browser) {
      // Le moteur de rendu a-t-il seulement démarré ? Utile sur une machine d'intégration.
      let webviews = '?';
      try { webviews = require('node:child_process').execSync('tasklist /FI "IMAGENAME eq msedgewebview2.exe" /NH').toString().split('\n').filter(l => l.includes('msedgewebview2')).length; } catch {}
      // Diagnostic : port réellement ouvert, arguments reçus par le moteur de rendu, ports en écoute.
      const run = cmd => { try { return require('node:child_process').execSync(cmd, { encoding: 'utf8', timeout: 30000 }).trim(); } catch (e) { return 'échec : ' + String(e.message).split('\n')[0]; } };
      const find = (dir, name, depth = 0) => { try { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.name === name) return p; if (e.isDirectory() && depth < 3) { const f = find(p, name, depth + 1); if (f) return f; } } } catch {} return null; };
      const active = find(path.join(root, 'webview'), 'DevToolsActivePort');
      console.error('DIAG port demandé :', port);
      console.error('DIAG DevToolsActivePort :', active ? active + ' => ' + fs.readFileSync(active, 'utf8').replace(/\s+/g, ' ') : 'absent');
      console.error('DIAG dossier webview :', run(`cmd /c dir /b "${path.join(root, 'webview')}"`));
      console.error('DIAG lignes de commande :\n' + run('powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"name=\'msedgewebview2.exe\'\\" | ForEach-Object { $_.ProcessId.ToString() + \' \' + $_.CommandLine.Substring(0, [Math]::Min(700, $_.CommandLine.Length)) }"'));
      console.error('DIAG écoute :\n' + run('powershell -NoProfile -Command "Get-NetTCPConnection -State Listen | Where-Object { (Get-Process -Id $_.OwningProcess).ProcessName -match \'webview|facturx\' } | ForEach-Object { $_.LocalAddress + \':\' + $_.LocalPort + \' pid \' + $_.OwningProcess }"'));
      console.error('DIAG env WEBVIEW2 :', Object.keys(process.env).filter(k => /WEBVIEW2/i.test(k)).map(k => k + '=' + process.env[k]).join(' ; ') || 'aucune dans le parent');
      throw new Error(`WebView2 non accessible ${attempts / 5} s après le lancement ; l'application tourne toujours, ${webviews} processus msedgewebview2. Dernière erreur : ${lastError}. ${stderr}`);
    }
    let page;
    // Le port CDP peut répondre avant que WebView2 ait créé la page Tauri.
    for (let i = 0; i < Number(process.env.FACTURX_LAUNCH_SECONDS || 20) * 10; i++) {
      if (exited) throw new Error(`L'application s'est arrêtée avant l'ouverture de la fenêtre (code ${exited.code}, signal ${exited.signal}). ${stderr}`);
      page = browser.contexts().flatMap(context => context.pages()).find(page => page.url().includes('tauri.localhost'));
      if (page) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!page) throw new Error('Fenêtre Tauri introuvable. Pages CDP : ' + browser.contexts().flatMap(context => context.pages()).map(page => page.url()).join(', ') + '. ' + stderr);
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => typeof workspaceReady !== 'undefined' && workspaceReady);
    return page;
  }
  async function stop(page) {
    // Fermer la fenêtre de notre processus, comme avec la croix de l'application.
    const exited = new Promise(resolve => child.once('exit', resolve));
    const closeHelper = path.resolve(__dirname, 'close-window.ps1');
    const close = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', closeHelper, String(child.pid)], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let closeOutput = '';
    close.stdout.on('data', data => { closeOutput += data; });
    close.stderr.on('data', data => { closeOutput += data; });
    const closeCode = await new Promise((resolve, reject) => { close.once('exit', resolve); close.once('error', reject); });
    if (closeCode !== 0) throw new Error('Échec de la fermeture native : ' + closeOutput);
    let forced = false;
    // WebView2 et le moteur peuvent finir leurs écritures sur un runner Windows chargé.
    const timeout = setTimeout(() => { forced = true; child.kill(); }, 15000);
    await exited; clearTimeout(timeout);
    await browser.close(); browser = null;
    await new Promise(resolve => setTimeout(resolve, 500));
    if (forced) throw new Error('La fenêtre native ne s’est pas fermée normalement après 15 s. ' + closeOutput);
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
    await page.waitForFunction(() => { const main = document.querySelector('.main'); return main.scrollHeight - main.clientHeight >= 650; });
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
    // Le moteur Rust exécute réellement le Schematron, appelé depuis la WebView.
    await expect(page.locator('#verdicts')).toContainText(/Schematron officiel non respectée|règles? Schematron officiel non respectées?/, { timeout: 20000 });
    await expect(page.locator('#schematron-rules')).toContainText('BR-', { timeout: 20000 });
    // Le schéma XSD CII embarqué est réellement chargé et appliqué par l'exécutable.
    await expect(page.locator('#verdicts')).toContainText(/Schéma XSD respecté|erreurs? de schéma XSD/);
    await expect(page.locator('#xsd-errors')).toContainText(/Factur-X 1\.09\.2, profil|Cross Industry Invoice D22B/);
    await expect(page.locator('#controls tr').filter({ hasText: 'Mentions essentielles' })).toContainText('Nom de l\'acheteur');
    // Les mêmes résultats sont exportés sans perdre les détails Schematron/XSD.
    const report = await page.evaluate(() => controlReport(getFile(state.selected)));
    if (!report.schematron?.evalue || !report.schema_xsd?.evalue || !report.etats_controles?.schematron)
      throw new Error('Rapport natif incomplet.');
    await expect(page.getByRole('region', { name: 'Synthèse des vérifications' })).toBeVisible();
    const filtered = await page.evaluate(() => api.librarySearch('', { fournisseur: 'test seller', montantMin: 120, montantMax: 120, dateMax: '2026-12-31', offset: 0 }));
    if (filtered.correspondances !== 1) throw new Error('Filtres natifs : facture correspondante absente.');
    const excluded = await page.evaluate(() => api.librarySearch('', { montantMin: 121, offset: 0 }));
    if (excluded.correspondances !== 0) throw new Error('Filtre natif de montant ignoré.');
    // Réassociation : un autre XML est refusé, même si son numéro de facture est identique.
    const wrong = path.join(root, 'wrong.xml');
    const xml = invoicePdf().toString().match(/<rsm:CrossIndustryInvoice[\s\S]*?<\/rsm:CrossIndustryInvoice>/)[0];
    fs.writeFileSync(wrong, xml.replace('Test Seller', 'Another Seller'));
    const hash = report.empreinte_xml;
    const relink = await page.evaluate(async ({ hash, wrong, fixture }) => {
      let rejected = false;
      try { await invoke('library_relink', { hash, path: wrong }); } catch (error) { rejected = String(error).includes('empreinte'); }
      const result = await invoke('library_relink', { hash, path: fixture });
      const reopened = await invoke('library_open', { hash });
      return { rejected, same: result.doc_hash === hash && reopened.doc_hash === hash };
    }, { hash, wrong, fixture });
    if (!relink.rejected || !relink.same) throw new Error('Réassociation sans vérification correcte de l’empreinte.');
    // Une petite entrée PDF qui gonfle au-delà du plafond doit échouer dans le vrai moteur.
    const bomb = path.join(root, 'oversized.pdf');
    fs.writeFileSync(bomb, Buffer.concat([
      Buffer.from('%PDF-1.7\n1 0 obj\n<< /Filter /FlateDecode >>\nstream\n'),
      deflateSync(Buffer.alloc(32 * 1024 * 1024 + 1, 120)), Buffer.from('\nendstream\nendobj\n%%EOF'),
    ]));
    const bounded = await page.evaluate(async path => {
      try { await invoke('parse_path', { path, library: false }); return false; }
      catch (error) { return String(error).includes('décompression'); }
    }, bomb);
    if (!bounded) throw new Error('Le plafond PDF natif n’a pas rejeté le flux.');
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
    console.log('Native Windows OK : Rust/WebView2, PDF, reprise, filtres SQL, rapport complet, synthèse, empreinte de réassociation, plafond de décompression, suivi et restauration.');
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
