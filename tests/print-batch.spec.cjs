const { test, expect } = require('@playwright/test');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
let server, url;
test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    const file = path.join(__dirname, '../web', req.url === '/' ? 'index.html' : req.url.split('?')[0]);
    res.setHeader('Content-Type', file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.png') ? 'image/png' : 'text/html');
    fs.readFile(file, (err, data) => { res.statusCode = err ? 404 : 200; res.end(err ? '' : data); });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(() => server.close());

/* PDF A4 valide (une page) généré avec jspdf, en base64. */
function makePdfBase64(text) {
  const { jsPDF } = require('jspdf');
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  doc.setFontSize(22);
  doc.text(text, 40, 80);
  return doc.output('datauristring').split('base64,')[1];
}

/* Deux factures : « avec-xml » porte un PDF du XML distinct + PDF du document,
   « sans-xml » ne porte que le PDF du document. */
async function mockBackend(page) {
  const pdfA = makePdfBase64('PDF DU XML');
  const pdfB = makePdfBase64('PDF DU DOCUMENT');
  await page.addInitScript(({ pdfA, pdfB }) => {
    const base = (name, hash, withXml) => ({
      kind: 'pdf', format: 'Factur-X', root: '', filename: name, doc_hash: hash,
      header: [], lines: [], rows: [], xml_pretty: '', summary: [], sections: [], warnings: [],
      pdf: { base64: pdfB, filename: 'doc.pdf', size: 123 },
      xml_pdf: withXml ? { base64: pdfA, filename: 'xml.pdf', size: 123 } : null,
    });
    window.__TAURI__ = { core: { invoke: async (command, args, options) => {
      if (command === 'startup_paths') return { files: [] };
      if (command === 'app_info') return { version: 'test', pointages: 'test' };
      if (command === 'get_pointage') return { lines: [] };
      if (command === 'get_reviews') return {};
      if (command === 'set_review') return null;
      if (command === 'data_status') {
        const part = { chemin: 'x', ok: true, erreur: '', entrees: 0, sauvegardes: [] };
        return { pointages: part, suivi: { ...part } };
      }
      if (command === 'library_status') return { ok: true, erreur: '', factures: 0, chemin: 'x' };
      if (command === 'parse_file') {
        // Corps = octets (2e arg), nom du fichier dans l'en-tête x-filename (3e arg, options).
        const headers = (options && options.headers) || (args && args.headers) || {};
        const name = decodeURIComponent(headers['x-filename'] || '');
        const withXml = name.includes('avec-xml');
        return base(name, withXml ? 'h-xml' : 'h-doc', withXml);
      }
      if (command === 'print_window') {
        window.__printed = (window.__printed || 0) + 1;
        window.__printSheet = document.querySelectorAll('#batch-print-sheet .bp-doc').length;
        return null;
      }
      return null;
    } } };
  }, { pdfA, pdfB });
  await page.goto(url);
}

test('sélection par icône, modes, compteurs et impression unique', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await mockBackend(page);
  await page.locator('#file-input').setInputFiles([
    { name: 'avec-xml.pdf', mimeType: 'application/pdf', buffer: Buffer.from('x') },
    { name: 'sans-xml.pdf', mimeType: 'application/pdf', buffer: Buffer.from('y') },
  ]);
  await expect(page.locator('#file-list .file-item')).toHaveCount(2);

  // Sans sélection : l'entrée du menu est grisée.
  await page.locator('#menubar').getByRole('button', { name: 'Fichier' }).click();
  await expect(page.locator('.menubar-drop').getByRole('menuitem', { name: 'Impression groupée…' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(page.locator('.menubar-drop')).toHaveCount(0);

  // Icône imprimante sur les deux factures, absente sur une ligne en erreur.
  await expect(page.locator('.file-item .fi-print')).toHaveCount(2);
  await page.locator('.file-item .fi-print').first().click();
  await page.locator('.file-item .fi-print').last().click();
  await expect(page.locator('.file-item.print-selected')).toHaveCount(2);

  // Menu actif, modale ouverte : mode par défaut « XML sinon document ».
  await page.locator('#menubar').getByRole('button', { name: 'Fichier' }).click();
  await page.locator('.menubar-drop').getByRole('menuitem', { name: 'Impression groupée…' }).click();
  const dialog = page.locator('#batch-print-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('input[value="mixed"]')).toBeChecked();
  await expect(page.locator('#batch-print-info')).toHaveText('2 factures sélectionnées — 2 PDF imprimables');
  await expect(page.locator('#batch-print-go')).toHaveText('IMPRIMER 2 Fichiers PDF ?');
  await expect(page.locator('#batch-print-go')).toBeEnabled();

  // Mode « XML uniquement » : la facture sans PDF du XML est ignorée.
  await dialog.locator('input[value="xml"]').check();
  await expect(page.locator('#batch-print-info')).toHaveText('2 factures sélectionnées — 1 PDF imprimable — 1 ignorée (PDF absent)');
  await expect(page.locator('#batch-print-go')).toHaveText('IMPRIMER 1 Fichier PDF ?');

  // Mode « document uniquement » : les deux sont imprimables.
  await dialog.locator('input[value="doc"]').check();
  await expect(page.locator('#batch-print-go')).toHaveText('IMPRIMER 2 Fichiers PDF ?');

  // Mode par défaut retenu pour la prochaine ouverture.
  const savedMode = await page.evaluate(() => JSON.parse(localStorage.getItem('fx-settings') || '{}').printMode);
  expect(savedMode).toBe('doc');

  // Impression : un seul job, deux PDF rendus, sélection conservée après nettoyage.
  await page.locator('#batch-print-cancel').click();
  await expect(dialog).toBeHidden();
  await page.locator('#menubar').getByRole('button', { name: 'Fichier' }).click();
  await page.locator('.menubar-drop').getByRole('menuitem', { name: 'Impression groupée…' }).click();
  await page.locator('#batch-print-go').click();
  await expect.poll(() => page.evaluate(() => window.__printed)).toBe(1);
  expect(await page.evaluate(() => window.__printSheet)).toBe(2);
  await expect(page.locator('body')).toHaveClass(/batch-printing/);

  // Rendu à l'impression : application masquée, feuille de PDF seule.
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('#menubar')).toBeHidden();
  await expect(page.locator('#sidebar')).toBeHidden();
  await expect(page.locator('#batch-print-sheet')).toBeVisible();
  await expect(page.locator('#batch-print-sheet .bp-page img')).toHaveCount(2);
  await page.emulateMedia({ media: 'screen' });

  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await expect(page.locator('body')).not.toHaveClass(/batch-printing/);
  await expect(page.locator('#batch-print-sheet')).toHaveText('');
  // La sélection est conservée après l'impression.
  await expect(page.locator('.file-item.print-selected')).toHaveCount(2);
  expect(errors).toEqual([]);
});
