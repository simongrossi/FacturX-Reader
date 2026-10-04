//! Factur-X Reader — coquille Tauri : commandes exposees au front (`web/`).

mod bibliotheque;
pub mod facturx;
mod pointages;
mod schematron;
mod xsd;
mod tables;

#[cfg(feature = "reference-validation")]
pub mod reference_validation {
    /// Évalue les XML d'origine avec les mêmes validateurs que l'application, sans cache disque.
    pub fn validate(inputs: &[(String, String)]) -> Vec<serde_json::Value> {
        let validator = crate::schematron::Validator::new();
        inputs.iter().map(|(xml, format)| serde_json::json!({
            "schematron": validator.validate(xml.clone(), format, false, None),
            "xsd": crate::xsd::validate(xml, format),
        })).collect()
    }
}

use std::path::{Path, PathBuf};

use base64::Engine;
use serde_json::{json, Value};
use tauri::ipc::{InvokeBody, Request};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

const MAX_FILE_SIZE: usize = 200 * 1024 * 1024;
/// Extensions retenues lors du parcours d'un dossier.
const INVOICE_EXTENSIONS: [&str; 3] = ["pdf", "xml", "zip"];
/// Garde-fou : nombre maximal de fichiers charges depuis un dossier.
const MAX_FOLDER_FILES: usize = 500;

/// Fichiers factures d'un dossier (recursif, tries, dossiers caches ignores).
fn collect_invoice_files(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    let mut entries: Vec<PathBuf> = entries.filter_map(|e| e.ok().map(|e| e.path())).collect();
    entries.sort_by_key(|p| p.file_name().map(|n| n.to_string_lossy().to_lowercase()));
    for path in entries {
        if out.len() > MAX_FOLDER_FILES {
            return;
        }
        let hidden = path.file_name().is_some_and(|n| n.to_string_lossy().starts_with('.'));
        if hidden {
            continue;
        }
        if path.is_dir() {
            collect_invoice_files(&path, out);
        } else if path
            .extension()
            .is_some_and(|e| INVOICE_EXTENSIONS.contains(&e.to_string_lossy().to_lowercase().as_str()))
        {
            out.push(path);
        }
    }
}

/// Developpe une liste de chemins (fichiers et dossiers) en fichiers a analyser.
fn expand_paths(paths: impl IntoIterator<Item = PathBuf>) -> Value {
    let mut files = Vec::new();
    for path in paths {
        if path.is_dir() {
            collect_invoice_files(&path, &mut files);
        } else if path.is_file() {
            files.push(path);
        }
    }
    let truncated = files.len() > MAX_FOLDER_FILES;
    files.truncate(MAX_FOLDER_FILES);
    let files: Vec<String> = files.iter().map(|p| p.to_string_lossy().into_owned()).collect();
    json!({ "files": files, "truncated": truncated, "max": MAX_FOLDER_FILES })
}

fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            let hex = std::str::from_utf8(&b[i + 1..i + 3]).ok();
            if let Some(v) = hex.and_then(|h| u8::from_str_radix(h, 16).ok()) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Analyse un fichier depose : corps = octets bruts, en-tete `x-filename` = nom.
#[tauri::command]
fn parse_file(request: Request<'_>, library: tauri::State<'_, bibliotheque::Library>) -> Result<Value, String> {
    let InvokeBody::Raw(data) = request.body() else {
        return Err("Fichier vide.".into());
    };
    if data.is_empty() {
        return Err("Fichier vide.".into());
    }
    if data.len() > MAX_FILE_SIZE {
        return Err("Fichier trop volumineux (max 200 Mo).".into());
    }
    let name = request
        .headers()
        .get("x-filename")
        .and_then(|v| v.to_str().ok())
        .map(percent_decode)
        .unwrap_or_else(|| "fichier".into());
    let selection: Option<facturx::ArchiveSelection> = request.headers().get("x-archive-selection")
        .and_then(|v| v.to_str().ok()).map(serde_json::from_str).transpose().map_err(|e| format!("Sélection invalide : {e}"))?;
    let mut result = facturx::parse_file_selected(&name, data, selection.as_ref()).map_err(|e| e.to_string())?;
    // En-tete `x-library: 0` : l'utilisateur a desactive la bibliotheque.
    if request.headers().get("x-library").and_then(|v| v.to_str().ok()) != Some("0") {
        bibliotheque::annotate(&library, &mut result, None);
    }
    Ok(result)
}

/// Fichiers et dossiers passes en arguments de la ligne de commande (ou « Ouvrir avec »).
#[tauri::command]
fn startup_paths() -> Value {
    expand_paths(std::env::args_os().skip(1).map(PathBuf::from))
}

/// Boite de selection de dossier native ; retourne les fichiers factures qu'il contient.
#[tauri::command]
async fn pick_folder(app: tauri::AppHandle) -> Result<Value, String> {
    let Some(folder) = app.dialog().file().blocking_pick_folder() else {
        return Ok(Value::Null);
    };
    let folder = folder.into_path().map_err(|e| e.to_string())?;
    let mut result = expand_paths([folder.clone()]);
    result["folder"] = folder.to_string_lossy().into();
    Ok(result)
}

/// Analyse un fichier designe par son chemin sur le disque.
#[tauri::command]
async fn parse_path(path: String, library: Option<bool>, selection: Option<facturx::ArchiveSelection>, store: tauri::State<'_, bibliotheque::Library>) -> Result<Value, String> {
    let path = PathBuf::from(path);
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let size = std::fs::metadata(&path).map_err(|e| format!("Lecture impossible : {e}"))?.len();
    if size > MAX_FILE_SIZE as u64 {
        return Err("Fichier trop volumineux (max 200 Mo).".into());
    }
    let data = std::fs::read(&path).map_err(|e| format!("Lecture impossible : {e}"))?;
    let mut result = facturx::parse_file_selected(&name, &data, selection.as_ref()).map_err(|e| e.to_string())?;
    if library != Some(false) {
        bibliotheque::annotate(&store, &mut result, Some(&path.to_string_lossy()));
    }
    Ok(result)
}

/// Boite « Enregistrer sous » native puis ecriture du PDF. Retourne false si annule.
#[tauri::command]
async fn save_pdf(app: tauri::AppHandle, filename: String, base64: String) -> Result<bool, String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64.as_bytes())
        .map_err(|e| format!("PDF invalide : {e}"))?;
    let Some(dest) = app
        .dialog()
        .file()
        .set_file_name(filename)
        .add_filter("PDF", &["pdf"])
        .blocking_save_file()
    else {
        return Ok(false);
    };
    let path = dest.into_path().map_err(|e| e.to_string())?;
    std::fs::write(&path, bytes).map_err(|e| format!("Ecriture impossible : {e}"))?;
    Ok(true)
}

/// Boite « Enregistrer sous » native puis ecriture d'un fichier texte (export CSV).
/// Retourne false si annule.
#[tauri::command]
async fn save_text(app: tauri::AppHandle, filename: String, content: String) -> Result<bool, String> {
    let extension = Path::new(&filename)
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_else(|| "txt".into());
    let Some(dest) = app
        .dialog()
        .file()
        .set_file_name(&filename)
        .add_filter(extension.to_uppercase(), &[extension.as_str()])
        .blocking_save_file()
    else {
        return Ok(false);
    };
    let path = dest.into_path().map_err(|e| e.to_string())?;
    std::fs::write(&path, content).map_err(|e| format!("Ecriture impossible : {e}"))?;
    Ok(true)
}

/// Export binaire généré localement : seuls XLSX et PDF sont proposés.
#[tauri::command]
async fn save_binary(app: tauri::AppHandle, filename: String, base64: String) -> Result<bool, String> {
    let extension = Path::new(&filename).extension().and_then(|v| v.to_str()).unwrap_or("");
    if !["xlsx", "pdf"].contains(&extension) { return Err("Format d’export non autorisé.".into()); }
    if base64.len() > 140 * 1024 * 1024 { return Err("Export trop volumineux (max 100 Mo).".into()); }
    let bytes = base64::engine::general_purpose::STANDARD.decode(base64.as_bytes()).map_err(|e| format!("Export invalide : {e}"))?;
    if bytes.len() > 100 * 1024 * 1024 { return Err("Export trop volumineux (max 100 Mo).".into()); }
    let Some(dest) = app.dialog().file().set_file_name(&filename).add_filter(extension.to_uppercase(), &[extension]).blocking_save_file() else { return Ok(false); };
    std::fs::write(dest.into_path().map_err(|e| e.to_string())?, bytes).map_err(|e| format!("Écriture impossible : {e}"))?;
    Ok(true)
}

/// Rapport JSON enregistré par la boîte native « Enregistrer sous ».
#[tauri::command]
async fn save_control_report(app: tauri::AppHandle, filename: String, report: Value) -> Result<bool, String> {
    let bytes = serde_json::to_vec_pretty(&report).map_err(|e| format!("Rapport invalide : {e}"))?;
    if bytes.len() > 20 * 1024 * 1024 {
        return Err("Rapport trop volumineux (max 20 Mo).".into());
    }
    let Some(dest) = app.dialog().file().set_file_name(filename).add_filter("Rapport JSON", &["json"]).blocking_save_file() else {
        return Ok(false);
    };
    let path = dest.into_path().map_err(|e| e.to_string())?;
    std::fs::write(&path, bytes).map_err(|e| format!("Écriture du rapport impossible : {e}"))?;
    Ok(true)
}

/// Ouvre la boîte d'impression du système pour le contenu de la fenêtre.
#[tauri::command]
fn print_window(window: tauri::WebviewWindow) -> Result<(), String> {
    window.print().map_err(|e| format!("Impression impossible : {e}"))
}

/// Informations affichees dans la fenetre Parametres.
#[tauri::command]
fn app_info(app: tauri::AppHandle, store: tauri::State<'_, pointages::Pointages>) -> Value {
    json!({
        "version": app.package_info().version.to_string(),
        "pointages": store.0.path().to_string_lossy(),
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir().ok();
            // FACTURX_DATA_DIR impose le dossier des donnees (tests natifs, profils separes).
            let forced = std::env::var_os("FACTURX_DATA_DIR").map(PathBuf::from);
            let store = |name: &str| {
                pointages::Store::new(match &forced {
                    Some(dir) => dir.join(name),
                    None => pointages::resolve_path(data_dir.clone(), name),
                })
            };
            app.manage(pointages::Pointages(store("pointages.json")));
            app.manage(pointages::Suivi(store("suivi.json")));
            let library = match &forced {
                Some(dir) => dir.join("bibliotheque.sqlite"),
                None => data_dir.clone().unwrap_or_default().join("bibliotheque.sqlite"),
            };
            app.manage(bibliotheque::Library::new(library));
            app.manage(std::sync::Arc::new(schematron::Validator::new()));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            parse_file,
            startup_paths,
            pick_folder,
            parse_path,
            save_pdf,
            save_text,
            save_binary,
            save_control_report,
            print_window,
            schematron::validate_schematron,
            app_info,
            pointages::get_pointage,
            pointages::set_pointage,
            pointages::clear_pointage,
            pointages::get_reviews,
            pointages::set_review,
            pointages::data_status,
            pointages::restore_backup,
            pointages::export_data,
            pointages::import_data,
            bibliotheque::library_status,
            bibliotheque::library_search,
            bibliotheque::library_open,
            bibliotheque::library_relink,
            bibliotheque::library_remove,
            bibliotheque::library_clear,
            bibliotheque::library_reset,
            bibliotheque::library_prices,
        ])
        .run(tauri::generate_context!())
        .expect("erreur au lancement de Factur-X Reader");
}

#[cfg(test)]
mod tests {
    use super::{collect_invoice_files, expand_paths, percent_decode, MAX_FOLDER_FILES};

    #[test]
    fn dossier_volumineux_limite() {
        let root = std::env::temp_dir().join(format!("fx-reader-large-test-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        for i in 0..MAX_FOLDER_FILES + 5 {
            std::fs::write(root.join(format!("invoice-{i:04}.xml")), b"<Invoice/>").unwrap();
        }
        let listing = expand_paths([root.clone()]);
        std::fs::remove_dir_all(&root).unwrap();
        assert_eq!(listing["files"].as_array().unwrap().len(), MAX_FOLDER_FILES);
        assert_eq!(listing["truncated"], true);
    }

    #[test]
    fn parcours_de_dossier() {
        let root = std::env::temp_dir().join(format!("fx-reader-test-{}", std::process::id()));
        let sub = root.join("2026").join("sept");
        std::fs::create_dir_all(&sub).unwrap();
        std::fs::create_dir_all(root.join(".cache")).unwrap();
        for f in ["b.PDF", "a.xml", "notes.txt", ".cache/x.pdf", "2026/sept/c.zip"] {
            std::fs::write(root.join(f), b"x").unwrap();
        }
        let mut files = Vec::new();
        collect_invoice_files(&root, &mut files);
        let names: Vec<String> =
            files.iter().map(|p| p.file_name().unwrap().to_string_lossy().into_owned()).collect();
        std::fs::remove_dir_all(&root).unwrap();
        assert_eq!(names, ["c.zip", "a.xml", "b.PDF"]);
    }

    #[test]
    fn decode_nom_de_fichier() {
        assert_eq!(percent_decode("KM%20BG%20facture%C3%A9.pdf"), "KM BG factureé.pdf");
        assert_eq!(percent_decode("100%"), "100%");
        assert_eq!(percent_decode("a%2"), "a%2");
    }
}
