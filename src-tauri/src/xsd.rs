//! Validation du schema XSD des factures CII et UBL.
//!
//! CII : le schema applique depend du profil annonce par la facture (BT-24) : pour les cinq profils
//! Factur-X, le schema publie par FNFE-MPE et FeRD pour ce profil (Factur-X 1.09.2, licence
//! Apache 2.0) ; pour tout autre CII, le schema UN/CEFACT complet du Cross Industry Invoice
//! D22B, sur lequel Factur-X repose et qui accepte toute facture D16B. Ces schemas sont
//! embarques sans modification (`src-tauri/xsd/`) et appliques par le validateur XSD `uppsala`
//! (BSD-2-Clause), en Rust, sur le poste. Le validateur lit les schemas importes sur le disque :
//! ils sont ecrits dans un dossier temporaire, le temps de les charger. La validation prend
//! environ une milliseconde : elle est faite a l'analyse de la facture.
//!
//! UBL : schemas OASIS UBL 2.1 de la facture (`Invoice`) et de l'avoir (`CreditNote`), dans
//! leur forme d'execution (`xsdrt`), embarques sans modification. Ils importent leurs modules
//! communs par `../common/`, chemin que le validateur refuse de suivre : au chargement, le
//! schema principal est copie a cote des modules communs, ses imports pointant alors sur le
//! meme dossier.

use std::sync::OnceLock;

use include_dir::{include_dir, Dir};
use serde_json::{json, Value};
use uppsala::XsdValidator;

static SCHEMAS: Dir = include_dir!("$CARGO_MANIFEST_DIR/xsd");
/// Au-dela, les erreurs ne sont plus listees ; leur nombre reste exact.
const MAX_ERRORS: usize = 200;

struct Schema {
    label: &'static str,
    root: &'static str,
    /// Schema principal a copier dans ce dossier, celui de ses modules communs, avant chargement.
    flatten_into: Option<&'static str>,
}

const SCHEMA_COUNT: usize = 8;
const D22B: usize = 5;
const UBL_INVOICE: usize = 6;
const UBL_CREDIT_NOTE: usize = 7;
const SCHEMA_LIST: [Schema; SCHEMA_COUNT] = [
    Schema { label: "Factur-X 1.09.2, profil MINIMUM", root: "factur-x/minimum/Factur-X_1.09.2_MINIMUM.xsd", flatten_into: None },
    Schema { label: "Factur-X 1.09.2, profil BASIC WL", root: "factur-x/basicwl/Factur-X_1.09.2_BASICWL.xsd", flatten_into: None },
    Schema { label: "Factur-X 1.09.2, profil BASIC", root: "factur-x/basic/Factur-X_1.09.2_BASIC.xsd", flatten_into: None },
    Schema { label: "Factur-X 1.09.2, profil EN 16931", root: "factur-x/en16931/Factur-X_1.09.2_EN16931.xsd", flatten_into: None },
    Schema { label: "Factur-X 1.09.2, profil EXTENDED", root: "factur-x/extended/Factur-X_1.09.2_EXTENDED.xsd", flatten_into: None },
    Schema { label: "UN/CEFACT Cross Industry Invoice D22B", root: "cii-d22b/CrossIndustryInvoice_100pD22B.xsd", flatten_into: None },
    Schema { label: "OASIS UBL 2.1, facture (Invoice)", root: "ubl-2.1/maindoc/UBL-Invoice-2.1.xsd", flatten_into: Some("ubl-2.1/common") },
    Schema { label: "OASIS UBL 2.1, avoir (CreditNote)", root: "ubl-2.1/maindoc/UBL-CreditNote-2.1.xsd", flatten_into: Some("ubl-2.1/common") },
];

/// Schema a appliquer d'apres le profil annonce (BT-24). Un profil inconnu, une extension
/// nationale (EXTENDED-CTC-FR, XRechnung) ou l'absence de profil : schema D22B complet.
fn schema_for(profile: &str) -> usize {
    match profile.trim().to_ascii_lowercase().as_str() {
        "urn:factur-x.eu:1p0:minimum" => 0,
        "urn:factur-x.eu:1p0:basicwl" => 1,
        "urn:cen.eu:en16931:2017#compliant#urn:factur-x.eu:1p0:basic" => 2,
        "urn:cen.eu:en16931:2017" => 3,
        "urn:cen.eu:en16931:2017#conformant#urn:factur-x.eu:1p0:extended" => 4,
        _ => D22B,
    }
}

/// Profil annonce par la facture : `GuidelineSpecifiedDocumentContextParameter/ID`.
pub(crate) fn profile(xml: &str) -> String {
    roxmltree::Document::parse(xml.trim_start_matches('\u{feff}'))
        .ok()
        .and_then(|doc| {
            doc.descendants()
                .find(|n| n.tag_name().name() == "GuidelineSpecifiedDocumentContextParameter")?
                .children()
                .find(|n| n.tag_name().name() == "ID")
                .and_then(|n| n.text().map(|t| t.trim().to_string()))
        })
        .unwrap_or_default()
}

fn not_evaluated(reason: &str) -> Value {
    json!({ "evalue": false, "ok": false, "total": 0, "erreurs": [], "raison": reason })
}

fn validator(index: usize) -> Result<&'static XsdValidator, String> {
    static VALIDATORS: [OnceLock<Result<XsdValidator, String>>; SCHEMA_COUNT] = [const { OnceLock::new() }; SCHEMA_COUNT];
    VALIDATORS[index]
        .get_or_init(|| {
            // Dossier propre au processus et au schema : les schemas lus sont ceux de l'executable.
            let dir = std::env::temp_dir().join(format!("facturx-reader-xsd-{}-{index}", std::process::id()));
            std::fs::create_dir_all(&dir).and_then(|_| SCHEMAS.extract(&dir)).map_err(|e| format!("Schémas XSD non écrits : {e}"))?;
            let schema = &SCHEMA_LIST[index];
            let mut root = dir.join(schema.root);
            let mut source = std::fs::read_to_string(&root).map_err(|e| e.to_string());
            if let (Some(common), Ok(text)) = (schema.flatten_into, &source) {
                let flat = text.replace("schemaLocation=\"../common/", "schemaLocation=\"");
                root = dir.join(common).join(root.file_name().unwrap_or_default());
                source = std::fs::write(&root, &flat).map(|_| flat).map_err(|e| e.to_string());
            }
            let built = source
                .and_then(|source| {
                    let doc = uppsala::parse(&source).map_err(|e| e.to_string())?;
                    XsdValidator::from_schema_with_base_path(&doc, root.parent()).map_err(|e| e.to_string())
                })
                .map_err(|e| format!("Schémas XSD illisibles : {e}"));
            let _ = std::fs::remove_dir_all(&dir);
            built
        })
        .as_ref()
        .map_err(Clone::clone)
}

/// `12.` est un decimal XSD valide (partie fractionnaire vide) que le validateur refuse a tort.
fn decimal_false_positive(message: &str) -> bool {
    message
        .strip_suffix("' is not a valid decimal")
        .and_then(|m| m.strip_prefix('\''))
        .and_then(|v| v.trim().strip_suffix('.'))
        // Un seul signe est permis : « ++12. » reste une erreur XSD.
        .map(|v| v.strip_prefix('+').or_else(|| v.strip_prefix('-')).unwrap_or(v))
        .is_some_and(|digits| !digits.is_empty() && digits.bytes().all(|b| b.is_ascii_digit()))
}

/// Nom local de l'element racine.
fn root_name(xml: &str) -> String {
    roxmltree::Document::parse(xml.trim_start_matches('\u{feff}'))
        .map(|doc| doc.root_element().tag_name().name().to_string())
        .unwrap_or_default()
}

/// Valide le XML d'une facture contre le schema XSD de son format.
pub fn validate(xml: &str, format: &str) -> Value {
    let (index, profile) = match format {
        "CII" => {
            let profile = profile(xml);
            (schema_for(&profile), profile)
        }
        "UBL" => match root_name(xml).as_str() {
            "Invoice" => (UBL_INVOICE, String::new()),
            "CreditNote" => (UBL_CREDIT_NOTE, String::new()),
            _ => return not_evaluated("Document UBL sans schéma XSD embarqué"),
        },
        _ => return not_evaluated("Format sans schéma XSD"),
    };
    let validator = match validator(index) {
        Ok(v) => v,
        Err(e) => return not_evaluated(&e),
    };
    let doc = match uppsala::parse(xml.trim_start_matches('\u{feff}')) {
        Ok(d) => d,
        Err(e) => return not_evaluated(&format!("XML illisible par le validateur XSD : {e}")),
    };
    let errors: Vec<_> = validator.validate(&doc).into_iter().filter(|e| !decimal_false_positive(&e.message)).collect();
    json!({
        "evalue": true,
        "ok": errors.is_empty(),
        "schema": SCHEMA_LIST[index].label,
        "profil": profile,
        "total": errors.len(),
        "erreurs": errors
            .iter()
            .take(MAX_ERRORS)
            .map(|e| json!({ "message": e.message, "ligne": e.line, "colonne": e.column }))
            .collect::<Vec<_>>(),
    })
}

/// Valide le XML d'origine d'une facture. Les erreurs sont listees avec leur ligne dans la
/// version reindentee, celle que l'application affiche, quand elle donne les memes erreurs.
/// Si le validateur ne lit pas le XML d'origine, la version reindentee est validee a sa place.
pub fn validate_invoice(source: &str, pretty: &str, format: &str) -> Value {
    let mut report = validate(source, format);
    if report["evalue"] != true {
        let mut fallback = validate(pretty, format);
        if fallback["evalue"] == true {
            fallback["valide_sur"] = "reindente".into();
            return fallback;
        }
        return report;
    }
    report["valide_sur"] = "origine".into();
    if report["ok"] == false {
        let displayed = validate(pretty, format);
        let messages = |r: &Value| r["erreurs"].as_array().map(|l| l.iter().map(|e| e["message"].clone()).collect::<Vec<_>>());
        if displayed["total"] == report["total"] && messages(&displayed) == messages(&report) {
            report["erreurs"] = displayed["erreurs"].clone();
        } else {
            // Les lignes sont alors celles du fichier d'origine, pas de la vue « XML brut ».
            report["lignes_origine"] = true.into();
        }
    }
    report
}

#[cfg(test)]
mod tests {
    use super::*;

    const CII_OFFICIEL: &str = include_str!("../schematron/exemples/CII_example3.xml");
    const UBL: &str = include_str!("../schematron/exemples/ubl-tc434-example3.xml");

    fn messages(report: &Value) -> String {
        report["erreurs"].as_array().unwrap().iter().map(|e| e["message"].as_str().unwrap()).collect::<Vec<_>>().join(" | ")
    }

    #[test]
    fn exemple_officiel_cii_valide() {
        let report = validate(CII_OFFICIEL, "CII");
        assert_eq!(report["evalue"], true, "{report}");
        assert_eq!(report["ok"], true, "{}", messages(&report));
    }

    #[test]
    fn ubl_types_simples_herites_verifies() {
        // Écart découvert par comparaison à libxml2 : uppsala 0.10.1 acceptait ces
        // valeurs car cbc:AmountType dérive du type complexe udt:AmountType.
        for (before, after) in [
            (">2005.00</cbc:TaxInclusiveAmount>", ">pas-un-montant</cbc:TaxInclusiveAmount>"),
            (">2</cbc:InvoicedQuantity>", ">pas-une-quantite</cbc:InvoicedQuantity>"),
            (">25</cbc:Percent>", ">pas-un-taux</cbc:Percent>"),
            (">2013-04-10</cbc:IssueDate>", ">2026-02-30</cbc:IssueDate>"),
        ] {
            let invalid = UBL.replacen(before, after, 1);
            assert_ne!(invalid, UBL);
            let report = validate(&invalid, "UBL");
            assert_eq!(report["evalue"], true, "{report}");
            assert_eq!(report["ok"], false, "{report}");
            assert!(report["total"].as_u64().unwrap() > 0, "{report}");
        }
        // Un enfant XML ne peut pas remplacer la valeur d'un contenu simple.
        let child = UBL.replacen(">2005.00</cbc:TaxInclusiveAmount>", "><cbc:ID>2005.00</cbc:ID></cbc:TaxInclusiveAmount>", 1);
        assert_eq!(validate(&child, "UBL")["ok"], false);
        // Les attributs hérités restent obligatoires après la correction du type.
        let missing_currency = UBL.replacen("<cbc:TaxInclusiveAmount currencyID=\"DKK\">", "<cbc:TaxInclusiveAmount>", 1);
        assert_eq!(validate(&missing_currency, "UBL")["ok"], false);
        assert_eq!(validate(UBL, "UBL")["ok"], true);
    }

    #[test]
    fn element_inconnu_mal_place_ou_attribut_inconnu() {
        let unknown = CII_OFFICIEL.replacen("</ram:TypeCode>", "</ram:TypeCode><ram:Inconnu>x</ram:Inconnu>", 1);
        assert_ne!(unknown, CII_OFFICIEL);
        let report = validate(&unknown, "CII");
        assert_eq!(report["ok"], false);
        assert!(messages(&report).contains("Inconnu"), "{}", messages(&report));
        assert!(report["erreurs"][0]["ligne"].as_u64().is_some());

        let attribute = CII_OFFICIEL.replacen("<udt:DateTimeString ", "<udt:DateTimeString bidule=\"1\" ", 1);
        assert_ne!(attribute, CII_OFFICIEL);
        assert!(messages(&validate(&attribute, "CII")).contains("bidule"));

        let amount = CII_OFFICIEL.replacen("<ram:LineTotalAmount>", "<ram:LineTotalAmount>abc", 1);
        assert_ne!(amount, CII_OFFICIEL);
        assert_eq!(validate(&amount, "CII")["ok"], false);
    }

    #[test]
    fn schema_choisi_d_apres_le_profil() {
        // L'exemple officiel est au profil EN 16931.
        let report = validate(CII_OFFICIEL, "CII");
        assert_eq!(report["profil"], "urn:cen.eu:en16931:2017");
        assert_eq!(report["schema"], "Factur-X 1.09.2, profil EN 16931");

        // La meme facture annoncee MINIMUM : ses lignes n'ont pas leur place dans ce profil.
        let minimum = CII_OFFICIEL.replacen(">urn:cen.eu:en16931:2017<", ">urn:factur-x.eu:1p0:minimum<", 1);
        assert_ne!(minimum, CII_OFFICIEL);
        let report = validate(&minimum, "CII");
        assert_eq!(report["schema"], "Factur-X 1.09.2, profil MINIMUM");
        assert_eq!(report["ok"], false);
        assert!(messages(&report).contains("IncludedSupplyChainTradeLineItem"), "{}", messages(&report));

        // Annoncee EXTENDED ou sous une extension nationale : toujours valide, schema plus large.
        for (id, schema) in [
            ("urn:cen.eu:en16931:2017#conformant#urn:factur-x.eu:1p0:extended", "Factur-X 1.09.2, profil EXTENDED"),
            ("urn:cen.eu:en16931:2017#conformant#urn.cpro.gouv.fr:1p0:extended-ctc-fr", "UN/CEFACT Cross Industry Invoice D22B"),
        ] {
            let report = validate(&CII_OFFICIEL.replacen(">urn:cen.eu:en16931:2017<", &format!(">{id}<"), 1), "CII");
            assert_eq!(report["schema"], schema);
            assert_eq!(report["ok"], true, "{}", messages(&report));
        }
    }

    #[test]
    fn tous_les_schemas_embarques_se_chargent() {
        for index in 0..SCHEMA_COUNT {
            assert!(validator(index).is_ok(), "{} : {:?}", SCHEMA_LIST[index].label, validator(index).err());
        }
        assert_eq!(schema_for(" urn:factur-x.eu:1p0:basicwl "), 1);
        assert_eq!(schema_for("urn:cen.eu:en16931:2017#compliant#urn:factur-x.eu:1p0:basic"), 2);
        assert_eq!(schema_for(""), D22B);
    }

    #[test]
    fn xml_d_origine_valide_lignes_de_la_vue_affichee() {
        // Version affichee abimee (bloc binaire abrege, par exemple) : seul l'original compte.
        let displayed = CII_OFFICIEL.replacen("</ram:TypeCode>", "</ram:TypeCode><ram:Inconnu>x</ram:Inconnu>", 1);
        let report = validate_invoice(CII_OFFICIEL, &displayed, "CII");
        assert_eq!(report["ok"], true);
        assert_eq!(report["valide_sur"], "origine");

        // Original en erreur, sur une seule ligne : les lignes listees sont celles de la vue affichee.
        let flat = displayed.replace('\n', " ");
        let report = validate_invoice(&flat, &displayed, "CII");
        assert_eq!(report["ok"], false);
        assert!(report["lignes_origine"].is_null());
        assert!(report["erreurs"][0]["ligne"].as_u64().unwrap() > 1, "{report}");

        // Erreurs differentes entre l'original et la vue affichee : celles de l'original, signalees comme telles.
        let report = validate_invoice(&flat, CII_OFFICIEL, "CII");
        assert_eq!(report["ok"], false);
        assert_eq!(report["lignes_origine"], true);

        // Original illisible par le validateur : la vue affichee est validee, et c'est dit.
        let report = validate_invoice("pas du xml", CII_OFFICIEL, "CII");
        assert_eq!(report["ok"], true);
        assert_eq!(report["valide_sur"], "reindente");
    }

    #[test]
    fn ubl_facture_et_avoir() {
        let report = validate(UBL, "UBL");
        assert_eq!(report["schema"], "OASIS UBL 2.1, facture (Invoice)");
        assert_eq!(report["ok"], true, "{}", messages(&report));

        let unknown = UBL.replacen("<cbc:IssueDate>", "<cbc:Inconnu>x</cbc:Inconnu><cbc:IssueDate>", 1);
        assert_ne!(unknown, UBL);
        let report = validate(&unknown, "UBL");
        assert_eq!(report["ok"], false);
        assert!(messages(&report).contains("Inconnu"), "{}", messages(&report));

        // Un avoir a son propre schema : la facture, renommee en avoir, n'y est pas valide.
        let credit = UBL.replace("Invoice-2\"", "CreditNote-2\"").replace("<Invoice ", "<CreditNote ").replace("</Invoice>", "</CreditNote>");
        let report = validate(&credit, "UBL");
        assert_eq!(report["schema"], "OASIS UBL 2.1, avoir (CreditNote)");
        assert_eq!(report["ok"], false);
    }

    #[test]
    fn decimal_sans_partie_fractionnaire_accepte() {
        assert!(decimal_false_positive("'100.' is not a valid decimal"));
        assert!(decimal_false_positive("'-64.' is not a valid decimal"));
        assert!(!decimal_false_positive("'.' is not a valid decimal"));
        assert!(!decimal_false_positive("'1e3' is not a valid decimal"));
        assert!(!decimal_false_positive("'12.5x' is not a valid decimal"));
        assert!(!decimal_false_positive("'++12.' is not a valid decimal"));
        assert!(!decimal_false_positive("'--12.' is not a valid decimal"));
    }

    #[test]
    fn jamais_valide_sans_evaluation() {
        for report in [validate("<Order/>", "UBL"), validate(CII_OFFICIEL, "PDF"), validate("pas du xml", "CII"), validate("pas du xml", "UBL")] {
            assert_eq!(report["evalue"], false, "{report}");
            assert_eq!(report["ok"], false);
        }
        // Une facture UBL soumise au schema CII n'est pas valide.
        assert_eq!(validate(UBL, "CII")["ok"], false);
    }
}
