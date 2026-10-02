//! Analyse toutes les factures de `samples/` (factures reelles, non versionnees).
//! Sans ce dossier, le test est sans effet.
//!
//! Convention : un fichier dont le nom contient "PAS DE XML" doit etre rejete.

use facturx_reader_lib::facturx::parse_file;

#[test]
fn factures_d_exemple() {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../samples");
    let Ok(entries) = std::fs::read_dir(&dir) else {
        eprintln!("samples/ absent : test ignore");
        return;
    };
    let mut count = 0;
    for path in entries.filter_map(|e| e.ok().map(|e| e.path())).filter(|p| p.is_file()) {
        let name = path.file_name().unwrap().to_string_lossy().into_owned();
        let data = std::fs::read(&path).unwrap();
        let result = parse_file(&name, &data);
        if name.contains("PAS DE XML") {
            assert!(result.is_err(), "{name} : devrait etre rejete");
            continue;
        }
        let r = result.unwrap_or_else(|e| panic!("{name} : {e}"));
        assert!(matches!(r["format"].as_str(), Some("UBL" | "CII")), "{name} : format inattendu");
        assert!(!r["lines"].as_array().unwrap().is_empty(), "{name} : aucune ligne");
        assert!(!r["summary"].as_array().unwrap().is_empty(), "{name} : synthese vide");
        assert_eq!(r["doc_hash"].as_str().unwrap().len(), 64, "{name}");
        if name.to_lowercase().ends_with(".pdf") {
            assert_eq!(r["pdf"]["size"], data.len(), "{name} : le PDF servi est le fichier d'origine");
            assert_eq!(r["conteneur"]["est_pdf"], true, "{name} : conteneur PDF");
            assert_eq!(r["conteneur"]["piece_jointe_declaree"], true, "{name} : pièce jointe déclarée");
            assert_eq!(r["conteneur"]["est_pdfa"], true, "{name} : métadonnées PDF/A");
        }
        count += 1;
    }
    eprintln!("{count} factures d'exemple analysees");
}
