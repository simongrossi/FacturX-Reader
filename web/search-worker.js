/* Les regex s'exécutent hors de l'interface et peuvent être interrompues. */
self.onmessage = ({ data }) => {
  try {
    const re = data.regex ? new RegExp(data.query, "i") : null;
    const query = data.query.toLocaleLowerCase();
    const hits = [];
    for (const file of data.files) {
      file.rows.forEach((row, index) => {
        if (row.binary) return;
        const fields = [row.title, row.value, row.path, row.tag,
          ...Object.entries(row.attrs || {}).map(([k, v]) => `${k}=${v}`)];
        if (fields.some(value => {
          const text = String(value ?? "");
          return re ? re.test(text) : text.toLocaleLowerCase().includes(query);
        })) hits.push({ id: file.id, index });
      });
    }
    self.postMessage({ hits });
  } catch {
    self.postMessage({ error: "Expression régulière invalide." });
  }
};
