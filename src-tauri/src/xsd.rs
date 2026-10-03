//! Validation du schema XSD des factures CII.
//!
//! Le schema applique depend du profil annonce par la facture (BT-24) : pour les cinq profils
//! Factur-X, le schema publie par FNFE-MPE et FeRD pour ce profil (Factur-X 1.09.2, licence
//! Apache 2.0) ; pour tout autre CII, le schema UN/CEFACT complet du Cross Industry Invoice
//! D22B, sur lequel Factur-X repose et qui accepte toute facture D16B. Ces schemas sont
//! embarques sans modification (`src-tauri/xsd/`) et appliques par le validateur XSD `uppsala`
//! (BSD-2-Clause), en Rust, sur le poste. Le validateur lit les schemas importes sur le disque :
//! ils sont ecrits dans un dossier temporaire, le temps de les charger. La validation prend
//! environ une milliseconde : elle est faite a l'analyse de la facture.
//!
//! Les schemas UBL 2.1 (OASIS) ne sont pas embarques : une facture UBL est « non evaluee ».

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
}

const SCHEMA_COUNT: usize = 6;
const D22B: usize = 5;
const SCHEMA_LIST: [Schema; SCHEMA_COUNT] = [
    Schema { label: "Factur-X 1.09.2, profil MINIMUM", root: "factur-x/minimum/Factur-X_1.09.2_MINIMUM.xsd" },
    Schema { label: "Factur-X 1.09.2, profil BASIC WL", root: "factur-x/basicwl/Factur-X_1.09.2_BASICWL.xsd" },
    Schema { label: "Factur-X 1.09.2, profil BASIC", root: "factur-x/basic/Factur-X_1.09.2_BASIC.xsd" },
    Schema { label: "Factur-X 1.09.2, profil EN 16931", root: "factur-x/en16931/Factur-X_1.09.2_EN16931.xsd" },
    Schema { label: "Factur-X 1.09.2, profil EXTENDED", root: "factur-x/extended/Factur-X_1.09.2_EXTENDED.xsd" },
    Schema { label: "UN/CEFACT Cross Industry Invoice D22B", root: "cii-d22b/CrossIndustryInvoice_100pD22B.xsd" },
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
            let root = dir.join(SCHEMA_LIST[index].root);
            let built = std::fs::read_to_string(&root)
                .map_err(|e| e.to_string())
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
        .map(|v| v.trim_start_matches(['+', '-']))
        .is_some_and(|digits| !digits.is_empty() && digits.bytes().all(|b| b.is_ascii_digit()))
}

/// Valide le XML d'une facture contre le schema XSD de son format.
pub fn validate(xml: &str, format: &str) -> Value {
    match format {
        "CII" => {}
        "UBL" => return not_evaluated("Schémas XSD UBL non embarqués"),
        _ => return not_evaluated("Format sans schéma XSD"),
    }
    let profile = profile(xml);
    let index = schema_for(&profile);
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
    fn decimal_sans_partie_fractionnaire_accepte() {
        assert!(decimal_false_positive("'100.' is not a valid decimal"));
        assert!(decimal_false_positive("'-64.' is not a valid decimal"));
        assert!(!decimal_false_positive("'.' is not a valid decimal"));
        assert!(!decimal_false_positive("'1e3' is not a valid decimal"));
        assert!(!decimal_false_positive("'12.5x' is not a valid decimal"));
    }

    #[test]
    fn jamais_valide_sans_evaluation() {
        for report in [validate(UBL, "UBL"), validate(CII_OFFICIEL, "PDF"), validate("pas du xml", "CII")] {
            assert_eq!(report["evalue"], false, "{report}");
            assert_eq!(report["ok"], false);
        }
        // Une facture UBL soumise au schema CII n'est pas valide.
        assert_eq!(validate(UBL, "CII")["ok"], false);
    }
}
