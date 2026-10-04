//! Corpus synthétique versionné : contrat des données qui serviront aux écritures proposées.
use std::fs;
use std::io::{Cursor, Write};
use std::path::PathBuf;

use facturx_reader_lib::facturx::parse_file;
use serde_json::Value;

fn corpus() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../tests/corpus/accounting")
}

fn assert_invoice(actual: &Value, expected: &Value) {
    let name = expected["file"].as_str().unwrap();
    assert_eq!(actual["format"], expected["format"], "{name}");
    assert_eq!(
        actual["xsd"]["ok"], true,
        "{name}: {:?}",
        actual["xsd"]["erreurs"]
    );
    let s = &actual["synthese"];
    for (actual_key, expected_key) in [
        ("numero", "number"),
        ("avoir", "credit"),
        ("devise", "currency"),
        ("ht", "ht"),
        ("tva", "vat"),
        ("ttc", "ttc"),
        ("a_payer", "payable"),
    ] {
        assert_eq!(
            s[actual_key], expected[expected_key],
            "{name}: {actual_key}"
        );
    }
    assert_eq!(
        actual["lines"].as_array().unwrap().len(),
        expected["lines"].as_u64().unwrap() as usize,
        "{name}: lignes"
    );
    assert!(
        actual["controles"]
            .as_array()
            .unwrap()
            .iter()
            .all(|c| c["etat"] != "ecart"),
        "{name}: {:?}",
        actual["controles"]
    );
    for key in ["ht", "ttc", "a_payer"] {
        let proof = &s["provenance"][key];
        assert_eq!(
            proof["value"],
            expected[if key == "a_payer" { "payable" } else { key }],
            "{name}: provenance {key}"
        );
        assert!(
            proof["path"].as_str().is_some_and(|p| !p.is_empty()),
            "{name}: chemin {key}"
        );
    }
    let breakdown = s["provenance_tva_taux"].as_array().unwrap();
    assert_eq!(
        breakdown.len(),
        expected["tax_rates"].as_array().unwrap().len(),
        "{name}: ventilation TVA"
    );
    for (row, rate) in breakdown
        .iter()
        .zip(expected["tax_rates"].as_array().unwrap())
    {
        assert_eq!(&row["rate"], rate, "{name}: taux TVA");
        assert_eq!(row["comparison"]["matches"], true, "{name}: calcul TVA");
        assert!(
            row["inputs"]
                .as_array()
                .unwrap()
                .iter()
                .all(|i| i["path"].as_str().is_some_and(|p| !p.is_empty())),
            "{name}: provenance TVA"
        );
    }
}

#[test]
fn factures_synthetiques_conservent_leurs_donnees_comptables() {
    let root = corpus();
    let expected: Value =
        serde_json::from_slice(&fs::read(root.join("expected.json")).unwrap()).unwrap();
    for case in expected.as_array().unwrap() {
        let name = case["file"].as_str().unwrap();
        let bytes = fs::read(root.join(name)).unwrap();
        let result = parse_file(name, &bytes).unwrap();
        assert_eq!(result["kind"], "xml", "{name}");
        assert_invoice(&result, case);
    }
}

#[test]
fn meme_facture_dans_xml_zip_et_pdf() {
    let xml = fs::read(corpus().join("cii-usd.xml")).unwrap();
    let direct = parse_file("cii-usd.xml", &xml).unwrap();

    let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
    writer
        .start_file("factur-x.xml", zip::write::SimpleFileOptions::default())
        .unwrap();
    writer.write_all(&xml).unwrap();
    let zipped = parse_file("facture.zip", &writer.finish().unwrap().into_inner()).unwrap();
    assert_eq!(zipped["kind"], "zip");

    let mut pdf = lopdf::Document::with_version("1.7");
    let pages = pdf.new_object_id();
    let page = pdf.add_object(lopdf::dictionary! { "Type" => "Page", "Parent" => pages, "MediaBox" => vec![0.into(), 0.into(), 595.into(), 842.into()] });
    pdf.objects.insert(
        pages,
        lopdf::Object::Dictionary(
            lopdf::dictionary! { "Type" => "Pages", "Kids" => vec![page.into()], "Count" => 1 },
        ),
    );
    let embedded = pdf.add_object(lopdf::Stream::new(
        lopdf::dictionary! { "Type" => "EmbeddedFile" },
        xml,
    ));
    let spec = pdf.add_object(lopdf::dictionary! { "Type" => "Filespec", "F" => lopdf::Object::string_literal("factur-x.xml"), "UF" => lopdf::Object::string_literal("factur-x.xml"), "EF" => lopdf::dictionary! { "F" => embedded }, "AFRelationship" => "Data" });
    let catalog = pdf.add_object(
        lopdf::dictionary! { "Type" => "Catalog", "Pages" => pages, "AF" => vec![spec.into()] },
    );
    pdf.trailer.set("Root", catalog);
    let mut bytes = Vec::new();
    pdf.save_to(&mut bytes).unwrap();
    let embedded = parse_file("facture.pdf", &bytes).unwrap();
    assert_eq!(embedded["kind"], "pdf");
    assert_eq!(embedded["conteneur"]["piece_jointe_declaree"], true);
    for result in [&zipped, &embedded] {
        assert_eq!(result["doc_hash"], direct["doc_hash"]);
        assert_eq!(result["synthese"], direct["synthese"]);
        assert_eq!(result["lines"], direct["lines"]);
    }
}

#[test]
fn montant_a_payer_incoherent_reste_un_ecart_visible() {
    let source = fs::read_to_string(corpus().join("ubl-multi-tax.xml")).unwrap();
    let altered = source.replace(">161.50</cbc:PayableAmount>", ">160.50</cbc:PayableAmount>");
    assert_ne!(altered, source);
    let result = parse_file("montant-incoherent.xml", altered.as_bytes()).unwrap();
    assert_eq!(result["xsd"]["ok"], true, "structure XML toujours valide");
    assert_eq!(
        result["synthese"]["a_payer"], "160.50",
        "montant déclaré conservé"
    );
    assert_eq!(
        result["synthese"]["provenance"]["a_payer"]["comparison"]["expected"],
        "161.50"
    );
    assert!(result["controles"]
        .as_array()
        .unwrap()
        .iter()
        .any(
            |c| c["regle"] == "Net à payer = total TTC − acomptes + arrondi"
                && c["etat"] == "ecart"
        ));
}
