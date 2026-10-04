// Les versions installées et celles distribuées doivent correspondre.
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const root = path.join(__dirname, '..');
for (const [file, hash] of Object.entries(require('../web/exports/integrity.json'))) {
  const bytes = fs.readFileSync(path.join(root, 'web/exports', file));
  if (crypto.createHash('sha256').update(bytes).digest('hex') !== hash) throw new Error('Empreinte incorrecte : ' + file);
}
for (const [vendored, installed] of [
  ['exceljs.min.js', 'exceljs/dist/exceljs.min.js'],
  ['jspdf.umd.min.js', 'jspdf/dist/jspdf.umd.min.js'],
]) {
  if (!fs.readFileSync(path.join(root, 'web/exports', vendored)).equals(fs.readFileSync(path.join(root, 'node_modules', installed))))
    throw new Error('Distribution embarquée différente du paquet installé : ' + vendored);
}
