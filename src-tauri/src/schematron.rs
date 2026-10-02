//! Schematron officiel EN 16931, evalue sans XSLT.
//!
//! Les regles sont celles publiees par la Commission europeenne (depot
//! ConnectingEurope/eInvoicing-EN16931, licence EUPL 1.2), dans leur forme
//! « pretraitee » : des regles a contexte XPath portant des assertions XPath.
//! Elles sont embarquees telles quelles (`src-tauri/schematron/`) et evaluees
//! une a une par le moteur XPath `xee` (MIT), hors du fil de l'interface.
//!
//! Semantique Schematron appliquee : dans un motif (`pattern`), un noeud n'est
//! traite que par la premiere regle dont le contexte le reconnait.

use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::{mpsc, Arc, Condvar, Mutex, OnceLock};
use std::time::Instant;

use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use xee_xpath::context::StaticContextBuilder;
use xee_xpath::query::{ManyQuery, OneQuery};
use tauri::Manager;
use xee_xpath::{Documents, Item, Queries, Query};

use crate::bibliotheque::Library;

/// Version des regles embarquees.
pub const RULES_VERSION: &str = "1.3.16";
/// Un resultat garde d'une session a l'autre ne vaut que pour la version qui l'a calcule.
const ENGINE_VERSION: &str = env!("CARGO_PKG_VERSION");
const CII_RULES: &str = include_str!("../schematron/EN16931-CII-validation-preprocessed.sch");
const UBL_RULES: &str = include_str!("../schematron/EN16931-UBL-validation-preprocessed.sch");

/// Chemin lisible d'un noeud, calcule seulement pour les assertions en echec.
const PATH_QUERY: &str = "string-join(for $a in ancestor-or-self::* return concat('/', name($a), \
    if (count($a/../*[name() = name($a)]) > 1) then concat('[', count($a/preceding-sibling::*[name() = name($a)]) + 1, ']') else ''), '')";

#[derive(Clone, Copy, PartialEq, Eq, Hash)]
enum Format {
    Cii,
    Ubl,
}

struct Assert {
    id: String,
    fatal: bool,
    test: String,
    text: String,
}

struct Rule {
    context: String,
    asserts: Vec<Assert>,
}

struct Rules {
    namespaces: Vec<(String, String)>,
    patterns: Vec<Vec<Rule>>,
}

fn parse_rules(source: &str) -> Rules {
    let doc = roxmltree::Document::parse(source).expect("regles Schematron embarquees invalides");
    let is = |n: roxmltree::Node, name: &str| n.is_element() && n.tag_name().name() == name;
    let text = |n: roxmltree::Node| -> String {
        let raw: String = n.descendants().filter_map(|d| d.text()).collect();
        raw.split_whitespace().collect::<Vec<_>>().join(" ")
    };
    Rules {
        namespaces: doc
            .descendants()
            .filter(|n| is(*n, "ns"))
            .filter_map(|n| Some((n.attribute("prefix")?.to_string(), n.attribute("uri")?.to_string())))
            .collect(),
        patterns: doc
            .descendants()
            .filter(|n| is(*n, "pattern"))
            .map(|p| {
                p.children()
                    .filter(|n| is(*n, "rule"))
                    .map(|r| Rule {
                        context: r.attribute("context").unwrap_or("").to_string(),
                        asserts: r
                            .children()
                            .filter(|n| is(*n, "assert"))
                            .map(|a| Assert {
                                id: a.attribute("id").unwrap_or("").to_string(),
                                fatal: a.attribute("flag").unwrap_or("fatal") == "fatal",
                                test: a.attribute("test").unwrap_or("").to_string(),
                                text: text(a),
                            })
                            .collect(),
                    })
                    .collect()
            })
            .collect(),
    }
}

fn rules(format: Format) -> &'static Rules {
    static CII: OnceLock<Rules> = OnceLock::new();
    static UBL: OnceLock<Rules> = OnceLock::new();
    match format {
        Format::Cii => CII.get_or_init(|| parse_rules(CII_RULES)),
        Format::Ubl => UBL.get_or_init(|| parse_rules(UBL_RULES)),
    }
}

/// Decoupe une union de motifs au niveau superieur (hors crochets, parentheses et chaines).
fn split_union(context: &str) -> Vec<&str> {
    let (mut depth, mut quote, mut start) = (0i32, None::<char>, 0usize);
    let mut parts = Vec::new();
    for (i, c) in context.char_indices() {
        match (quote, c) {
            (Some(q), c) if c == q => quote = None,
            (Some(_), _) => {}
            (None, '\'' | '"') => quote = Some(c),
            (None, '[' | '(') => depth += 1,
            (None, ']' | ')') => depth -= 1,
            (None, '|') if depth == 0 => {
                parts.push(context[start..i].trim());
                start = i + 1;
            }
            _ => {}
        }
    }
    parts.push(context[start..].trim());
    parts
}

/// Un contexte Schematron est un motif XSLT : un motif relatif vaut a toute profondeur.
fn context_to_xpath(context: &str) -> String {
    split_union(context)
        .into_iter()
        .map(|p| if p.starts_with('/') { p.to_string() } else { format!("//{p}") })
        .collect::<Vec<_>>()
        .join(" | ")
}

type Convert<V> = fn(&mut Documents, &Item) -> xee_xpath::error::Result<V>;

fn to_bool(_: &mut Documents, item: &Item) -> xee_xpath::error::Result<bool> {
    Ok(item.try_into_value::<bool>()?)
}

fn to_item(_: &mut Documents, item: &Item) -> xee_xpath::error::Result<Item> {
    Ok(item.clone())
}

fn to_string(_: &mut Documents, item: &Item) -> xee_xpath::error::Result<String> {
    Ok(item.try_into_value::<String>()?)
}

struct CompiledRule {
    context: Option<ManyQuery<Item, Convert<Item>>>,
    asserts: Vec<Option<OneQuery<bool, Convert<bool>>>>,
}

/// Regles compilees d'un format. Propre a un fil : les programmes ne sont pas partageables.
struct Engine {
    rules: &'static Rules,
    compiled: Vec<Vec<CompiledRule>>,
    path: Option<OneQuery<String, Convert<String>>>,
    /// Regles ou assertions que le moteur n'a pas su compiler (aucune a ce jour).
    uncompiled: usize,
}

impl Engine {
    fn new(format: Format) -> Self {
        let rules = rules(format);
        let mut builder = StaticContextBuilder::default();
        for (prefix, uri) in &rules.namespaces {
            builder.add_namespace(prefix, uri);
        }
        let queries = Queries::new(builder);
        let mut uncompiled = 0;
        let compiled = rules
            .patterns
            .iter()
            .map(|pattern| {
                pattern
                    .iter()
                    .map(|rule| {
                        let context = queries.many(&context_to_xpath(&rule.context), to_item as Convert<Item>).ok();
                        if context.is_none() {
                            uncompiled += rule.asserts.len();
                        }
                        let asserts = rule
                            .asserts
                            .iter()
                            .map(|a| {
                                let q = queries.one(&format!("boolean({})", a.test), to_bool as Convert<bool>).ok();
                                if q.is_none() {
                                    uncompiled += 1;
                                }
                                q
                            })
                            .collect();
                        CompiledRule { context, asserts }
                    })
                    .collect()
            })
            .collect();
        let path = queries.one(PATH_QUERY, to_string as Convert<String>).ok();
        Engine { rules, compiled, path, uncompiled }
    }

    fn validate(&self, xml: &str) -> Value {
        let started = Instant::now();
        let mut documents = Documents::new();
        let Ok(handle) = documents.add_string_without_uri(xml) else {
            return not_evaluated("XML illisible par le moteur de validation");
        };
        let mut failed = Vec::new();
        let (mut fired, mut fatals, mut warnings) = (0usize, 0usize, 0usize);
        // Assertions dont l'evaluation a echoue (valeur non convertible, par exemple).
        let mut unevaluated: Vec<String> = Vec::new();
        for (pattern, compiled) in self.rules.patterns.iter().zip(&self.compiled) {
            let mut seen = HashSet::new();
            for (rule, compiled) in pattern.iter().zip(compiled) {
                let Some(context) = &compiled.context else { continue };
                let Ok(items) = context.execute(&mut documents, handle) else {
                    unevaluated.extend(rule.asserts.iter().map(|a| a.id.clone()));
                    continue;
                };
                for item in items {
                    let Ok(node) = item.to_node() else { continue };
                    if !seen.insert(node) {
                        continue;
                    }
                    fired += 1;
                    for (assert, query) in rule.asserts.iter().zip(&compiled.asserts) {
                        let Some(query) = query else { continue };
                        match query.execute(&mut documents, &item) {
                            Ok(true) => {}
                            Ok(false) => {
                                if assert.fatal {
                                    fatals += 1;
                                } else {
                                    warnings += 1;
                                }
                                let location = self
                                    .path
                                    .as_ref()
                                    .and_then(|q| q.execute(&mut documents, &item).ok())
                                    .unwrap_or_default();
                                failed.push(json!({
                                    "id": assert.id,
                                    "flag": if assert.fatal { "fatal" } else { "warning" },
                                    "texte": assert.text,
                                    "location": location,
                                }));
                            }
                            Err(_) => unevaluated.push(assert.id.clone()),
                        }
                    }
                }
            }
        }
        unevaluated.sort();
        unevaluated.dedup();
        // Regles bloquantes d'abord, dans l'ordre du document de regles.
        failed.sort_by_key(|f| f["flag"] != "fatal");
        json!({
            "evalue": true,
            "ok": fatals == 0 && unevaluated.is_empty(),
            "version_regles": RULES_VERSION,
            "regles_declenchees": fired,
            "total": failed.len(),
            "non_conformes": fatals,
            "avertissements": warnings,
            "non_evaluables": unevaluated,
            "non_compilees": self.uncompiled,
            "erreurs": failed,
            "duree_ms": started.elapsed().as_millis() as u64,
        })
    }
}

fn not_evaluated(reason: &str) -> Value {
    json!({
        "evalue": false,
        "ok": false,
        "version_regles": RULES_VERSION,
        "regles_declenchees": 0,
        "non_conformes": 0,
        "avertissements": 0,
        "erreurs": [],
        "erreur_moteur": reason,
    })
}

/// Les regles officielles ne valent que pour une facture du bon type : racine et
/// espace de noms sont verifies avant toute evaluation.
fn recognized(xml: &str, format: Format) -> bool {
    let Ok(doc) = roxmltree::Document::parse(xml) else { return false };
    let root = doc.root_element();
    let (ns, name) = (root.tag_name().namespace().unwrap_or(""), root.tag_name().name());
    match format {
        Format::Cii => ns == "urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" && name == "CrossIndustryInvoice",
        Format::Ubl => {
            (ns == "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" && name == "Invoice")
                || (ns == "urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2" && name == "CreditNote")
        }
    }
}

/// Cle d'un resultat : format et empreinte du XML.
fn cache_key(xml: &str, format: Format) -> String {
    format!(
        "{}:{}",
        if format == Format::Cii { "CII" } else { "UBL" },
        Sha256::digest(xml.as_bytes()).iter().map(|b| format!("{b:02x}")).collect::<String>()
    )
}

// ------------------------------------------------------------------ fils de travail

struct Job {
    xml: String,
    format: Format,
    /// Document affiche : traite avant les autres.
    priority: bool,
    reply: mpsc::Sender<Value>,
}

#[derive(Default)]
struct Queue {
    jobs: Mutex<VecDeque<Job>>,
    ready: Condvar,
}

pub struct Validator {
    queue: Arc<Queue>,
    /// Resultats de la session, par empreinte du XML et format.
    cache: Mutex<HashMap<String, Value>>,
}

fn worker(queue: Arc<Queue>) {
    let mut engines: HashMap<Format, Engine> = HashMap::new();
    loop {
        let job = {
            let mut jobs = queue.jobs.lock().unwrap_or_else(|e| e.into_inner());
            loop {
                if let Some(job) = jobs.pop_front() {
                    break job;
                }
                jobs = queue.ready.wait(jobs).unwrap_or_else(|e| e.into_inner());
            }
        };
        let engine = engines.entry(job.format).or_insert_with(|| Engine::new(job.format));
        // Un echec inattendu du moteur ne doit pas emporter le fil de travail.
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| engine.validate(&job.xml)))
            .unwrap_or_else(|_| not_evaluated("Le moteur de validation a rencontré une erreur interne"));
        let _ = job.reply.send(result);
    }
}

impl Validator {
    pub fn new() -> Self {
        let queue = Arc::new(Queue::default());
        let workers = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(2).saturating_sub(1).clamp(1, 4);
        for i in 0..workers {
            let queue = queue.clone();
            // Les expressions des regles sont profondes : pile confortable.
            let _ = std::thread::Builder::new()
                .name(format!("schematron-{i}"))
                .stack_size(16 * 1024 * 1024)
                .spawn(move || worker(queue));
        }
        Validator { queue, cache: Mutex::new(HashMap::new()) }
    }

    /// Valide un XML. Bloquant : a appeler hors du fil de l'interface.
    /// Avec une bibliotheque, le resultat est repris d'une session precedente ou y est garde.
    pub fn validate(&self, xml: String, format: &str, priority: bool, library: Option<&Library>) -> Value {
        let format = match format {
            "CII" => Format::Cii,
            "UBL" => Format::Ubl,
            _ => return not_evaluated("Format sans règles officielles"),
        };
        if !recognized(&xml, format) {
            return not_evaluated("Aucune règle officielle ne s'applique à ce document (racine ou espace de noms non reconnu)");
        }
        let key = cache_key(&xml, format);
        if let Some(hit) = self.cache.lock().unwrap_or_else(|e| e.into_inner()).get(&key) {
            return hit.clone();
        }
        if let Some(mut hit) = library.and_then(|l| l.schematron_get(&key, RULES_VERSION, ENGINE_VERSION)) {
            hit["depuis_cache"] = true.into();
            self.cache.lock().unwrap_or_else(|e| e.into_inner()).insert(key, hit.clone());
            return hit;
        }
        let (reply, result) = mpsc::channel();
        {
            let mut jobs = self.queue.jobs.lock().unwrap_or_else(|e| e.into_inner());
            let job = Job { xml, format, priority, reply };
            if priority {
                let at = jobs.iter().position(|j| !j.priority).unwrap_or(jobs.len());
                jobs.insert(at, job);
            } else {
                jobs.push_back(job);
            }
        }
        self.queue.ready.notify_one();
        let value = result.recv().unwrap_or_else(|_| not_evaluated("Le moteur de validation s'est arrêté"));
        if value["evalue"] == true {
            if let Some(library) = library {
                library.schematron_put(&key, RULES_VERSION, ENGINE_VERSION, &value);
            }
            self.cache.lock().unwrap_or_else(|e| e.into_inner()).insert(key, value.clone());
        }
        value
    }
}

/// Schematron officiel EN 16931 sur le XML d'une facture CII ou UBL.
/// `library: false` : bibliotheque desactivee, rien n'est lu ni garde sur le disque.
#[tauri::command]
pub async fn validate_schematron(
    app: tauri::AppHandle,
    validator: tauri::State<'_, Arc<Validator>>,
    xml: String,
    format: String,
    priority: Option<bool>,
    library: Option<bool>,
) -> Result<Value, String> {
    let validator = validator.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let store = (library != Some(false)).then(|| app.state::<Library>());
        validator.validate(xml, &format, priority.unwrap_or(false), store.as_deref())
    })
    .await
    .map_err(|e| format!("Validation interrompue : {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    const CII: &str = r#"<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
<rsm:ExchangedDocumentContext><ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>urn:cen.eu:en16931:2017</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter></rsm:ExchangedDocumentContext>
<rsm:ExchangedDocument><ram:ID>F-1</ram:ID><ram:TypeCode>380</ram:TypeCode><ram:IssueDateTime><udt:DateTimeString format="102">20260924</udt:DateTimeString></ram:IssueDateTime></rsm:ExchangedDocument>
<rsm:SupplyChainTradeTransaction>
<ram:IncludedSupplyChainTradeLineItem><ram:AssociatedDocumentLineDocument><ram:LineID>1</ram:LineID></ram:AssociatedDocumentLineDocument><ram:SpecifiedTradeProduct><ram:Name>Papier</ram:Name></ram:SpecifiedTradeProduct><ram:SpecifiedLineTradeAgreement><ram:NetPriceProductTradePrice><ram:ChargeAmount>50.00</ram:ChargeAmount></ram:NetPriceProductTradePrice></ram:SpecifiedLineTradeAgreement><ram:SpecifiedLineTradeDelivery><ram:BilledQuantity unitCode="C62">2</ram:BilledQuantity></ram:SpecifiedLineTradeDelivery><ram:SpecifiedLineTradeSettlement><ram:ApplicableTradeTax><ram:TypeCode>VAT</ram:TypeCode><ram:CategoryCode>S</ram:CategoryCode><ram:RateApplicablePercent>20.00</ram:RateApplicablePercent></ram:ApplicableTradeTax><ram:SpecifiedTradeSettlementLineMonetarySummation><ram:LineTotalAmount>100.00</ram:LineTotalAmount></ram:SpecifiedTradeSettlementLineMonetarySummation></ram:SpecifiedLineTradeSettlement></ram:IncludedSupplyChainTradeLineItem>
<ram:ApplicableHeaderTradeAgreement>
<ram:SellerTradeParty><ram:Name>Vendeur SAS</ram:Name><ram:PostalTradeAddress><ram:CountryID>FR</ram:CountryID></ram:PostalTradeAddress><ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">FR11123456782</ram:ID></ram:SpecifiedTaxRegistration></ram:SellerTradeParty>
<ram:BuyerTradeParty><ram:Name>Acheteur SARL</ram:Name><ram:PostalTradeAddress><ram:CountryID>FR</ram:CountryID></ram:PostalTradeAddress></ram:BuyerTradeParty>
</ram:ApplicableHeaderTradeAgreement>
<ram:ApplicableHeaderTradeDelivery/>
<ram:ApplicableHeaderTradeSettlement><ram:InvoiceCurrencyCode>EUR</ram:InvoiceCurrencyCode>
<ram:ApplicableTradeTax><ram:CalculatedAmount>20.00</ram:CalculatedAmount><ram:TypeCode>VAT</ram:TypeCode><ram:BasisAmount>100.00</ram:BasisAmount><ram:CategoryCode>S</ram:CategoryCode><ram:RateApplicablePercent>20.00</ram:RateApplicablePercent></ram:ApplicableTradeTax>
<ram:SpecifiedTradePaymentTerms><ram:DueDateDateTime><udt:DateTimeString format="102">20261030</udt:DateTimeString></ram:DueDateDateTime></ram:SpecifiedTradePaymentTerms>
<ram:SpecifiedTradeSettlementHeaderMonetarySummation><ram:LineTotalAmount>100.00</ram:LineTotalAmount><ram:TaxBasisTotalAmount>100.00</ram:TaxBasisTotalAmount><ram:TaxTotalAmount currencyID="EUR">20.00</ram:TaxTotalAmount><ram:GrandTotalAmount>120.00</ram:GrandTotalAmount><ram:DuePayableAmount>120.00</ram:DuePayableAmount></ram:SpecifiedTradeSettlementHeaderMonetarySummation>
</ram:ApplicableHeaderTradeSettlement>
</rsm:SupplyChainTradeTransaction></rsm:CrossIndustryInvoice>"#;

    const UBL: &str = include_str!("../schematron/exemples/ubl-tc434-example3.xml");
    const CII_OFFICIEL: &str = include_str!("../schematron/exemples/CII_example3.xml");

    fn fatals(report: &Value) -> Vec<String> {
        let mut ids: Vec<String> = report["erreurs"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|e| e["flag"] == "fatal")
            .map(|e| e["id"].as_str().unwrap().to_string())
            .collect();
        ids.sort();
        ids.dedup();
        ids
    }

    #[test]
    fn regles_officielles_chargees_et_compilees() {
        for (format, min_asserts) in [(Format::Cii, 800), (Format::Ubl, 950)] {
            let r = rules(format);
            assert_eq!(r.patterns.len(), 3);
            let asserts: usize = r.patterns.iter().flatten().map(|rule| rule.asserts.len()).sum();
            assert!(asserts >= min_asserts, "{asserts} assertions");
            // Toutes les regles et assertions officielles se compilent.
            assert_eq!(Engine::new(format).uncompiled, 0);
        }
        assert_eq!(context_to_xpath("ram:A | /rsm:B[x = 'a|b'] | //ram:C"), "//ram:A | /rsm:B[x = 'a|b'] | //ram:C");
    }

    #[test]
    fn cii_respectee_puis_regles_enfreintes() {
        let engine = Engine::new(Format::Cii);
        let ok = engine.validate(CII);
        assert_eq!(ok["evalue"], true);
        assert_eq!(ok["ok"], true, "{ok}");
        assert!(ok["regles_declenchees"].as_u64().unwrap() > 20);
        assert!(ok["non_evaluables"].as_array().unwrap().is_empty());
        // Total faux d'un centime, puis acheteur sans nom.
        let wrong = engine.validate(&CII.replace("<ram:GrandTotalAmount>120.00", "<ram:GrandTotalAmount>120.01"));
        assert_eq!(wrong["ok"], false);
        assert!(fatals(&wrong).contains(&"BR-CO-15".to_string()), "{:?}", fatals(&wrong));
        let no_buyer = engine.validate(&CII.replace("<ram:Name>Acheteur SARL</ram:Name>", ""));
        assert_eq!(fatals(&no_buyer), ["BR-07"]);
        let failure = &no_buyer["erreurs"][0];
        assert!(failure["texte"].as_str().unwrap().starts_with("[BR-07]"));
        assert_eq!(failure["location"], "/rsm:CrossIndustryInvoice");
        // Exemple officiel de la Commission : aucune regle bloquante.
        assert!(fatals(&engine.validate(CII_OFFICIEL)).is_empty());
    }

    #[test]
    fn ubl_exemple_officiel_puis_regle_enfreinte() {
        let engine = Engine::new(Format::Ubl);
        let ok = engine.validate(UBL);
        assert!(fatals(&ok).is_empty(), "{:?}", fatals(&ok));
        assert!(ok["regles_declenchees"].as_u64().unwrap() > 20);
        let start = UBL.find("<cbc:IssueDate>").unwrap();
        let end = UBL.find("</cbc:IssueDate>").unwrap() + "</cbc:IssueDate>".len();
        let without_date = format!("{}{}", &UBL[..start], &UBL[end..]);
        assert!(fatals(&engine.validate(&without_date)).contains(&"BR-03".to_string()));
    }

    #[test]
    fn document_non_reconnu_jamais_respecte() {
        let validator = Validator::new();
        for (xml, format) in [("<Invoice>FAC-2026-123</Invoice>", "CII"), ("<a><b/></a>", "UBL"), (CII, "UBL"), ("pas du xml", "CII"), (CII, "XML")] {
            let r = validator.validate(xml.to_string(), format, false, None);
            assert_eq!(r["evalue"], false, "{format}");
            assert_eq!(r["ok"], false);
            assert!(r["erreur_moteur"].as_str().is_some_and(|m| !m.is_empty()));
        }
    }

    #[test]
    fn file_de_travail_et_cache() {
        let validator = Arc::new(Validator::new());
        let handles: Vec<_> = (0..6)
            .map(|i| {
                let v = validator.clone();
                // Six documents differents, valides en parallele.
                std::thread::spawn(move || v.validate(CII.replace("F-1", &format!("F-{i}")), "CII", i == 5, None))
            })
            .collect();
        for h in handles {
            assert_eq!(h.join().unwrap()["ok"], true);
        }
        assert_eq!(validator.cache.lock().unwrap().len(), 6);
        // Meme XML : resultat repris du cache, identique.
        let again = validator.validate(CII.replace("F-1", "F-0"), "CII", true, None);
        assert_eq!(again["ok"], true);
        assert_eq!(validator.cache.lock().unwrap().len(), 6);
    }

    #[test]
    fn resultat_repris_de_la_bibliotheque_entre_sessions() {
        let dir = std::env::temp_dir().join(format!("fx-schematron-cache-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let library = Library::new(dir.join("bibliotheque.sqlite"));
        let stored = |xml: &str| library.schematron_get(&cache_key(xml, Format::Cii), RULES_VERSION, ENGINE_VERSION);
        // Sans bibliotheque : rien n'est garde sur le disque.
        Validator::new().validate(CII.to_string(), "CII", false, None);
        assert!(stored(CII).is_none());
        // Premiere session : calcule, puis garde.
        let first = Validator::new().validate(CII.to_string(), "CII", false, Some(&library));
        assert_eq!(first["ok"], true);
        assert!(first.get("depuis_cache").is_none());
        // Nouvelle session : meme verdict, repris sans calcul.
        let second = Validator::new().validate(CII.to_string(), "CII", false, Some(&library));
        assert_eq!(second["depuis_cache"], true);
        assert_eq!(second["regles_declenchees"], first["regles_declenchees"]);
        assert_eq!(second["erreurs"], first["erreurs"]);
        // Un document non reconnu n'est jamais garde.
        Validator::new().validate("<a/>".to_string(), "CII", false, Some(&library));
        assert!(stored("<a/>").is_none());
        drop(library);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
