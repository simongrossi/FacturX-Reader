//! Pointages de lignes, persistes dans `pointages.json` (cle = empreinte du XML).

use std::collections::BTreeSet;
use std::path::PathBuf;
use std::sync::Mutex;

use serde_json::{json, Map, Value};
use tauri::State;

pub struct Store {
    path: PathBuf,
    lock: Mutex<()>,
}

/// Mode portable : un `pointages.json` pose a cote de l'executable est prioritaire ;
/// sinon le dossier de donnees de l'application.
pub fn resolve_path(app_data_dir: Option<PathBuf>) -> PathBuf {
    let portable = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|d| d.join("pointages.json")));
    if let Some(p) = &portable {
        if p.is_file() {
            return p.clone();
        }
    }
    app_data_dir
        .map(|d| d.join("pointages.json"))
        .or(portable)
        .unwrap_or_else(|| PathBuf::from("pointages.json"))
}

impl Store {
    pub fn new(path: PathBuf) -> Self {
        Store { path, lock: Mutex::new(()) }
    }

    pub fn path(&self) -> &std::path::Path {
        &self.path
    }

    fn load(&self) -> Map<String, Value> {
        std::fs::read_to_string(&self.path)
            .ok()
            .and_then(|s| serde_json::from_str::<Value>(&s).ok())
            .and_then(|v| match v {
                Value::Object(m) => Some(m),
                _ => None,
            })
            .unwrap_or_default()
    }

    fn save(&self, data: &Map<String, Value>) -> Result<(), String> {
        if let Some(dir) = self.path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        let tmp = self.path.with_extension("json.tmp");
        let body = serde_json::to_string_pretty(data).map_err(|e| e.to_string())?;
        std::fs::write(&tmp, body).map_err(|e| e.to_string())?;
        std::fs::rename(&tmp, &self.path).map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn get_pointage(store: State<'_, Store>, hash: String) -> Value {
    let _guard = store.lock.lock().unwrap_or_else(|e| e.into_inner());
    let lines = store
        .load()
        .get(hash.trim())
        .and_then(|e| e.get("lines"))
        .cloned()
        .unwrap_or_else(|| json!([]));
    json!({ "hash": hash.trim(), "lines": lines })
}

#[tauri::command]
pub fn set_pointage(
    store: State<'_, Store>,
    hash: String,
    lines: Vec<i64>,
    filename: Option<String>,
) -> Result<Value, String> {
    let hash = hash.trim().to_string();
    if hash.is_empty() {
        return Err("Champ 'hash' manquant.".into());
    }
    let lines: Vec<i64> = lines.into_iter().collect::<BTreeSet<_>>().into_iter().collect();
    let _guard = store.lock.lock().unwrap_or_else(|e| e.into_inner());
    let mut data = store.load();
    if lines.is_empty() {
        data.shift_remove(&hash);
    } else {
        data.insert(
            hash.clone(),
            json!({
                "filename": filename.unwrap_or_default(),
                "updated": chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
                "lines": lines,
            }),
        );
    }
    store.save(&data)?;
    Ok(json!({ "ok": true, "hash": hash, "lines": lines }))
}

#[tauri::command]
pub fn clear_pointage(store: State<'_, Store>, hash: String) -> Result<Value, String> {
    let hash = hash.trim().to_string();
    let _guard = store.lock.lock().unwrap_or_else(|e| e.into_inner());
    let mut data = store.load();
    data.shift_remove(&hash);
    store.save(&data)?;
    Ok(json!({ "ok": true, "hash": hash, "lines": [] }))
}
