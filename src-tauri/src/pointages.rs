//! Donnees de travail de l'utilisateur, persistees en JSON (cle = empreinte du XML) :
//!   - `pointages.json` : lignes pointees ;
//!   - `suivi.json`     : statut de verification et commentaires.
//!
//! Regle de securite : un fichier illisible n'est JAMAIS traite comme un fichier
//! vide. La lecture echoue, toute ecriture est refusee, et l'utilisateur peut
//! restaurer une sauvegarde. Une sauvegarde datee est prise avant la premiere
//! ecriture de chaque jour.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde_json::{json, Map, Value};
use tauri::State;
use tauri_plugin_dialog::DialogExt;

/// Nombre de sauvegardes quotidiennes conservees par fichier.
const BACKUPS_KEPT: usize = 7;
const REVIEW_STATUSES: [&str; 3] = ["À vérifier", "Vérifiée", "Anomalie"];
const EXPORT_FORMAT: &str = "facturx-reader-sauvegarde";

pub struct Store {
    path: PathBuf,
    lock: Mutex<()>,
}

/// Lignes pointees.
pub struct Pointages(pub Store);
/// Suivi de verification (statut, commentaires).
pub struct Suivi(pub Store);

/// Mode portable : un fichier pose a cote de l'executable est prioritaire ;
/// sinon le dossier de donnees de l'application.
pub fn resolve_path(app_data_dir: Option<PathBuf>, file_name: &str) -> PathBuf {
    let portable = std::env::current_exe().ok().and_then(|exe| exe.parent().map(|d| d.join(file_name)));
    if let Some(p) = &portable {
        if p.is_file() {
            return p.clone();
        }
    }
    app_data_dir.map(|d| d.join(file_name)).or(portable).unwrap_or_else(|| PathBuf::from(file_name))
}

fn now() -> String {
    chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string()
}

fn parse_object(text: &str) -> Result<Map<String, Value>, String> {
    match serde_json::from_str::<Value>(text) {
        Ok(Value::Object(m)) => Ok(m),
        Ok(_) => Err("le contenu n'est pas un objet JSON".into()),
        Err(e) => Err(format!("JSON invalide ({e})")),
    }
}

impl Store {
    pub fn new(path: PathBuf) -> Self {
        Store { path, lock: Mutex::new(()) }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    fn name(&self) -> String {
        self.path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()
    }

    fn stem(&self) -> String {
        self.path.file_stem().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()
    }

    /// Fichier absent = aucune donnee. Fichier present mais illisible = erreur.
    fn load(&self) -> Result<Map<String, Value>, String> {
        match std::fs::read_to_string(&self.path) {
            Ok(text) if text.trim().is_empty() => Err(format!("{} est vide.", self.name())),
            Ok(text) => parse_object(&text).map_err(|e| format!("{} est illisible : {e}.", self.name())),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Map::new()),
            Err(e) => Err(format!("{} ne peut pas être lu : {e}.", self.name())),
        }
    }

    /// Lecture pour une ecriture : le message dit quoi faire.
    fn load_for_write(&self) -> Result<Map<String, Value>, String> {
        self.load().map_err(|e| {
            format!("{e} Rien n'a été enregistré. Restaurez une sauvegarde depuis les Paramètres.")
        })
    }

    /// Sauvegardes datees du fichier, de la plus recente a la plus ancienne.
    fn backups(&self) -> Vec<PathBuf> {
        let prefix = format!("{}.sauvegarde-", self.stem());
        let Some(dir) = self.path.parent() else { return Vec::new() };
        let mut found: Vec<PathBuf> = std::fs::read_dir(dir)
            .into_iter()
            .flatten()
            .filter_map(|e| e.ok().map(|e| e.path()))
            .filter(|p| {
                p.file_name().is_some_and(|n| {
                    let n = n.to_string_lossy();
                    n.starts_with(&prefix) && n.ends_with(".json")
                })
            })
            .collect();
        found.sort();
        found.reverse();
        found
    }

    /// Copie le fichier actuel (deja valide) avant la premiere ecriture du jour.
    fn backup_today(&self) {
        if !self.path.is_file() {
            return;
        }
        let today = chrono::Local::now().format("%Y-%m-%d");
        let target = self.path.with_file_name(format!("{}.sauvegarde-{today}.json", self.stem()));
        if !target.exists() && std::fs::copy(&self.path, &target).is_ok() {
            for old in self.backups().into_iter().skip(BACKUPS_KEPT) {
                let _ = std::fs::remove_file(old);
            }
        }
    }

    fn save(&self, data: &Map<String, Value>) -> Result<(), String> {
        let err = |e: std::io::Error| format!("{} n'a pas pu être enregistré : {e}.", self.name());
        if let Some(dir) = self.path.parent() {
            std::fs::create_dir_all(dir).map_err(err)?;
        }
        self.backup_today();
        let tmp = self.path.with_extension("json.tmp");
        let body = serde_json::to_string_pretty(data).map_err(|e| e.to_string())?;
        std::fs::write(&tmp, body).map_err(err)?;
        std::fs::rename(&tmp, &self.path).map_err(err)
    }

    fn status(&self) -> Value {
        let backups: Vec<String> = self
            .backups()
            .iter()
            .filter_map(|p| p.file_name().map(|n| n.to_string_lossy().into_owned()))
            .collect();
        let (ok, error, entries) = match self.load() {
            Ok(data) => (true, String::new(), data.len()),
            Err(e) => (false, e, 0),
        };
        json!({
            "chemin": self.path.to_string_lossy(),
            "ok": ok,
            "erreur": error,
            "entrees": entries,
            "sauvegardes": backups,
        })
    }

    /// Remet en place la sauvegarde lisible la plus recente. Le fichier actuel est
    /// conserve sous un autre nom, jamais supprime.
    fn restore_latest(&self) -> Result<String, String> {
        let backup = self
            .backups()
            .into_iter()
            .find(|p| std::fs::read_to_string(p).is_ok_and(|t| parse_object(&t).is_ok()))
            .ok_or_else(|| format!("Aucune sauvegarde lisible de {}.", self.name()))?;
        if self.path.exists() {
            let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S");
            let aside = self.path.with_file_name(format!("{}.illisible-{stamp}.json", self.stem()));
            std::fs::rename(&self.path, &aside).map_err(|e| format!("Le fichier actuel n'a pas pu être mis de côté : {e}."))?;
        }
        std::fs::copy(&backup, &self.path).map_err(|e| format!("Restauration impossible : {e}."))?;
        Ok(backup.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default())
    }

    /// Fusionne des entrees importees : une entree absente est ajoutee, une entree
    /// existante n'est remplacee que si celle importee est plus recente.
    fn merge(&self, incoming: &Map<String, Value>) -> Result<usize, String> {
        let _guard = self.lock.lock().unwrap_or_else(|e| e.into_inner());
        let mut data = self.load_for_write()?;
        let updated = |v: &Value| v.get("updated").and_then(Value::as_str).unwrap_or("").to_string();
        let mut changed = 0;
        for (key, entry) in incoming {
            if !entry.is_object() {
                continue;
            }
            if data.get(key).is_none_or(|current| updated(entry) > updated(current)) {
                data.insert(key.clone(), entry.clone());
                changed += 1;
            }
        }
        if changed > 0 {
            self.save(&data)?;
        }
        Ok(changed)
    }
}

// ------------------------------------------------------------------ pointages

#[tauri::command]
pub fn get_pointage(store: State<'_, Pointages>, hash: String) -> Result<Value, String> {
    let _guard = store.0.lock.lock().unwrap_or_else(|e| e.into_inner());
    let lines = store.0.load()?.get(hash.trim()).and_then(|e| e.get("lines")).cloned().unwrap_or_else(|| json!([]));
    Ok(json!({ "hash": hash.trim(), "lines": lines }))
}

#[tauri::command]
pub fn set_pointage(
    store: State<'_, Pointages>,
    hash: String,
    lines: Vec<i64>,
    filename: Option<String>,
) -> Result<Value, String> {
    let hash = hash.trim().to_string();
    if hash.is_empty() {
        return Err("Champ 'hash' manquant.".into());
    }
    let lines: Vec<i64> = lines.into_iter().collect::<BTreeSet<_>>().into_iter().collect();
    let _guard = store.0.lock.lock().unwrap_or_else(|e| e.into_inner());
    let mut data = store.0.load_for_write()?;
    if lines.is_empty() {
        data.shift_remove(&hash);
    } else {
        data.insert(
            hash.clone(),
            json!({ "filename": filename.unwrap_or_default(), "updated": now(), "lines": lines }),
        );
    }
    store.0.save(&data)?;
    Ok(json!({ "ok": true, "hash": hash, "lines": lines }))
}

#[tauri::command]
pub fn clear_pointage(store: State<'_, Pointages>, hash: String) -> Result<Value, String> {
    let hash = hash.trim().to_string();
    let _guard = store.0.lock.lock().unwrap_or_else(|e| e.into_inner());
    let mut data = store.0.load_for_write()?;
    data.shift_remove(&hash);
    store.0.save(&data)?;
    Ok(json!({ "ok": true, "hash": hash, "lines": [] }))
}

// ------------------------------------------------------------------ suivi de verification

/// Suivi valide : statut connu, commentaire et commentaires de ligne en texte.
fn valid_review(review: &Value) -> bool {
    let text = |v: &Value| v.as_str().is_some_and(|s| s.chars().count() <= 10_000);
    review.get("status").and_then(Value::as_str).is_some_and(|s| REVIEW_STATUSES.contains(&s))
        && review.get("comment").is_some_and(text)
        && review.get("lines").and_then(Value::as_object).is_some_and(|l| l.values().all(text))
}

/// Tous les suivis enregistres (cle = empreinte du XML).
#[tauri::command]
pub fn get_reviews(store: State<'_, Suivi>) -> Result<Value, String> {
    let _guard = store.0.lock.lock().unwrap_or_else(|e| e.into_inner());
    store.0.load().map(Value::Object)
}

#[tauri::command]
pub fn set_review(store: State<'_, Suivi>, key: String, review: Value, filename: Option<String>) -> Result<(), String> {
    let key = key.trim().to_string();
    if key.is_empty() || !valid_review(&review) {
        return Err("Suivi de vérification invalide.".into());
    }
    let _guard = store.0.lock.lock().unwrap_or_else(|e| e.into_inner());
    let mut data = store.0.load_for_write()?;
    let untouched = review["status"] == REVIEW_STATUSES[0]
        && review["comment"] == ""
        && review["lines"].as_object().is_some_and(Map::is_empty);
    if untouched {
        // Suivi revenu a son etat initial : rien a conserver.
        if data.shift_remove(&key).is_none() {
            return Ok(());
        }
    } else {
        data.insert(
            key,
            json!({
                "filename": filename.unwrap_or_default(),
                "updated": now(),
                "status": review["status"],
                "comment": review["comment"],
                "lines": review["lines"],
            }),
        );
    }
    store.0.save(&data)
}

// ------------------------------------------------------------------ etat, restauration, export, import

/// Etat des deux fichiers pour les Parametres et l'alerte au demarrage.
#[tauri::command]
pub fn data_status(pointages: State<'_, Pointages>, suivi: State<'_, Suivi>) -> Value {
    json!({ "pointages": pointages.0.status(), "suivi": suivi.0.status() })
}

/// Restaure la derniere sauvegarde lisible de `pointages` ou de `suivi`.
#[tauri::command]
pub fn restore_backup(pointages: State<'_, Pointages>, suivi: State<'_, Suivi>, which: String) -> Result<String, String> {
    let store = match which.as_str() {
        "pointages" => &pointages.0,
        "suivi" => &suivi.0,
        _ => return Err("Fichier inconnu.".into()),
    };
    let _guard = store.lock.lock().unwrap_or_else(|e| e.into_inner());
    store.restore_latest()
}

/// Exporte pointages et suivi dans un seul fichier choisi par l'utilisateur.
#[tauri::command]
pub async fn export_data(app: tauri::AppHandle, pointages: State<'_, Pointages>, suivi: State<'_, Suivi>) -> Result<bool, String> {
    let body = {
        let _a = pointages.0.lock.lock().unwrap_or_else(|e| e.into_inner());
        let _b = suivi.0.lock.lock().unwrap_or_else(|e| e.into_inner());
        json!({
            "format": EXPORT_FORMAT,
            "version": 1,
            "exporte_le": now(),
            "pointages": pointages.0.load()?,
            "suivi": suivi.0.load()?,
        })
    };
    let name = format!("facturx-reader-sauvegarde-{}.json", chrono::Local::now().format("%Y-%m-%d"));
    let Some(dest) = app.dialog().file().set_file_name(name).add_filter("Sauvegarde JSON", &["json"]).blocking_save_file() else {
        return Ok(false);
    };
    let path = dest.into_path().map_err(|e| e.to_string())?;
    let bytes = serde_json::to_vec_pretty(&body).map_err(|e| e.to_string())?;
    std::fs::write(&path, bytes).map_err(|e| format!("Écriture impossible : {e}"))?;
    Ok(true)
}

/// Contenu d'un fichier d'export, valide : (pointages, suivi).
fn parse_export(text: &str) -> Result<(Map<String, Value>, Map<String, Value>), String> {
    let root = parse_object(text).map_err(|e| format!("Fichier de sauvegarde illisible : {e}."))?;
    if root.get("format").and_then(Value::as_str) != Some(EXPORT_FORMAT) {
        return Err("Ce fichier n'est pas une sauvegarde Factur-X Reader.".into());
    }
    let part = |name: &str| root.get(name).and_then(Value::as_object).cloned().unwrap_or_default();
    let mut suivi = part("suivi");
    suivi.retain(|_, entry| valid_review(entry));
    let mut pointages = part("pointages");
    pointages.retain(|_, entry| entry.get("lines").and_then(Value::as_array).is_some_and(|l| l.iter().all(Value::is_i64)));
    Ok((pointages, suivi))
}

/// Importe un fichier d'export et le fusionne avec les donnees presentes.
/// Retourne `null` si l'utilisateur annule.
#[tauri::command]
pub async fn import_data(app: tauri::AppHandle, pointages: State<'_, Pointages>, suivi: State<'_, Suivi>) -> Result<Value, String> {
    let Some(source) = app.dialog().file().add_filter("Sauvegarde JSON", &["json"]).blocking_pick_file() else {
        return Ok(Value::Null);
    };
    let path = source.into_path().map_err(|e| e.to_string())?;
    let text = std::fs::read_to_string(&path).map_err(|e| format!("Lecture impossible : {e}"))?;
    let (p, s) = parse_export(&text)?;
    Ok(json!({ "pointages": pointages.0.merge(&p)?, "suivi": suivi.0.merge(&s)? }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_store(name: &str) -> (PathBuf, Store) {
        let dir = std::env::temp_dir().join(format!("fx-store-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let store = Store::new(dir.join("pointages.json"));
        (dir, store)
    }

    fn entry(updated: &str, lines: Value) -> Value {
        json!({ "filename": "f.pdf", "updated": updated, "lines": lines })
    }

    #[test]
    fn fichier_absent_puis_ecriture_et_sauvegarde() {
        let (dir, store) = temp_store("ecriture");
        assert!(store.load().unwrap().is_empty());
        let mut data = Map::new();
        data.insert("a".into(), entry("2026-10-01 10:00:00", json!([1, 2])));
        store.save(&data).unwrap();
        // Premiere ecriture : pas encore de fichier a sauvegarder.
        assert!(store.backups().is_empty());
        data.insert("b".into(), entry("2026-10-02 10:00:00", json!([3])));
        store.save(&data).unwrap();
        // Deuxieme ecriture du jour : une seule sauvegarde, avec l'etat precedent.
        store.save(&data).unwrap();
        let backups = store.backups();
        assert_eq!(backups.len(), 1);
        assert_eq!(parse_object(&std::fs::read_to_string(&backups[0]).unwrap()).unwrap().len(), 1);
        assert_eq!(store.load().unwrap().len(), 2);
        assert_eq!(store.status()["entrees"], 2);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn fichier_illisible_jamais_ecrase_puis_restaure() {
        let (dir, store) = temp_store("illisible");
        let mut data = Map::new();
        data.insert("a".into(), entry("2026-10-01 10:00:00", json!([1])));
        store.save(&data).unwrap();
        store.save(&data).unwrap();
        std::fs::write(store.path(), "{ \"a\": [1, ").unwrap();
        // Lecture et preparation d'ecriture echouent : le contenu n'est pas remplace.
        assert!(store.load().unwrap_err().contains("illisible"));
        assert!(store.load_for_write().unwrap_err().contains("Restaurez une sauvegarde"));
        assert!(store.merge(&data).is_err());
        assert_eq!(std::fs::read_to_string(store.path()).unwrap(), "{ \"a\": [1, ");
        let status = store.status();
        assert_eq!(status["ok"], false);
        assert_eq!(status["sauvegardes"].as_array().unwrap().len(), 1);
        // Restauration : donnees revenues, fichier illisible conserve a cote.
        store.restore_latest().unwrap();
        assert_eq!(store.load().unwrap().len(), 1);
        let aside = std::fs::read_dir(&dir).unwrap().filter_map(|e| e.ok()).any(|e| e.file_name().to_string_lossy().contains(".illisible-"));
        assert!(aside);
        // Fichier vide ou non objet : meme refus.
        std::fs::write(store.path(), "").unwrap();
        assert!(store.load().is_err());
        std::fs::write(store.path(), "[1, 2]").unwrap();
        assert!(store.load().is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn restauration_sans_sauvegarde() {
        let (dir, store) = temp_store("sans");
        std::fs::write(store.path(), "x").unwrap();
        assert!(store.restore_latest().unwrap_err().starts_with("Aucune sauvegarde lisible"));
        assert_eq!(std::fs::read_to_string(store.path()).unwrap(), "x");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn fusion_garde_le_plus_recent() {
        let (dir, store) = temp_store("fusion");
        let mut data = Map::new();
        data.insert("a".into(), entry("2026-10-02 10:00:00", json!([1])));
        data.insert("b".into(), entry("2026-10-01 10:00:00", json!([2])));
        store.save(&data).unwrap();
        let mut incoming = Map::new();
        incoming.insert("a".into(), entry("2026-10-01 09:00:00", json!([9])));
        incoming.insert("b".into(), entry("2026-10-03 09:00:00", json!([8])));
        incoming.insert("c".into(), entry("2026-10-01 09:00:00", json!([7])));
        incoming.insert("d".into(), json!("pas un objet"));
        assert_eq!(store.merge(&incoming).unwrap(), 2);
        let merged = store.load().unwrap();
        assert_eq!(merged["a"]["lines"], json!([1]));
        assert_eq!(merged["b"]["lines"], json!([8]));
        assert_eq!(merged["c"]["lines"], json!([7]));
        assert!(!merged.contains_key("d"));
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn export_valide_et_filtre() {
        let review = json!({ "status": "Anomalie", "comment": "à revoir", "lines": { "0": "ok" }, "updated": "2026-10-02 10:00:00" });
        assert!(valid_review(&review));
        assert!(!valid_review(&json!({ "status": "Payée", "comment": "", "lines": {} })));
        assert!(!valid_review(&json!({ "status": "Anomalie", "comment": 3, "lines": {} })));
        let text = json!({
            "format": EXPORT_FORMAT, "version": 1,
            "pointages": { "a": entry("x", json!([1, 2])), "b": { "lines": ["non"] } },
            "suivi": { "a": review, "b": { "status": "?" } },
        })
        .to_string();
        let (p, s) = parse_export(&text).unwrap();
        assert_eq!(p.keys().collect::<Vec<_>>(), ["a"]);
        assert_eq!(s.keys().collect::<Vec<_>>(), ["a"]);
        assert!(parse_export("{\"format\":\"autre\"}").unwrap_err().contains("n'est pas une sauvegarde"));
        assert!(parse_export("pas du json").is_err());
    }
}
