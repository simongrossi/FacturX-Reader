//! Bibliotheque locale : trace SQLite de toutes les factures analysees, entre
//! les sessions. Elle sert a retrouver une facture, et a comparer une facture
//! aux precedentes du meme fournisseur : doublon, changement d'IBAN, variation
//! de prix unitaire.
//!
//! Les donnees sont derivees des fichiers : reouvrir une facture la reenregistre.
//! Une base illisible est signalee, jamais recreee en silence.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use tauri::State;

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS invoices (
    hash TEXT PRIMARY KEY,
    filename TEXT NOT NULL, path TEXT NOT NULL, format TEXT NOT NULL,
    numero TEXT NOT NULL, avoir INTEGER NOT NULL, date TEXT NOT NULL, echeance TEXT NOT NULL,
    vendeur TEXT NOT NULL, vendeur_cle TEXT NOT NULL, acheteur TEXT NOT NULL, devise TEXT NOT NULL,
    ht TEXT NOT NULL, tva TEXT NOT NULL, ttc TEXT NOT NULL, a_payer TEXT NOT NULL, iban TEXT NOT NULL,
    first_seen TEXT NOT NULL, last_seen TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS invoices_vendeur ON invoices (vendeur_cle, numero);
CREATE TABLE IF NOT EXISTS lines (
    hash TEXT NOT NULL REFERENCES invoices (hash) ON DELETE CASCADE,
    idx INTEGER NOT NULL, cle TEXT NOT NULL, ref TEXT NOT NULL, nom TEXT NOT NULL,
    qte TEXT NOT NULL, pu TEXT NOT NULL, total TEXT NOT NULL,
    PRIMARY KEY (hash, idx)
);
CREATE INDEX IF NOT EXISTS lines_cle ON lines (cle);
";

/// Nombre maximal de lignes renvoyees par une recherche.
const SEARCH_LIMIT: usize = 1000;
/// Nombre maximal de variations de prix signalees par facture.
const PRICE_NOTES: usize = 30;

pub struct Library {
    path: PathBuf,
    /// `Err` : la base existe mais ne peut pas etre ouverte.
    conn: Mutex<Result<Connection, String>>,
}

fn open(path: &Path) -> Result<Connection, String> {
    let fail = |e: rusqlite::Error| format!("La bibliothèque ({}) est illisible : {e}.", path.display());
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("Dossier de la bibliothèque inaccessible : {e}."))?;
    }
    let conn = Connection::open(path).map_err(fail)?;
    // Un fichier qui n'est pas une base SQLite n'echoue qu'a la premiere lecture.
    let check: String = conn.query_row("PRAGMA quick_check", [], |r| r.get(0)).map_err(fail)?;
    if check != "ok" {
        return Err(format!("La bibliothèque ({}) est endommagée : {check}.", path.display()));
    }
    conn.execute_batch("PRAGMA foreign_keys = ON;").map_err(fail)?;
    conn.execute_batch(SCHEMA).map_err(fail)?;
    Ok(conn)
}

fn s(v: &Value, key: &str) -> String {
    v.get(key).and_then(Value::as_str).unwrap_or("").trim().to_string()
}

fn alnum(text: &str) -> String {
    text.chars().filter(|c| c.is_alphanumeric()).flat_map(char::to_uppercase).collect()
}

/// Identite stable du fournisseur : n° de TVA, sinon identifiant legal, sinon nom.
fn supplier_key(synthese: &Value) -> String {
    ["vendeur_tva", "vendeur_id_legal", "vendeur"]
        .iter()
        .map(|k| alnum(&s(synthese, k)))
        .find(|k| !k.is_empty())
        .unwrap_or_default()
}

/// Identite d'un article chez un fournisseur : reference, sinon designation.
fn line_key(line: &Value) -> String {
    let key = alnum(&s(line, "ref"));
    if key.is_empty() { alnum(&s(line, "nom")) } else { key }
}

fn now() -> String {
    chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string()
}

fn note(regle: &str, etat: &str, detail: String, path: &str) -> Value {
    json!({ "regle": regle, "etat": etat, "famille": "historique", "attendu": "", "constate": "", "ecart": "", "path": path, "detail": detail })
}

impl Library {
    pub fn new(path: PathBuf) -> Self {
        let conn = open(&path);
        Library { path, conn: Mutex::new(conn) }
    }

    fn with<T>(&self, f: impl FnOnce(&mut Connection) -> rusqlite::Result<T>) -> Result<T, String> {
        let mut guard = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        match guard.as_mut() {
            Ok(conn) => f(conn).map_err(|e| format!("Bibliothèque : {e}.")),
            Err(e) => Err(e.clone()),
        }
    }

    /// Enregistre une facture analysee et retourne les constats tires de
    /// l'historique (doublon, IBAN, prix), a ajouter a ses controles.
    pub fn record(&self, result: &Value, path: Option<&str>) -> Result<Vec<Value>, String> {
        let synthese = &result["synthese"];
        let hash = s(result, "doc_hash");
        if hash.is_empty() || !synthese.is_object() {
            return Ok(Vec::new());
        }
        let key = supplier_key(synthese);
        let numero = s(synthese, "numero");
        let iban = alnum(&s(synthese, "iban"));
        let date = s(synthese, "date");
        let lines: Vec<&Value> = synthese["lignes"].as_array().map(|l| l.iter().collect()).unwrap_or_default();
        self.with(|conn| {
            let tx = conn.transaction()?;
            let mut notes = Vec::new();

            // Doublon : meme fournisseur et meme numero, mais XML different.
            if !key.is_empty() && !numero.is_empty() {
                let mut q = tx.prepare(
                    "SELECT filename, date, first_seen FROM invoices WHERE vendeur_cle = ?1 AND numero = ?2 AND hash <> ?3 LIMIT 5",
                )?;
                let twins: Vec<String> = q
                    .query_map(params![key, numero, hash], |r| {
                        Ok(format!("{} (du {}, vue le {})", r.get::<_, String>(0)?, r.get::<_, String>(1)?, &r.get::<_, String>(2)?[..10]))
                    })?
                    .collect::<rusqlite::Result<_>>()?;
                if !twins.is_empty() {
                    notes.push(note(
                        "Doublon probable dans la bibliothèque",
                        "alerte",
                        format!("Même fournisseur et même numéro, contenu différent : {}.", twins.join(" ; ")),
                        "",
                    ));
                }
            }

            // IBAN jamais vu pour ce fournisseur alors que d'autres factures en portent un.
            if !key.is_empty() && !iban.is_empty() {
                let mut q = tx.prepare(
                    "SELECT iban, COUNT(*), MAX(date) FROM invoices WHERE vendeur_cle = ?1 AND hash <> ?2 AND iban <> '' GROUP BY iban ORDER BY MAX(date) DESC",
                )?;
                let known: Vec<(String, i64, String)> =
                    q.query_map(params![key, hash], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?.collect::<rusqlite::Result<_>>()?;
                if !known.is_empty() && !known.iter().any(|(k, _, _)| *k == iban) {
                    let previous: Vec<String> = known
                        .iter()
                        .take(3)
                        .map(|(k, n, d)| format!("{k} ({n} facture{}, dernière du {d})", if *n > 1 { "s" } else { "" }))
                        .collect();
                    notes.push(note(
                        "IBAN différent des factures précédentes de ce fournisseur",
                        "alerte",
                        format!(
                            "Cette facture : {iban}. Précédemment : {}. Vérifiez ce changement auprès du fournisseur par un canal déjà connu avant tout paiement.",
                            previous.join(" ; ")
                        ),
                        &s(synthese, "iban_path"),
                    ));
                }
            }

            // Prix unitaire different du dernier prix connu du meme article chez ce fournisseur.
            if !key.is_empty() {
                let mut q = tx.prepare(
                    "SELECT l.pu, i.date, i.numero FROM lines l JOIN invoices i ON i.hash = l.hash
                     WHERE i.vendeur_cle = ?1 AND l.cle = ?2 AND i.hash <> ?3 AND l.pu <> '' AND i.date < ?4
                     ORDER BY i.date DESC, i.last_seen DESC LIMIT 1",
                )?;
                let mut seen = Vec::new();
                for line in &lines {
                    let cle = line_key(line);
                    let Ok(price) = s(line, "pu").parse::<f64>() else { continue };
                    if cle.is_empty() || date.is_empty() || seen.contains(&cle) {
                        continue;
                    }
                    seen.push(cle.clone());
                    let previous: Option<(String, String, String)> =
                        q.query_row(params![key, cle, hash, date], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).optional()?;
                    let Some((old_text, old_date, old_numero)) = previous else { continue };
                    let Ok(old) = old_text.parse::<f64>() else { continue };
                    if (price - old).abs() < 1e-9 || notes.len() >= PRICE_NOTES {
                        continue;
                    }
                    let label = if s(line, "ref").is_empty() { s(line, "nom") } else { s(line, "ref") };
                    let change = if old != 0.0 { format!(" ({:+.1} %)", (price - old) / old * 100.0) } else { String::new() };
                    notes.push(note(
                        &format!("Prix unitaire modifié : {label}"),
                        "info",
                        format!("{old_text} → {}{change} depuis la facture {old_numero} du {old_date}.", s(line, "pu")),
                        "",
                    ));
                }
            }

            let stamp = now();
            let first_seen: Option<String> =
                tx.query_row("SELECT first_seen FROM invoices WHERE hash = ?1", params![hash], |r| r.get(0)).optional()?;
            // Un chemin deja connu est conserve quand la facture est rouverte par depot.
            let known_path: String = tx
                .query_row("SELECT path FROM invoices WHERE hash = ?1", params![hash], |r| r.get(0))
                .optional()?
                .unwrap_or_default();
            tx.execute(
                "INSERT OR REPLACE INTO invoices (hash, filename, path, format, numero, avoir, date, echeance, vendeur, vendeur_cle,
                    acheteur, devise, ht, tva, ttc, a_payer, iban, first_seen, last_seen)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)",
                params![
                    hash,
                    s(result, "filename"),
                    path.map(str::to_string).unwrap_or(known_path),
                    s(result, "format"),
                    numero,
                    synthese["avoir"].as_bool().unwrap_or(false),
                    date,
                    s(synthese, "echeance"),
                    s(synthese, "vendeur"),
                    key,
                    s(synthese, "acheteur"),
                    s(synthese, "devise"),
                    s(synthese, "ht"),
                    s(synthese, "tva"),
                    s(synthese, "ttc"),
                    s(synthese, "a_payer"),
                    iban,
                    first_seen.unwrap_or_else(|| stamp.clone()),
                    stamp,
                ],
            )?;
            tx.execute("DELETE FROM lines WHERE hash = ?1", params![hash])?;
            {
                let mut insert = tx.prepare("INSERT INTO lines (hash, idx, cle, ref, nom, qte, pu, total) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)")?;
                for (i, line) in lines.iter().enumerate() {
                    insert.execute(params![hash, i as i64, line_key(line), s(line, "ref"), s(line, "nom"), s(line, "qte"), s(line, "pu"), s(line, "total")])?;
                }
            }
            tx.commit()?;
            Ok(notes)
        })
    }

    fn count(&self) -> Result<i64, String> {
        self.with(|conn| conn.query_row("SELECT COUNT(*) FROM invoices", [], |r| r.get(0)))
    }

    fn search(&self, query: &str) -> Result<Value, String> {
        let like = format!("%{}%", query.trim().replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_"));
        self.with(|conn| {
            let mut q = conn.prepare(
                "SELECT hash, filename, path, format, numero, avoir, date, echeance, vendeur, acheteur, devise, ht, tva, ttc, a_payer,
                        first_seen, last_seen, (SELECT COUNT(*) FROM lines l WHERE l.hash = i.hash)
                 FROM invoices i
                 WHERE ?1 = '%%'
                    OR filename LIKE ?1 ESCAPE '\\' OR numero LIKE ?1 ESCAPE '\\' OR vendeur LIKE ?1 ESCAPE '\\'
                    OR acheteur LIKE ?1 ESCAPE '\\' OR date LIKE ?1 ESCAPE '\\' OR ttc LIKE ?1 ESCAPE '\\' OR ht LIKE ?1 ESCAPE '\\'
                    OR hash IN (SELECT hash FROM lines WHERE ref LIKE ?1 ESCAPE '\\' OR nom LIKE ?1 ESCAPE '\\')
                 ORDER BY date DESC, last_seen DESC LIMIT ?2",
            )?;
            let rows: Vec<Value> = q
                .query_map(params![like, SEARCH_LIMIT as i64 + 1], |r| {
                    Ok(json!({
                        "hash": r.get::<_, String>(0)?, "fichier": r.get::<_, String>(1)?, "chemin": r.get::<_, String>(2)?,
                        "format": r.get::<_, String>(3)?, "numero": r.get::<_, String>(4)?, "avoir": r.get::<_, bool>(5)?,
                        "date": r.get::<_, String>(6)?, "echeance": r.get::<_, String>(7)?, "vendeur": r.get::<_, String>(8)?,
                        "acheteur": r.get::<_, String>(9)?, "devise": r.get::<_, String>(10)?, "ht": r.get::<_, String>(11)?,
                        "tva": r.get::<_, String>(12)?, "ttc": r.get::<_, String>(13)?, "a_payer": r.get::<_, String>(14)?,
                        "vue_le": r.get::<_, String>(15)?, "revue_le": r.get::<_, String>(16)?, "lignes": r.get::<_, i64>(17)?,
                    }))
                })?
                .collect::<rusqlite::Result<_>>()?;
            let total: i64 = conn.query_row("SELECT COUNT(*) FROM invoices", [], |r| r.get(0))?;
            let truncated = rows.len() > SEARCH_LIMIT;
            let rows: Vec<Value> = rows.into_iter().take(SEARCH_LIMIT).collect();
            Ok(json!({ "factures": rows, "total": total, "tronque": truncated }))
        })
    }

    /// Prix unitaires d'un article chez le fournisseur d'une facture, du plus ancien au plus recent.
    fn price_history(&self, hash: &str, reference: &str, name: &str) -> Result<Value, String> {
        let cle = line_key(&json!({ "ref": reference, "nom": name }));
        self.with(|conn| {
            let mut q = conn.prepare(
                "SELECT i.date, i.numero, l.pu, l.qte, i.devise, i.filename, i.hash FROM lines l JOIN invoices i ON i.hash = l.hash
                 WHERE l.cle = ?2 AND i.vendeur_cle = (SELECT vendeur_cle FROM invoices WHERE hash = ?1) AND i.vendeur_cle <> ''
                 ORDER BY i.date, i.last_seen LIMIT 500",
            )?;
            let rows: Vec<Value> = q
                .query_map(params![hash, cle], |r| {
                    Ok(json!({
                        "date": r.get::<_, String>(0)?, "numero": r.get::<_, String>(1)?, "pu": r.get::<_, String>(2)?,
                        "qte": r.get::<_, String>(3)?, "devise": r.get::<_, String>(4)?, "fichier": r.get::<_, String>(5)?,
                        "courante": r.get::<_, String>(6)? == hash,
                    }))
                })?
                .collect::<rusqlite::Result<_>>()?;
            Ok(Value::Array(rows))
        })
    }

    fn status(&self) -> Value {
        match self.count() {
            Ok(n) => json!({ "ok": true, "erreur": "", "factures": n, "chemin": self.path.to_string_lossy() }),
            Err(e) => json!({ "ok": false, "erreur": e, "factures": 0, "chemin": self.path.to_string_lossy() }),
        }
    }

    /// Met la base illisible de cote (jamais supprimee) et en cree une neuve.
    fn reset(&self) -> Result<(), String> {
        let mut guard = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        if guard.is_ok() {
            return Err("La bibliothèque est lisible : utilisez « Vider la bibliothèque ».".into());
        }
        if self.path.exists() {
            let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S");
            let aside = self.path.with_file_name(format!("bibliotheque.illisible-{stamp}.sqlite"));
            std::fs::rename(&self.path, &aside).map_err(|e| format!("La base n'a pas pu être mise de côté : {e}."))?;
        }
        *guard = open(&self.path);
        guard.as_ref().map(|_| ()).map_err(Clone::clone)
    }
}

/// Ajoute a une facture analysee les constats tires de la bibliotheque.
/// Une bibliotheque indisponible ne doit jamais empecher de lire une facture.
pub fn annotate(library: &Library, result: &mut Value, path: Option<&str>) {
    match library.record(result, path) {
        Ok(notes) if !notes.is_empty() => {
            if let Some(list) = result.get_mut("controles").and_then(Value::as_array_mut) {
                list.extend(notes);
            }
        }
        Ok(_) => {}
        Err(e) => result["bibliotheque_erreur"] = e.into(),
    }
}

#[tauri::command]
pub fn library_status(library: State<'_, Library>) -> Value {
    library.status()
}

#[tauri::command]
pub fn library_search(library: State<'_, Library>, query: String) -> Result<Value, String> {
    library.search(&query)
}

#[tauri::command]
pub fn library_remove(library: State<'_, Library>, hash: String) -> Result<(), String> {
    library.with(|conn| conn.execute("DELETE FROM invoices WHERE hash = ?1", params![hash]).map(|_| ()))
}

#[tauri::command]
pub fn library_clear(library: State<'_, Library>) -> Result<(), String> {
    library.with(|conn| conn.execute_batch("DELETE FROM lines; DELETE FROM invoices; VACUUM;"))
}

#[tauri::command]
pub fn library_reset(library: State<'_, Library>) -> Result<(), String> {
    library.reset()
}

#[tauri::command]
pub fn library_prices(library: State<'_, Library>, hash: String, reference: String, name: String) -> Result<Value, String> {
    library.price_history(&hash, &reference, &name)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("fx-lib-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn invoice(hash: &str, numero: &str, date: &str, iban: &str, price: &str) -> Value {
        json!({
            "doc_hash": hash, "filename": format!("{numero}.pdf"), "format": "CII",
            "controles": [],
            "synthese": {
                "numero": numero, "avoir": false, "date": date, "echeance": "", "vendeur": "Papeterie Durand SAS",
                "vendeur_tva": "FR 44 732829320", "vendeur_id_legal": "", "acheteur": "Menuiserie Lefèvre", "devise": "EUR",
                "ht": "100.00", "tva": "20.00", "ttc": "120.00", "a_payer": "120.00", "iban": iban, "iban_path": "x/IBANID",
                "lignes": [
                    { "ref": "PAP-A4", "nom": "Papier A4", "qte": "2.00", "pu": price, "total": "100.00" },
                    { "ref": "", "nom": "Livraison", "qte": "1.00", "pu": "9.90", "total": "9.90" },
                ],
            },
        })
    }

    fn rules(notes: &[Value]) -> Vec<&str> {
        notes.iter().map(|n| n["regle"].as_str().unwrap()).collect()
    }

    #[test]
    fn enregistrement_recherche_et_persistance() {
        let dir = temp("base");
        let lib = Library::new(dir.join("bibliotheque.sqlite"));
        let iban = "FR76 3000 6000 0112 3456 7890 189";
        assert!(lib.record(&invoice("h1", "F-1", "2026-09-01", iban, "50.00"), Some("C:/f1.pdf")).unwrap().is_empty());
        // Reouverture par depot : aucun constat, chemin connu conserve, date de premiere vue inchangee.
        assert!(lib.record(&invoice("h1", "F-1", "2026-09-01", iban, "50.00"), None).unwrap().is_empty());
        assert_eq!(lib.count().unwrap(), 1);
        let found = lib.search("papier").unwrap();
        assert_eq!(found["factures"][0]["chemin"], "C:/f1.pdf");
        assert_eq!(found["factures"][0]["lignes"], 2);
        assert_eq!(found["total"], 1);
        assert_eq!(lib.search("durand").unwrap()["factures"].as_array().unwrap().len(), 1);
        assert_eq!(lib.search("100%").unwrap()["factures"].as_array().unwrap().len(), 0);
        assert_eq!(lib.search("").unwrap()["factures"].as_array().unwrap().len(), 1);
        // La base survit a une nouvelle ouverture.
        drop(lib);
        let lib = Library::new(dir.join("bibliotheque.sqlite"));
        assert_eq!(lib.status()["factures"], 1);
        lib.with(|c| c.execute("DELETE FROM invoices WHERE hash = 'h1'", []).map(|_| ())).unwrap();
        let orphans: i64 = lib.with(|c| c.query_row("SELECT COUNT(*) FROM lines", [], |r| r.get(0))).unwrap();
        assert_eq!(orphans, 0);
        drop(lib);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn doublon_iban_et_prix() {
        let dir = temp("constats");
        let lib = Library::new(dir.join("bibliotheque.sqlite"));
        let iban = "FR7630006000011234567890189";
        lib.record(&invoice("h1", "F-1", "2026-08-01", iban, "50.00"), None).unwrap();
        lib.record(&invoice("h2", "F-2", "2026-09-01", iban, "50.00"), None).unwrap();
        // Meme numero, autre contenu : doublon probable.
        let notes = lib.record(&invoice("h3", "F-2", "2026-09-01", iban, "50.00"), None).unwrap();
        assert_eq!(rules(&notes), ["Doublon probable dans la bibliothèque"]);
        // Nouvel IBAN et prix en hausse.
        let notes = lib.record(&invoice("h4", "F-4", "2026-10-01", "FR7610011000201234567890188", "52.50"), None).unwrap();
        assert_eq!(rules(&notes), ["IBAN différent des factures précédentes de ce fournisseur", "Prix unitaire modifié : PAP-A4"]);
        assert_eq!(notes[0]["etat"], "alerte");
        assert_eq!(notes[0]["path"], "x/IBANID");
        assert!(notes[0]["detail"].as_str().unwrap().contains("FR7630006000011234567890189 (3 factures, dernière du 2026-09-01)"));
        assert_eq!(notes[1]["detail"], "50.00 → 52.50 (+5.0 %) depuis la facture F-2 du 2026-09-01.");
        // Facture suivante avec le nouvel IBAN : il est desormais connu, le prix est stable.
        let notes = lib.record(&invoice("h5", "F-5", "2026-10-15", "FR7610011000201234567890188", "52.50"), None).unwrap();
        assert!(notes.is_empty(), "{notes:?}");
        // Une facture plus ancienne rouverte n'est pas comparee a des prix posterieurs.
        let notes = lib.record(&invoice("h1", "F-1", "2026-08-01", iban, "50.00"), None).unwrap();
        assert!(notes.is_empty(), "{notes:?}");
        let history = lib.price_history("h4", "PAP-A4", "").unwrap();
        let prices: Vec<&str> = history.as_array().unwrap().iter().map(|r| r["pu"].as_str().unwrap()).collect();
        assert_eq!(prices, ["50.00", "50.00", "50.00", "52.50", "52.50"]);
        assert_eq!(history[3]["courante"], true);
        // Article sans reference : identifie par sa designation.
        assert_eq!(lib.price_history("h4", "", "Livraison").unwrap().as_array().unwrap().len(), 5);
        drop(lib);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn base_illisible_signalee_puis_reinitialisee() {
        let dir = temp("illisible");
        let path = dir.join("bibliotheque.sqlite");
        std::fs::write(&path, "ceci n'est pas une base SQLite, mais assez long pour un en-tete").unwrap();
        let lib = Library::new(path.clone());
        assert_eq!(lib.status()["ok"], false);
        assert!(lib.search("").unwrap_err().contains("illisible"));
        let mut result = invoice("h1", "F-1", "2026-09-01", "", "50.00");
        annotate(&lib, &mut result, None);
        assert!(result["bibliotheque_erreur"].as_str().unwrap().contains("illisible"));
        // Le fichier n'a pas ete remplace.
        assert!(std::fs::read_to_string(&path).unwrap().starts_with("ceci n'est pas"));
        lib.reset().unwrap();
        assert_eq!(lib.status()["ok"], true);
        assert!(std::fs::read_dir(&dir).unwrap().filter_map(|e| e.ok()).any(|e| e.file_name().to_string_lossy().starts_with("bibliotheque.illisible-")));
        assert!(lib.reset().unwrap_err().contains("lisible"));
        drop(lib);
        std::fs::remove_dir_all(dir).unwrap();
    }

    /// Facture CII complete analysee par le moteur, pour verifier la chaine entiere.
    fn cii(numero: &str, date: &str, iban: &str, price: &str) -> Vec<u8> {
        format!(r#"<rsm:CrossIndustryInvoice xmlns:rsm="urn:rsm" xmlns:ram="urn:ram" xmlns:udt="urn:udt">
<rsm:ExchangedDocumentContext><ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>urn:cen.eu:en16931:2017</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter></rsm:ExchangedDocumentContext>
<rsm:ExchangedDocument><ram:ID>{numero}</ram:ID><ram:TypeCode>380</ram:TypeCode><ram:IssueDateTime><udt:DateTimeString format="102">{date}</udt:DateTimeString></ram:IssueDateTime></rsm:ExchangedDocument>
<rsm:SupplyChainTradeTransaction>
<ram:IncludedSupplyChainTradeLineItem><ram:AssociatedDocumentLineDocument><ram:LineID>1</ram:LineID></ram:AssociatedDocumentLineDocument><ram:SpecifiedTradeProduct><ram:SellerAssignedID>PAP-A4</ram:SellerAssignedID><ram:Name>Papier A4</ram:Name></ram:SpecifiedTradeProduct><ram:SpecifiedLineTradeAgreement><ram:NetPriceProductTradePrice><ram:ChargeAmount>{price}</ram:ChargeAmount></ram:NetPriceProductTradePrice></ram:SpecifiedLineTradeAgreement><ram:SpecifiedLineTradeDelivery><ram:BilledQuantity unitCode="C62">1</ram:BilledQuantity></ram:SpecifiedLineTradeDelivery><ram:SpecifiedLineTradeSettlement><ram:ApplicableTradeTax><ram:CategoryCode>S</ram:CategoryCode><ram:RateApplicablePercent>20</ram:RateApplicablePercent></ram:ApplicableTradeTax><ram:SpecifiedTradeSettlementLineMonetarySummation><ram:LineTotalAmount>{price}</ram:LineTotalAmount></ram:SpecifiedTradeSettlementLineMonetarySummation></ram:SpecifiedLineTradeSettlement></ram:IncludedSupplyChainTradeLineItem>
<ram:ApplicableHeaderTradeAgreement><ram:SellerTradeParty><ram:Name>Vendeur SAS</ram:Name><ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">FR44732829320</ram:ID></ram:SpecifiedTaxRegistration></ram:SellerTradeParty><ram:BuyerTradeParty><ram:Name>Acheteur</ram:Name></ram:BuyerTradeParty></ram:ApplicableHeaderTradeAgreement>
<ram:ApplicableHeaderTradeSettlement><ram:InvoiceCurrencyCode>EUR</ram:InvoiceCurrencyCode><ram:SpecifiedTradeSettlementPaymentMeans><ram:TypeCode>58</ram:TypeCode><ram:PayeePartyCreditorFinancialAccount><ram:IBANID>{iban}</ram:IBANID></ram:PayeePartyCreditorFinancialAccount></ram:SpecifiedTradeSettlementPaymentMeans>
<ram:SpecifiedTradeSettlementHeaderMonetarySummation><ram:LineTotalAmount>{price}</ram:LineTotalAmount><ram:TaxBasisTotalAmount>{price}</ram:TaxBasisTotalAmount><ram:GrandTotalAmount>{price}</ram:GrandTotalAmount><ram:DuePayableAmount>{price}</ram:DuePayableAmount></ram:SpecifiedTradeSettlementHeaderMonetarySummation></ram:ApplicableHeaderTradeSettlement>
</rsm:SupplyChainTradeTransaction></rsm:CrossIndustryInvoice>"#).into_bytes()
    }

    #[test]
    fn facture_reelle_du_moteur_a_la_bibliotheque() {
        let dir = temp("moteur");
        let lib = Library::new(dir.join("bibliotheque.sqlite"));
        let mut first = crate::facturx::parse_file("a.xml", &cii("F-1", "20260801", "FR7630006000011234567890189", "50.00")).unwrap();
        assert_eq!(first["synthese"]["iban"], "FR7630006000011234567890189");
        assert_eq!(first["synthese"]["vendeur_tva"], "FR44732829320");
        assert_eq!(first["synthese"]["lignes"][0], json!({ "ref": "PAP-A4", "nom": "Papier A4", "qte": "1.00", "pu": "50.00", "total": "50.00" }));
        let before = first["controles"].as_array().unwrap().len();
        annotate(&lib, &mut first, Some("C:/a.xml"));
        assert_eq!(first["controles"].as_array().unwrap().len(), before);
        // Deuxieme facture du meme fournisseur : autre IBAN, prix en hausse.
        let mut second = crate::facturx::parse_file("b.xml", &cii("F-2", "20260901", "FR7610011000201234567890188", "55.00")).unwrap();
        annotate(&lib, &mut second, None);
        let added: Vec<&Value> = second["controles"].as_array().unwrap().iter().skip(before).collect();
        let labels: Vec<&str> = added.iter().map(|n| n["regle"].as_str().unwrap()).collect();
        assert_eq!(labels, ["IBAN différent des factures précédentes de ce fournisseur", "Prix unitaire modifié : PAP-A4"]);
        assert!(added[0]["path"].as_str().unwrap().ends_with("PayeePartyCreditorFinancialAccount/IBANID"));
        assert_eq!(added[1]["detail"], "50.00 → 55.00 (+10.0 %) depuis la facture F-1 du 2026-08-01.");
        assert_eq!(lib.search("pap-a4").unwrap()["factures"].as_array().unwrap().len(), 2);
        drop(lib);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
