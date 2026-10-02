//! Analyse un fichier et ecrit le JSON du moteur sur la sortie standard.
//!
//!     cargo run --example dump -- facture.pdf > facture.json

use std::io::Write;

fn main() {
    let path = std::env::args().nth(1).expect("usage : dump <fichier>");
    let data = std::fs::read(&path).expect("lecture impossible");
    let name = std::path::Path::new(&path)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    match facturx_reader_lib::facturx::parse_file(&name, &data) {
        Ok(v) => {
            let out = serde_json::to_string(&v).unwrap();
            std::io::stdout().write_all(out.as_bytes()).unwrap();
        }
        Err(e) => {
            eprintln!("ERREUR : {e}");
            std::process::exit(1);
        }
    }
}
