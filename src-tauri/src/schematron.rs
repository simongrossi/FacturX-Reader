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

/// `//p:Nom<suite>` : (`Nom`, `self::p:Nom<suite>`). Un tel contexte vaut pour chaque element
/// `Nom` du document ; il est evalue a partir de ces elements, trouves en un seul parcours,
/// plutot que par une recherche dans tout le document pour chaque regle.
fn indexed_part(part: &str) -> Option<(String, String)> {
    let rest = part.strip_prefix("//")?;
    let end = rest
        .find(|c: char| !(c.is_alphanumeric() || matches!(c, '_' | '-' | '.' | ':')))
        .unwrap_or(rest.len());
    let qname = &rest[..end];
    let (prefix, local) = qname.split_once(':')?;
    if prefix.is_empty() || local.is_empty() || local.contains(':') || rest[end..].trim_start().starts_with('(') {
        return None;
    }
    Some((local.to_string(), format!("self::{qname}{}", &rest[end..])))
}

/// Operateurs XPath qui s'ecrivent comme des noms.
const OPERATORS: [&str; 23] = [
    "and", "or", "div", "mod", "idiv", "eq", "ne", "lt", "le", "gt", "ge", "to", "union", "intersect", "except",
    "instance", "of", "cast", "castable", "as", "treat", "then", "else",
];

/// Fonctions sans argument qui ne lisent pas le noeud de contexte.
const CONSTANT_FUNCTIONS: [&str; 6] = ["true", "false", "current-date", "current-dateTime", "current-time", "implicit-timezone"];

/// Vrai si l'assertion ne depend pas du noeud de contexte : elle ne lit que des chemins
/// absolus, des litteraux et des fonctions. Il suffit alors de l'evaluer une fois par
/// document. Analyse volontairement prudente : au moindre doute, l'assertion est evaluee
/// pour chaque noeud, comme le prevoit Schematron.
fn context_independent(test: &str) -> bool {
    // Variables (for, some, every) et axes explicites : non analyses.
    if test.contains('$') || test.contains("::") {
        return false;
    }
    let chars: Vec<char> = test.chars().collect();
    let is_name = |c: char| c.is_alphanumeric() || matches!(c, '_' | '-' | '.' | ':');
    let next_non_space = |from: usize| chars[from..].iter().position(|c| !c.is_whitespace()).map(|p| from + p);
    // Dernier caractere significatif rencontre hors predicat.
    let mut prev = '(';
    let (mut i, mut depth) = (0usize, 0i32);
    while i < chars.len() {
        let c = chars[i];
        if c == '\'' || c == '"' {
            // Litteral : ignore jusqu'au guillemet fermant.
            i += 1;
            while i < chars.len() && chars[i] != c {
                i += 1;
            }
            i += 1;
            if depth == 0 {
                prev = c;
            }
            continue;
        }
        match c {
            '[' => depth += 1,
            ']' => depth -= 1,
            // Dans un predicat, le contexte est le noeud filtre, pas celui de la regle.
            _ if depth > 0 => {}
            _ if c.is_whitespace() => {
                i += 1;
                continue;
            }
            '0'..='9' => {
                while i < chars.len() && (chars[i].is_ascii_digit() || matches!(chars[i], '.' | 'e' | 'E')) {
                    i += 1;
                }
                prev = '0';
                continue;
            }
            // Element de contexte ou parent ; attribut seulement au bout d'un chemin absolu.
            '.' => return false,
            '@' if prev != '/' => return false,
            // Joker de chemin apres `/`, multiplication apres une valeur ; sinon chemin relatif.
            '*' if !(prev == '/' || prev == ')' || prev == ']' || prev == '0' || prev == '\'' || prev == '"' || is_name(prev)) => {
                return false
            }
            _ if c.is_alphabetic() || c == '_' => {
                let start = i;
                while i < chars.len() && is_name(chars[i]) {
                    i += 1;
                }
                let name: String = chars[start..i].iter().collect();
                let after = next_non_space(i);
                if after.is_some_and(|a| chars[a] == '(') {
                    // Fonction sans argument : elle peut lire le noeud de contexte (name(), position()...).
                    let empty = next_non_space(after.unwrap() + 1).is_some_and(|a| chars[a] == ')');
                    if empty && !CONSTANT_FUNCTIONS.contains(&name.as_str()) {
                        return false;
                    }
                } else if prev != '/' && prev != '@' && (name.contains(':') || !OPERATORS.contains(&name.as_str()) || prev == '(' || prev == ',') {
                    // Etape de chemin relative au noeud de contexte.
                    return false;
                }
                prev = 'a';
                continue;
            }
            _ => {}
        }
        if depth == 0 || c == '[' || c == ']' {
            prev = c;
        }
        i += 1;
    }
    true
}

/// Fin du predicat `[...]` ouvert en `open` (crochets imbriques et chaines pris en compte).
fn predicate_end(bytes: &[u8], open: usize) -> Option<usize> {
    let (mut depth, mut quote) = (0i32, None::<u8>);
    for (i, &c) in bytes.iter().enumerate().skip(open) {
        match (quote, c) {
            (Some(q), _) if c == q => quote = None,
            (Some(_), _) => {}
            (None, b'\'' | b'"') => quote = Some(c),
            (None, b'[') => depth += 1,
            (None, b']') => {
                depth -= 1;
                if depth == 0 {
                    return Some(i);
                }
            }
            _ => {}
        }
    }
    None
}

/// Vrai si le predicat est un test booleen, donc jamais un test de position : il compare
/// des valeurs ou commence par une fonction booleenne, et n'utilise ni position() ni last().
fn boolean_predicate(predicate: &str) -> bool {
    const BOOLEAN_FUNCTIONS: [&str; 9] = ["not", "ends-with", "starts-with", "contains", "exists", "empty", "matches", "boolean", "true"];
    let p = predicate.trim();
    if p.contains("position") || p.contains("last") {
        return false;
    }
    let name_end = p.find(|c: char| !(c.is_alphanumeric() || c == '-')).unwrap_or(p.len());
    let function = p[name_end..].trim_start().starts_with('(') && BOOLEAN_FUNCTIONS.contains(&&p[..name_end]);
    // Comparaison ecrite au niveau superieur du predicat, hors parentheses, crochets et chaines.
    let (mut depth, mut quote, mut comparison) = (0i32, None::<char>, false);
    for c in p.chars() {
        match (quote, c) {
            (Some(q), _) if c == q => quote = None,
            (Some(_), _) => {}
            (None, '\'' | '"') => quote = Some(c),
            (None, '(' | '[') => depth += 1,
            (None, ')' | ']') => depth -= 1,
            (None, '=' | '<' | '>') if depth == 0 => comparison = true,
            _ => {}
        }
    }
    function || comparison
}

/// Remplace `//nom` par `/descendant::nom`, que le moteur XPath evalue en un parcours au lieu
/// d'examiner les enfants de chaque noeud du document (environ vingt fois plus rapide). Les
/// deux formes designent les memes noeuds tant que l'etape ne porte pas de predicat de
/// position ; dans le doute, l'expression est laissee telle quelle.
fn descendant_axis(expr: &str) -> String {
    let bytes = expr.as_bytes();
    let mut out = String::with_capacity(expr.len() + 32);
    let (mut i, mut copied, mut quote) = (0usize, 0usize, None::<u8>);
    while i < bytes.len() {
        let c = bytes[i];
        if let Some(q) = quote {
            if c == q {
                quote = None;
            }
        } else if c == b'\'' || c == b'"' {
            quote = Some(c);
        } else if c == b'/' && bytes.get(i + 1) == Some(&b'/') {
            // Test de nom : `p:Nom`, `p:*`, `Nom` ou `*`.
            let mut j = i + 2;
            while j < bytes.len() && (bytes[j].is_ascii_alphanumeric() || matches!(bytes[j], b'_' | b'-' | b'.' | b':' | b'*')) {
                j += 1;
            }
            let name = &expr[i + 2..j];
            let mut k = j;
            let mut safe = !name.is_empty() && !name.contains("::") && !name.starts_with(['.', '-', ':']) && !name.ends_with(':');
            // Ni fonction ni test de type (`node()`, `text()`).
            safe &= !expr[j..].trim_start().starts_with('(');
            while safe && bytes.get(k) == Some(&b'[') {
                match predicate_end(bytes, k) {
                    Some(end) => {
                        safe = boolean_predicate(&expr[k + 1..end]);
                        k = end + 1;
                    }
                    None => safe = false,
                }
            }
            if safe {
                out.push_str(&expr[copied..i]);
                out.push_str("/descendant::");
                copied = i + 2;
                i += 2;
                continue;
            }
        }
        i += 1;
    }
    out.push_str(&expr[copied..]);
    out
}

/// Position des mots-cles ecrits au niveau superieur d'une expression : hors parentheses,
/// crochets et chaines.
fn top_level_keywords(expr: &str) -> Vec<(usize, &str)> {
    let bytes = expr.as_bytes();
    let (mut depth, mut quote, mut found) = (0i32, None::<u8>, Vec::new());
    let mut i = 0;
    while i < bytes.len() {
        let c = bytes[i];
        match (quote, c) {
            (Some(q), _) if c == q => quote = None,
            (Some(_), _) => {}
            (None, b'\'' | b'"') => quote = Some(c),
            (None, b'(' | b'[') => depth += 1,
            (None, b')' | b']') => depth -= 1,
            (None, _) if depth == 0 && c.is_ascii_alphabetic() => {
                let start = i;
                while i < bytes.len() && (bytes[i].is_ascii_alphanumeric() || matches!(bytes[i], b'-' | b'_' | b':' | b'.')) {
                    i += 1;
                }
                // Un mot-cle n'est ni une etape de chemin, ni un attribut, ni une variable.
                let before = expr[..start].trim_end().as_bytes().last().copied();
                if !matches!(before, Some(b'/' | b'@' | b'$')) {
                    found.push((start, &expr[start..i]));
                }
                continue;
            }
            _ => {}
        }
        i += 1;
    }
    found
}

/// Pour `A and B`, eventuellement sous `every $v in S satisfies`, l'expression reduite a `A`.
/// XPath laisse libre l'ordre d'evaluation de `and` : si `A` est faux, le resultat peut etre
/// faux meme quand `B` est en erreur. Le moteur XPath evalue les deux ; les moteurs XSLT de
/// reference s'arretent a `A`. Cette garde donne le meme verdict qu'eux.
fn first_conjunct(test: &str) -> Option<String> {
    let keywords = top_level_keywords(test);
    let body = match keywords.first() {
        Some((0, "every")) => keywords.iter().find(|(_, k)| *k == "satisfies").map(|(at, k)| at + k.len())?,
        _ => 0,
    };
    let rest: Vec<&(usize, &str)> = keywords.iter().filter(|(at, _)| *at >= body).collect();
    if rest.iter().any(|(_, k)| matches!(*k, "or" | "satisfies" | "return" | "then" | "else" | "some" | "every" | "for" | "if")) {
        return None;
    }
    let (at, _) = rest.iter().find(|(_, k)| *k == "and")?;
    Some(test[..*at].trim_end().to_string())
}

/// Partie d'un contexte de regle (les unions sont decoupees).
enum ContextPart {
    /// Evaluee a partir des elements de ce nom.
    Indexed { local: String, query: ManyQuery<Item, Convert<Item>> },
    /// Evaluee sur tout le document.
    Whole(ManyQuery<Item, Convert<Item>>),
}

struct CompiledRule {
    context: Option<Vec<ContextPart>>,
    asserts: Vec<Option<OneQuery<bool, Convert<bool>>>>,
    /// Assertions independantes du noeud de contexte : evaluees une fois par document.
    once: Vec<bool>,
    /// Premier terme des assertions de la forme `A and B`, consulte quand l'assertion echoue a s'evaluer.
    guards: Vec<Option<OneQuery<bool, Convert<bool>>>>,
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
        Self::build(format, true)
    }

    /// `optimized: false` : evaluation litterale des regles, reference des tests.
    fn build(format: Format, optimized: bool) -> Self {
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
                        let fast = |xpath: &str| if optimized { descendant_axis(xpath) } else { xpath.to_string() };
                        let compile = |xpath: &str| queries.many(&fast(xpath), to_item as Convert<Item>).ok();
                        let context = if optimized {
                            split_union(&context_to_xpath(&rule.context))
                                .into_iter()
                                .map(|part| match indexed_part(part) {
                                    Some((local, xpath)) => compile(&xpath).map(|query| ContextPart::Indexed { local, query }),
                                    None => compile(part).map(ContextPart::Whole),
                                })
                                .collect::<Option<Vec<_>>>()
                        } else {
                            compile(&context_to_xpath(&rule.context)).map(|q| vec![ContextPart::Whole(q)])
                        };
                        if context.is_none() {
                            uncompiled += rule.asserts.len();
                        }
                        let asserts = rule
                            .asserts
                            .iter()
                            .map(|a| {
                                let q = queries.one(&format!("boolean({})", fast(&a.test)), to_bool as Convert<bool>).ok();
                                if q.is_none() {
                                    uncompiled += 1;
                                }
                                q
                            })
                            .collect();
                        let once = rule.asserts.iter().map(|a| optimized && context_independent(&a.test)).collect();
                        let guards = rule
                            .asserts
                            .iter()
                            .map(|a| queries.one(&format!("boolean({})", fast(&first_conjunct(&a.test)?)), to_bool as Convert<bool>).ok())
                            .collect();
                        CompiledRule { context, asserts, once, guards }
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
        // Elements du document par nom local, construits au premier contexte qui en a besoin.
        let mut by_name: Option<HashMap<String, Vec<Item>>> = None;
        for (pattern, compiled) in self.rules.patterns.iter().zip(&self.compiled) {
            let mut seen = HashSet::new();
            for (rule, compiled) in pattern.iter().zip(compiled) {
                let Some(context) = &compiled.context else { continue };
                let mut items = Vec::new();
                let mut broken = false;
                for part in context {
                    match part {
                        ContextPart::Whole(query) => match query.execute(&mut documents, handle) {
                            Ok(found) => items.extend(found),
                            Err(_) => broken = true,
                        },
                        ContextPart::Indexed { local, query } => {
                            let index = by_name.get_or_insert_with(|| elements_by_name(&documents, handle));
                            for candidate in index.get(local).map(Vec::as_slice).unwrap_or_default() {
                                match query.execute(&mut documents, candidate) {
                                    Ok(found) => items.extend(found),
                                    Err(_) => broken = true,
                                }
                            }
                        }
                    }
                }
                if broken {
                    unevaluated.extend(rule.asserts.iter().map(|a| a.id.clone()));
                    continue;
                }
                // Resultat des assertions independantes du noeud, calcule au premier noeud.
                let mut once: Vec<Option<Result<bool, ()>>> = vec![None; rule.asserts.len()];
                for item in items {
                    let Ok(node) = item.to_node() else { continue };
                    if !seen.insert(node) {
                        continue;
                    }
                    fired += 1;
                    for (k, (assert, query)) in rule.asserts.iter().zip(&compiled.asserts).enumerate() {
                        let Some(query) = query else { continue };
                        let outcome = match once[k] {
                            Some(known) => known,
                            None => {
                                let mut outcome = query.execute(&mut documents, &item).map_err(|_| ());
                                if outcome.is_err() {
                                    // `A and B` en erreur alors que `A` est faux : l'assertion est fausse.
                                    if let Some(guard) = &compiled.guards[k] {
                                        if matches!(guard.execute(&mut documents, &item), Ok(false)) {
                                            outcome = Ok(false);
                                        }
                                    }
                                }
                                if compiled.once[k] {
                                    once[k] = Some(outcome);
                                }
                                outcome
                            }
                        };
                        match outcome {
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

/// Elements du document, par nom local, dans l'ordre du document.
fn elements_by_name(documents: &Documents, handle: xee_xpath::DocumentHandle) -> HashMap<String, Vec<Item>> {
    let mut index: HashMap<String, Vec<Item>> = HashMap::new();
    let xot = documents.xot();
    let Some(root) = documents.document_node(handle) else { return index };
    for node in xot.descendants(root) {
        if let Some(element) = xot.element(node) {
            index.entry(xot.local_name_str(element.name()).to_string()).or_default().push(Item::Node(node));
        }
    }
    index
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

    /// Facture CII de `n` lignes, pour les mesures de duree.
    fn grande_facture(n: usize) -> String {
        let start = CII.find("<ram:IncludedSupplyChainTradeLineItem>").unwrap();
        let end = CII.find("</ram:IncludedSupplyChainTradeLineItem>").unwrap() + "</ram:IncludedSupplyChainTradeLineItem>".len();
        format!("{}{}{}", &CII[..start], CII[start..end].repeat(n), &CII[end..])
    }

    #[test]
    fn analyse_des_assertions_independantes_du_noeud() {
        for test in [
            "count(//ram:A[ram:B = 'x']) = 0",
            "//rsm:CrossIndustryInvoice/ram:X/@unitCode = 'C62'",
            "(not(//ram:A) and //ram:B) or exists(/rsm:R/ram:C[name() = 'C'])",
            "sum(//ram:A) * 2 > 3.5 div 1",
            "true() and 'a.b@c' != \"x[y\"",
        ] {
            assert!(context_independent(test), "{test}");
        }
        for test in [
            "ram:A",
            "not(ram:A)",
            "@unitCode",
            ". = 'x'",
            "../ram:A",
            "string-length(normalize-space()) > 0",
            "position() = 1",
            "every $r in //ram:A satisfies $r > 0",
            "ancestor::ram:A",
            "//ram:A = ram:B",
            "(//ram:A | ram:B)",
            "count(*) > 0",
            "//ram:A and not(name)",
            // Prudence : `.` est refuse partout, meme quand il designe une etape de chemin absolu.
            "sum(//ram:A/xs:decimal(.)) > 0",
        ] {
            assert!(!context_independent(test), "{test}");
        }
        assert_eq!(first_conjunct("(count(a) eq 1) and (b = c)").as_deref(), Some("(count(a) eq 1)"));
        assert_eq!(
            first_conjunct("every $c in cbc:Code satisfies (count(a[@x=$c]) eq 1) and (b = 'x and y')").as_deref(),
            Some("every $c in cbc:Code satisfies (count(a[@x=$c]) eq 1)")
        );
        for test in ["a = b", "a and b or c", "a or b and c", "(a and b)", "if (a) then b and c else d", "a/and and b/or or c", "some $x in a satisfies $x and b"] {
            assert_eq!(first_conjunct(test), None, "{test}");
        }
        assert_eq!(first_conjunct("a/and and @or").as_deref(), Some("a/and"));
        for (from, to) in [
            ("count(//ram:A/ram:B[ram:C='G']) = 0", "count(/descendant::ram:A/ram:B[ram:C='G']) = 0"),
            ("//ram:*[ends-with(name(), 'ID')]", "/descendant::ram:*[ends-with(name(), 'ID')]"),
            ("//ram:A[ram:B = 'x'][not(ram:C)]//ram:D", "/descendant::ram:A[ram:B = 'x'][not(ram:C)]/descendant::ram:D"),
            ("self::ram:A//ram:B and '//ram:C' = \"//x\"", "self::ram:A/descendant::ram:B and '//ram:C' = \"//x\""),
            // Predicat de position possible, test de type, axe explicite : inchanges.
            ("//ram:A[1]", "//ram:A[1]"),
            ("//ram:A[ram:B]", "//ram:A[ram:B]"),
            ("//ram:A[position() = 1]", "//ram:A[position() = 1]"),
            ("//ram:A[last()]", "//ram:A[last()]"),
            ("//node()", "//node()"),
            ("//text()", "//text()"),
            ("//@id", "//@id"),
            ("//child::ram:A", "//child::ram:A"),
            ("(//ram:A)[1]", "(/descendant::ram:A)[1]"),
        ] {
            assert_eq!(descendant_axis(from), to);
        }
        assert_eq!(indexed_part("//ram:A[x]/ram:B"), Some(("A".into(), "self::ram:A[x]/ram:B".into())));
        for part in ["//ram:*[x]", "//*[x]", "/rsm:A", "//descendant::ram:A", "//ram:A::x"] {
            assert_eq!(indexed_part(part), None, "{part}");
        }
        // L'analyse retient une part notable des regles officielles, et toutes se compilent.
        for format in [Format::Cii, Format::Ubl] {
            let engine = Engine::new(format);
            assert_eq!(engine.uncompiled, 0);
            let once: usize = engine.compiled.iter().flatten().map(|r| r.once.iter().filter(|o| **o).count()).sum();
            assert!(once > 50, "{once}");
        }
    }

    /// Resultat comparable d'une validation : verdict, compteurs et regles en echec avec leur emplacement.
    fn signature(report: &Value) -> Value {
        let mut failures: Vec<String> =
            report["erreurs"].as_array().unwrap().iter().map(|e| format!("{} {} {}", e["id"], e["flag"], e["location"])).collect();
        failures.sort();
        json!([report["ok"], report["regles_declenchees"], report["non_conformes"], report["avertissements"], report["non_evaluables"], failures])
    }

    /// Variantes abimees d'un document : un element retire ou une valeur alteree.
    fn variantes(xml: &str) -> Vec<String> {
        let mut out = vec![xml.to_string()];
        for tag in [
            "ram:Name", "ram:TypeCode", "ram:CategoryCode", "ram:RateApplicablePercent", "ram:LineTotalAmount", "ram:BasisAmount",
            "ram:CountryID", "cbc:ID", "cbc:Name", "cbc:IssueDate", "cbc:TaxAmount", "cbc:Percent", "cac:TaxCategory", "cbc:IdentificationCode",
        ] {
            let (open, close) = (format!("<{tag}"), format!("</{tag}>"));
            for nth in [0usize, 3] {
                let Some(start) = xml.match_indices(&open).filter(|(i, _)| xml[i + open.len()..].starts_with(['>', ' '])).nth(nth).map(|(i, _)| i) else {
                    continue;
                };
                let Some(end) = xml[start..].find(&close).map(|e| start + e + close.len()) else { continue };
                out.push(format!("{}{}", &xml[..start], &xml[end..]));
            }
        }
        for (from, to) in [("100.00", "100.01"), ("20.00", "19.00"), (">S<", ">E<"), (">VAT<", ">vat<"), ("EUR", "XXX"), ("C62", "ZZZ")] {
            if let Some(i) = xml.find(from) {
                out.push(format!("{}{}{}", &xml[..i], to, &xml[i + from.len()..]));
            }
        }
        out
    }

    /// Compare, document par document et variante par variante, l'evaluation optimisee a
    /// l'evaluation litterale des regles. Retourne le nombre de documents compares.
    fn comparer(documents: &[(Format, String)]) -> usize {
        let mut compared = 0;
        for format in [Format::Cii, Format::Ubl] {
            let (fast, reference) = (Engine::new(format), Engine::build(format, false));
            for (_, xml) in documents.iter().filter(|(f, _)| *f == format) {
                for variant in variantes(xml) {
                    let (a, b) = (fast.validate(&variant), reference.validate(&variant));
                    assert_eq!(signature(&a), signature(&b), "{}", &variant[..variant.len().min(300)]);
                    compared += 1;
                }
            }
        }
        compared
    }

    /// Factures reelles de `samples/` (non versionnees), au format attendu par le moteur.
    fn factures_reelles() -> Vec<(Format, String)> {
        let samples = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../samples");
        let mut out = Vec::new();
        for path in std::fs::read_dir(samples).into_iter().flatten().filter_map(|e| e.ok().map(|e| e.path())) {
            let name = path.file_name().unwrap().to_string_lossy().into_owned();
            let Ok(data) = std::fs::read(&path) else { continue };
            let Ok(r) = crate::facturx::parse_file(&name, &data) else { continue };
            let format = match r["format"].as_str() {
                Some("CII") => Format::Cii,
                Some("UBL") => Format::Ubl,
                _ => continue,
            };
            out.push((format, r["xml_pretty"].as_str().unwrap_or_default().to_string()));
        }
        out
    }

    /// Les optimisations ne changent aucun resultat : meme verdict, memes regles en echec,
    /// aux memes emplacements, que l'evaluation litterale des regles, sur les exemples
    /// officiels, la facture de test, une facture de 15 lignes et leurs variantes abimees.
    #[test]
    fn optimisations_sans_effet_sur_les_resultats() {
        let documents = [
            (Format::Cii, CII.to_string()),
            (Format::Cii, CII_OFFICIEL.to_string()),
            (Format::Cii, grande_facture(15)),
            (Format::Ubl, UBL.to_string()),
        ];
        assert!(comparer(&documents) > 40);
    }

    /// Meme comparaison sur les factures reelles de `samples/` et leurs variantes. Longue :
    /// `cargo test --release -- --ignored`.
    #[test]
    #[ignore]
    fn optimisations_sans_effet_sur_les_factures_reelles() {
        let documents = factures_reelles();
        eprintln!("{} factures, {} documents compares", documents.len(), comparer(&documents));
    }

    /// Duree sur une facture de 120 lignes, avant et apres optimisation (`--ignored --nocapture`,
    /// en version optimisee pour des chiffres representatifs).
    #[test]
    #[ignore]
    fn duree_grande_facture() {
        let xml = grande_facture(120);
        for (label, engine) in [("litteral", Engine::build(Format::Cii, false)), ("optimise", Engine::new(Format::Cii))] {
            let started = Instant::now();
            let report = engine.validate(&xml);
            eprintln!("{label} : {:?} ({} contextes)", started.elapsed(), report["regles_declenchees"]);
        }
        for (format, xml) in factures_reelles() {
            let mut times = Vec::new();
            for engine in [Engine::build(format, false), Engine::new(format)] {
                let started = Instant::now();
                engine.validate(&xml);
                times.push(started.elapsed());
            }
            eprintln!("{} Ko : {:?} -> {:?}", xml.len() / 1024, times[0], times[1]);
        }
    }

    /// Temps passe par regle et par assertion sur la plus grosse facture reelle (`--ignored --nocapture`).
    #[test]
    #[ignore]
    fn profil_par_regle() {
        let Some((format, xml)) = factures_reelles().into_iter().max_by_key(|(_, xml)| xml.len()) else { return };
        let engine = Engine::new(format);
        let mut documents = Documents::new();
        let handle = documents.add_string_without_uri(&xml).unwrap();
        let t = Instant::now();
        let index = elements_by_name(&documents, handle);
        eprintln!("{} Ko, {} elements, index en {:?}", xml.len() / 1024, index.values().map(Vec::len).sum::<usize>(), t.elapsed());
        let (mut rows, mut asserts) = (Vec::new(), Vec::new());
        for (pattern, compiled) in engine.rules.patterns.iter().zip(&engine.compiled) {
            for (rule, compiled) in pattern.iter().zip(compiled) {
                let t = Instant::now();
                let mut items = Vec::new();
                for part in compiled.context.as_ref().unwrap() {
                    match part {
                        ContextPart::Whole(q) => items.extend(q.execute(&mut documents, handle).unwrap_or_default()),
                        ContextPart::Indexed { local, query } => {
                            for c in index.get(local).map(Vec::as_slice).unwrap_or_default() {
                                items.extend(query.execute(&mut documents, c).unwrap_or_default());
                            }
                        }
                    }
                }
                let ctx = t.elapsed();
                let t = Instant::now();
                for (k, (assert, query)) in rule.asserts.iter().zip(&compiled.asserts).enumerate() {
                    let ta = Instant::now();
                    for item in items.iter().take(if compiled.once[k] { 1 } else { usize::MAX }) {
                        let _ = query.as_ref().unwrap().execute(&mut documents, item);
                    }
                    asserts.push((ta.elapsed(), items.len(), compiled.once[k], format!("{} :: {}", assert.id, assert.test.chars().take(230).collect::<String>())));
                }
                rows.push((ctx, t.elapsed(), items.len(), rule.asserts.len(), rule.context.chars().take(100).collect::<String>()));
            }
        }
        eprintln!(
            "contextes {:?} assertions {:?}",
            rows.iter().map(|r| r.0).sum::<std::time::Duration>(),
            rows.iter().map(|r| r.1).sum::<std::time::Duration>()
        );
        rows.sort_by_key(|r| std::cmp::Reverse(r.0 + r.1));
        for r in rows.iter().take(14) {
            eprintln!("ctx {:>9.1?} ass {:>9.1?} noeuds {:>4} asserts {:>3}  {}", r.0, r.1, r.2, r.3, r.4);
        }
        asserts.sort_by_key(|r| std::cmp::Reverse(r.0));
        for a in asserts.iter().take(22) {
            eprintln!("{:>9.1?} x{:<4} {} {}", a.0, a.1, if a.2 { "1x" } else { "  " }, a.3);
        }
    }

    /// Suite de tests officielle de la Commission (`schematron/tests-officiels`, format du
    /// validateur VEFA) : pour chaque cas, la regle visee doit etre respectee (`success`),
    /// enfreinte et bloquante (`error`) ou signalee en avertissement (`warning`). Les factures
    /// completes de `testfiles/` ne doivent enfreindre aucune regle bloquante.
    #[test]
    fn suite_de_tests_officielle() {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("schematron/tests-officiels");
        let engines = [(Format::Cii, Engine::new(Format::Cii)), (Format::Ubl, Engine::new(Format::Ubl))];
        let engine = |format: Format| &engines.iter().find(|(f, _)| *f == format).unwrap().1;
        let mut files: Vec<_> = walk(&root);
        files.sort();
        let (mut cases, mut mismatches) = (0usize, Vec::new());
        for path in files {
            let source = std::fs::read_to_string(&path).unwrap();
            let name = path.strip_prefix(&root).unwrap().display().to_string();
            let doc = roxmltree::Document::parse(&source).unwrap_or_else(|e| panic!("{name} : {e}"));
            let top = doc.root_element();
            if top.tag_name().name() != "testSet" {
                // Facture complete : aucune regle bloquante enfreinte.
                let format = if top.tag_name().name() == "CrossIndustryInvoice" { Format::Cii } else { Format::Ubl };
                let report = engine(format).validate(&source);
                cases += 1;
                if !fatals(&report).is_empty() || !report["non_evaluables"].as_array().unwrap().is_empty() {
                    mismatches.push(format!("{name} : {:?} {}", fatals(&report), report["non_evaluables"]));
                }
                continue;
            }
            let format = match top.attribute("configuration") {
                Some("tc434-cii") => Format::Cii,
                Some("tc434-ubl") => Format::Ubl,
                other => panic!("{name} : configuration {other:?}"),
            };
            for (n, test) in top.children().filter(|c| c.has_tag_name(("http://difi.no/xsd/vefa/validator/1.0", "test"))).enumerate() {
                let expectations: Vec<(String, String)> = test
                    .children()
                    .filter(|c| c.tag_name().name() == "assert")
                    .flat_map(|a| a.children().filter(|c| c.is_element()))
                    .filter(|c| matches!(c.tag_name().name(), "success" | "error" | "warning"))
                    .map(|c| (c.tag_name().name().to_string(), c.text().unwrap_or("").trim().to_string()))
                    .collect();
                let invoice = test.children().find(|c| c.is_element() && c.tag_name().name() != "assert").expect("document du cas");
                let report = engine(format).validate(&source[invoice.range()]);
                cases += 1;
                for (kind, id) in expectations {
                    let flags: Vec<&str> = report["erreurs"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .filter(|e| e["id"] == id.as_str())
                        .map(|e| e["flag"].as_str().unwrap())
                        .collect();
                    let unevaluated = report["non_evaluables"].as_array().unwrap().iter().any(|u| u == id.as_str());
                    let ok = !unevaluated
                        && match kind.as_str() {
                            "success" => flags.is_empty(),
                            "error" => flags.contains(&"fatal"),
                            _ => flags.contains(&"warning"),
                        };
                    if !ok {
                        mismatches.push(format!("{name} cas {} : {kind} {id} attendu, obtenu {flags:?}{}", n + 1, if unevaluated { " (non evaluable)" } else { "" }));
                    }
                }
            }
        }
        assert!(cases > 800, "{cases} cas");
        assert!(mismatches.is_empty(), "{} ecarts sur {cases} cas :\n{}", mismatches.len(), mismatches.join("\n"));
    }

    fn walk(dir: &std::path::Path) -> Vec<std::path::PathBuf> {
        let mut out = Vec::new();
        for entry in std::fs::read_dir(dir).unwrap().filter_map(Result::ok) {
            let path = entry.path();
            if path.is_dir() {
                out.extend(walk(&path));
            } else if path.extension().is_some_and(|e| e == "xml") {
                out.push(path);
            }
        }
        out
    }
}
