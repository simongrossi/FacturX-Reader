//! Moteur d'analyse des factures electroniques (Factur-X / UBL / CII).
//!
//! Supporte :
//!   - PDF Factur-X : PDF avec pièce jointe XML (UBL/CII) intégrée
//!   - Factur-X (CII) : archive ZIP contenant un XML (+ PDF)
//!   - XML UBL 2.x (EN 16931) avec PDF intégré en base64
//!   - XML CII (EN 16931) avec PDF intégré en base64

use std::collections::HashMap;
use std::fmt;
use std::io::{Cursor, Read};
use std::sync::LazyLock;

use base64::Engine;
use regex::bytes::Regex as BytesRegex;
use regex::Regex;
use roxmltree::{Document, Node, NodeId, ParsingOptions};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};

use crate::tables;

mod controles;
mod en16931;

#[derive(Debug)]
pub struct FacturXError(pub String);

impl fmt::Display for FacturXError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for FacturXError {}

type N<'a> = Node<'a, 'a>;
type ON<'a> = Option<N<'a>>;

// ------------------------------------------------------------------ utilitaires

/// Nom local d'une etiquette XML sans espace de noms.
fn local<'a>(n: N<'a>) -> &'a str {
    n.tag_name().name()
}

fn text(el: ON) -> String {
    el.and_then(|n| n.text()).map(|t| t.trim().to_string()).unwrap_or_default()
}

fn elements<'a>(el: N<'a>) -> impl Iterator<Item = N<'a>> {
    el.children().filter(|c| c.is_element())
}

/// Premier enfant direct (tous espaces de noms) dont le nom local = name.
fn find<'a>(el: ON<'a>, name: &str) -> ON<'a> {
    elements(el?).find(|c| local(*c) == name)
}

fn findall<'a>(el: ON<'a>, name: &str) -> Vec<N<'a>> {
    match el {
        Some(el) => elements(el).filter(|c| local(*c) == name).collect(),
        None => Vec::new(),
    }
}

/// find() sur plusieurs noms locaux possibles (variantes CII EN16931 / CII classique).
fn find_alt<'a>(el: ON<'a>, names: &[&str]) -> ON<'a> {
    names.iter().find_map(|n| find(el, n))
}

fn findall_alt<'a>(el: ON<'a>, names: &[&str]) -> Vec<N<'a>> {
    names.iter().flat_map(|n| findall(el, n)).collect()
}

fn attr(el: ON, name: &str) -> Option<String> {
    el.and_then(|n| n.attribute(name)).filter(|v| !v.is_empty()).map(str::to_string)
}

/// Texte d'une date, y compris imbriquee dans udt:DateTimeString (CII).
fn date_text(el: ON) -> String {
    let v = text(el);
    if !v.is_empty() {
        return v;
    }
    let Some(el) = el else { return String::new() };
    for c in el.descendants().filter(|c| c.is_element()) {
        if local(c) == "DateTimeString" {
            let t = text(Some(c));
            if c.attribute("format") == Some("102") && t.len() == 8 && t.bytes().all(|b| b.is_ascii_digit()) {
                return format!("{}-{}-{}", &t[0..4], &t[4..6], &t[6..8]);
            }
            return t;
        }
    }
    v
}

fn num(s: &str) -> Option<f64> {
    s.trim().parse::<f64>().ok()
}

fn thousands(n: usize) -> String {
    let digits = n.to_string();
    let mut out = String::with_capacity(digits.len() + digits.len() / 3);
    for (i, c) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i) % 3 == 0 {
            out.push(',');
        }
        out.push(c);
    }
    out
}

fn nonempty(s: Option<String>) -> Option<String> {
    s.filter(|v| !v.is_empty())
}

// ------------------------------------------------------------------ traductions

fn lookup(table: &'static [(&'static str, &'static str)], key: &str) -> Option<&'static str> {
    table.iter().find(|(k, _)| *k == key).map(|(_, v)| *v)
}

static TITLES: LazyLock<HashMap<(&'static str, &'static str), &'static str>> =
    LazyLock::new(|| tables::TITLES.iter().map(|(p, t, v)| ((*p, *t), *v)).collect());

static TITLES_GENERIC: LazyLock<HashMap<&'static str, &'static str>> =
    LazyLock::new(|| tables::TITLES_GENERIC.iter().copied().collect());

fn title_for(el: N) -> String {
    let t = local(el);
    let p = el.parent_element().map(local).unwrap_or("");
    TITLES
        .get(&(p, t))
        .or_else(|| TITLES_GENERIC.get(t))
        .copied()
        .unwrap_or(t)
        .to_string()
}

/// Note explicative (traduction de codes, unité de mesure...).
fn note_for(el: ON) -> Option<String> {
    let el = el?;
    let t = local(el);
    let v = text(Some(el));
    if matches!(t, "InvoiceTypeCode" | "CreditNoteTypeCode" | "TypeCode") {
        if let Some(n) = lookup(tables::INVOICE_TYPES, &v) {
            return Some(n.to_string());
        }
    }
    if matches!(t, "PaymentMeansCode" | "TypeCode") {
        if let Some(n) = lookup(tables::PAYMENT_MODES, &v) {
            return Some(n.to_string());
        }
    }
    let u = attr(Some(el), "unitCode")?;
    Some(match lookup(tables::UNITS, &u) {
        Some(label) => format!("{u} — {label}"),
        None => u,
    })
}

fn row(title: &str, value: String, path: String, note: Option<String>) -> Value {
    let mut m = Map::new();
    m.insert("title".into(), title.into());
    m.insert("value".into(), value.into());
    m.insert("path".into(), path.into());
    if let Some(n) = nonempty(note) {
        m.insert("note".into(), n.into());
    }
    Value::Object(m)
}

fn empty(title: &str) -> Value {
    row(title, String::new(), String::new(), None)
}

fn columns(spec: &[(&str, &str, &str)]) -> Value {
    Value::Array(
        spec.iter()
            .map(|(key, title, align)| json!({ "key": key, "title": title, "align": align }))
            .collect(),
    )
}

/// Chemins lisibles de tous les elements :
/// Invoice/InvoiceLine[2]/Item/SellersItemIdentification/ID.
struct Paths(HashMap<NodeId, String>);

impl Paths {
    fn build(root: N) -> Self {
        let mut map = HashMap::new();
        map.insert(root.id(), local(root).to_string());
        for parent in root.descendants().filter(|n| n.is_element()) {
            let base = map[&parent.id()].clone();
            let mut totals: HashMap<&str, usize> = HashMap::new();
            for c in elements(parent) {
                *totals.entry(local(c)).or_default() += 1;
            }
            let mut seen: HashMap<&str, usize> = HashMap::new();
            for c in elements(parent) {
                let name = local(c);
                let idx = seen.entry(name).or_default();
                *idx += 1;
                let path = if totals[name] > 1 {
                    format!("{base}/{name}[{idx}]")
                } else {
                    format!("{base}/{name}")
                };
                map.insert(c.id(), path);
            }
        }
        Paths(map)
    }

    fn of(&self, el: ON) -> String {
        el.and_then(|n| self.0.get(&n.id())).cloned().unwrap_or_default()
    }

    fn cell(&self, title: &str, el: ON, note: Option<String>, value: Option<String>) -> Value {
        row(title, value.unwrap_or_else(|| text(el)), self.of(el), note)
    }

    /// Cellule si l'element existe, cellule vide sinon.
    fn cell_or_empty(&self, title: &str, el: ON) -> Value {
        match el {
            Some(_) => self.cell(title, el, None, None),
            None => empty(title),
        }
    }

    /// Ligne d'en-tete : ajoutee si elle porte une valeur (ou une valeur forcee).
    fn addh(&self, h: &mut Vec<Value>, title: &str, el: ON, note: Option<String>, value: Option<String>) {
        if el.is_none() && value.is_none() {
            return;
        }
        let forced = value.is_some();
        let v = value.unwrap_or_else(|| text(el));
        if !v.is_empty() || forced {
            h.push(row(title, v, self.of(el), nonempty(note).or_else(|| note_for(el))));
        }
    }

    /// Ligne de section : ajoutee seulement si l'element porte du texte.
    fn add(&self, rows: &mut Vec<Value>, title: &str, el: ON, note: Option<String>) {
        let v = text(el);
        if v.is_empty() {
            return;
        }
        rows.push(row(title, v, self.of(el), nonempty(note).or_else(|| note_for(el))));
    }
}

fn section(name: &str, rows: Vec<Value>) -> Value {
    json!({ "name": name, "rows": rows })
}

fn value_of(rows: &[Value], title: &str) -> String {
    rows.iter()
        .find(|r| r["title"] == title && r["value"].as_str().is_some_and(|v| !v.is_empty()))
        .and_then(|r| r["value"].as_str())
        .unwrap_or("")
        .to_string()
}

fn section_value(section: &Value, title: &str) -> String {
    section["rows"].as_array().map(|rows| value_of(rows, title)).unwrap_or_default()
}

fn summary(pairs: Vec<(&str, String)>) -> Vec<Value> {
    pairs
        .into_iter()
        .filter(|(_, v)| !v.is_empty())
        .map(|(t, v)| json!({ "title": t, "value": v }))
        .collect()
}

// ------------------------------------------------------------------ lignes : utilitaires communs

fn money(el: ON) -> String {
    let v = text(el);
    match attr(el, "currencyID") {
        Some(cur) if !v.is_empty() => format!("{v} {cur}"),
        Some(cur) if el.is_some() => cur,
        _ => v,
    }
}

fn cii_money(el: ON) -> String {
    let v = text(el);
    match attr(el, "currencyID") {
        Some(cur) if !v.is_empty() => format!("{v} {cur}"),
        _ => v,
    }
}

fn money_num(num: Option<f64>, cur: Option<&str>) -> String {
    match (num, cur) {
        (None, _) => String::new(),
        (Some(n), Some(c)) => format!("{n:.2} {c}"),
        (Some(n), None) => format!("{n:.2}"),
    }
}

/// TVA due sur un montant HT au taux (en %) : HT x taux / 100.
fn line_tax(total: &str, rate: &str) -> String {
    match (num(total), num(rate)) {
        (Some(total), Some(rate)) if rate > 0.0 && total != 0.0 => format!("{:.2}", total * rate / 100.0),
        _ => String::new(),
    }
}

struct AllowanceCharge {
    net: f64,
    cur: Option<String>,
    reasons: Vec<String>,
    charges: f64,
    allowances: f64,
}

/// Somme nette des AllowanceCharge au niveau d'une ligne :
/// net = charges - remises. (ChargeIndicator absent = majoration, cf. UBL.)
fn line_allowance_charge(line: N) -> AllowanceCharge {
    let mut ac = AllowanceCharge { net: 0.0, cur: None, reasons: Vec::new(), charges: 0.0, allowances: 0.0 };
    for el in findall(Some(line), "AllowanceCharge") {
        let indicator = find(Some(el), "ChargeIndicator");
        let is_charge = indicator.is_none()
            || matches!(text(indicator).to_lowercase().as_str(), "true" | "1" | "yes" | "oui");
        let amt_el = find(Some(el), "Amount");
        let amt = num(&text(amt_el)).unwrap_or(0.0);
        if is_charge {
            ac.charges += amt;
        } else {
            ac.allowances += amt;
        }
        let reason = text(find(Some(el), "AllowanceChargeReason"));
        if !reason.is_empty() && !ac.reasons.contains(&reason) {
            ac.reasons.push(reason);
        }
        if ac.cur.is_none() {
            ac.cur = attr(amt_el, "currencyID");
        }
    }
    ac.net = ac.charges - ac.allowances;
    ac
}

/// Montant d'un frais/remise avec devise (signe - pour une remise).
fn fmt_ac(amount: f64, cur: Option<&str>) -> String {
    let mut s = format!("{:.2}", amount.abs());
    if amount < 0.0 {
        s.insert(0, '-');
    }
    match cur {
        Some(c) => format!("{s} {c}"),
        None => s,
    }
}

/// TOUS les champs d'une ligne, de facon generique : chaque element portant du
/// texte, avec son libelle francais (ou l'etiquette brute) et son chemin. Couvre
/// les balises standard ET les balises custom de n'importe quel fournisseur.
fn line_fields(line: N, paths: &Paths) -> Vec<Value> {
    let mut fields = Vec::new();
    for el in line.descendants().filter(|n| n.is_element()) {
        let mut t = text(Some(el));
        if t.is_empty() {
            continue;
        }
        if t.chars().count() > 500 {
            t = t.chars().take(500).collect::<String>() + " …";
        }
        fields.push(json!({ "title": title_for(el), "value": t, "path": paths.of(Some(el)) }));
    }
    fields
}

static NOTE_SPLIT: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\s*\|\s*|\s*;\s*|\n").unwrap());
static NON_ALNUM: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[^0-9a-zA-Z]+").unwrap());

fn note_slug(label: &str) -> String {
    let s = NON_ALNUM.replace_all(label, "_").trim_matches('_').to_lowercase();
    format!("note_{}", if s.is_empty() { "autre" } else { &s })
}

/// Decoupe la note d'une ligne en paires (libelle, valeur) : segments separes
/// par " | ", ";" ou un retour a la ligne, de la forme "libelle : valeur" (le
/// PREMIER deux-points separe). Retourne (paires, segments non parseables).
fn note_items(note: &str) -> (Vec<(String, String)>, Vec<String>) {
    let mut pairs = Vec::new();
    let mut raw = Vec::new();
    for seg in NOTE_SPLIT.split(note) {
        let seg = seg.trim();
        if seg.is_empty() {
            continue;
        }
        match seg.split_once(':') {
            Some((label, val)) if !label.trim().is_empty() && !val.trim().is_empty() => {
                pairs.push((label.trim().to_string(), val.trim().to_string()));
            }
            _ => raw.push(seg.to_string()),
        }
    }
    (pairs, raw)
}

/// Ajoute aux cellules les colonnes dynamiques de note (cle note_<slug>) et la
/// cellule "note" pour les segments non parseables.
fn add_note_cells(cells: &mut Map<String, Value>, note_els: &[N], paths: &Paths) {
    let note_value = note_els.iter().map(|n| text(Some(*n))).collect::<Vec<_>>().join("   |   ");
    let anchor = note_els.first().copied();
    let (pairs, raw) = note_items(&note_value);
    let mut note_cells: Map<String, Value> = Map::new();
    for (label, value) in pairs {
        let base = note_slug(&label);
        let mut key = base.clone();
        let mut i = 2;
        while note_cells.contains_key(&key) {
            key = format!("{base}_{i}");
            i += 1;
        }
        note_cells.insert(key, paths.cell(&label, anchor, None, Some(value)));
    }
    cells.extend(note_cells);
    if !raw.is_empty() {
        cells.insert("note".into(), paths.cell("Note(s) de la ligne", anchor, None, Some(raw.join("   |   "))));
    }
}

/// Colonnes dynamiques de note (union des labels, ordre d'apparition).
fn note_columns(lines: &[Value]) -> Vec<Value> {
    let mut cols = Vec::new();
    let mut seen: Vec<&str> = Vec::new();
    for line in lines {
        let Some(cells) = line["cells"].as_object() else { continue };
        for (key, cell) in cells {
            if key.starts_with("note_") && !seen.contains(&key.as_str()) {
                seen.push(key);
                let title = cell["title"].as_str().filter(|t| !t.is_empty()).unwrap_or(key);
                cols.push(json!({ "key": key, "title": title, "align": "left" }));
            }
        }
    }
    cols
}

fn structured(
    header: Vec<Value>,
    sections: Vec<Value>,
    summary: Vec<Value>,
    lines_columns: Value,
    lines: Vec<Value>,
) -> Map<String, Value> {
    let note_cols = note_columns(&lines);
    let mut out = Map::new();
    out.insert("header".into(), header.into());
    out.insert("sections".into(), sections.into());
    out.insert("summary".into(), summary.into());
    out.insert("lines_columns".into(), lines_columns);
    out.insert("lines".into(), lines.into());
    out.insert("note_columns".into(), note_cols.into());
    out
}

// ------------------------------------------------------------------ extraction UBL

fn ubl_columns() -> Value {
    columns(&[
        ("id", "N°", "left"),
        ("orderline", "Ligne cde", "left"),
        ("orderref", "Réf. cde", "left"),
        ("customerref", "Réf. client", "left"),
        ("name", "Désignation", "left"),
        ("desc", "Description", "left"),
        ("itemid", "Réf. article", "left"),
        ("qty", "Quantité", "right"),
        ("price", "P.U. HT", "right"),
        ("taxrate", "TVA", "right"),
        ("taxamt", "TVA ligne", "right"),
        ("frais", "Frais / Remises", "right"),
        ("total", "Total HT", "right"),
        ("detail", "Détail", "left"),
    ])
}

fn ubl_party_block(name: &str, party: ON, paths: &Paths, include_id: bool) -> Value {
    let mut rows = Vec::new();
    if party.is_some() {
        let legal = find(party, "PartyLegalEntity");
        paths.add(&mut rows, "Raison sociale", find(find(party, "PartyName"), "Name"), None);
        paths.add(&mut rows, "Identifiant émetteur", find(party, "EndpointID"), None);
        if include_id {
            paths.add(&mut rows, "Identifiant client", find(find(party, "PartyIdentification"), "ID"), None);
        }
        paths.add(&mut rows, "Dénomination légale", find(legal, "RegistrationName"), None);
        paths.add(&mut rows, "SIREN / registre", find(legal, "CompanyID"), None);
        paths.add(&mut rows, "N° de TVA", find(find(party, "PartyTaxScheme"), "CompanyID"), None);
        let addr = find(party, "PostalAddress");
        paths.add(&mut rows, "Rue", find(addr, "StreetName"), None);
        paths.add(&mut rows, "Complément d'adresse", find(addr, "AdditionalStreetName"), None);
        paths.add(&mut rows, "Ville", find(addr, "CityName"), None);
        paths.add(&mut rows, "Code postal", find(addr, "PostalZone"), None);
        paths.add(&mut rows, "Département / Région", find(addr, "CountrySubentity"), None);
        paths.add(&mut rows, "Pays", find(find(addr, "Country"), "IdentificationCode"), None);
        let contact = find(party, "Contact");
        paths.add(&mut rows, "Contact", find(contact, "Name"), None);
        paths.add(&mut rows, "Téléphone", find(contact, "Telephone"), None);
        paths.add(&mut rows, "E-mail", find(contact, "ElectronicMail"), None);
    }
    section(name, rows)
}

fn ubl_line(line: N, paths: &Paths) -> Value {
    let line = Some(line);
    let item = find(line, "Item");
    let olr = find(line, "OrderLineReference");
    let orefer = find(olr, "OrderReference");
    let qty = find(line, "InvoicedQuantity");
    let price_el = find(find(line, "Price"), "PriceAmount");
    let pct = find(find(item, "ClassifiedTaxCategory"), "Percent");
    let total_el = find(line, "LineExtensionAmount");
    // TVA de la ligne : TaxTotal de la ligne si present, sinon calculee.
    let taxamt_el = find(find(line, "TaxTotal"), "TaxAmount");
    // AllowanceCharge de la ligne : detail informationnel (frais/remises),
    // JAMAIS soustrait du LineExtensionAmount (net autoritatif, EN 16931).
    let ac_first = find(line, "AllowanceCharge");
    let ac = line_allowance_charge(line.unwrap());
    let ac_cur = ac.cur.as_deref();
    let tot_cur = attr(total_el, "currencyID")
        .or_else(|| attr(price_el, "currencyID"))
        .or_else(|| ac.cur.clone());
    let tot_cur = tot_cur.as_deref();
    let both = ac.charges != 0.0 && ac.allowances != 0.0;
    // Colonne Frais : detail brut (charges / remises) si les deux sont presentes, sinon le net.
    let (ac_display, ac_note) = if both {
        let charges = fmt_ac(ac.charges, ac_cur);
        let allow = fmt_ac(ac.allowances, ac_cur);
        let reasons = if ac.reasons.is_empty() { String::new() } else { format!(" ({})", ac.reasons.join("; ")) };
        (
            format!("+{charges} / \u{2212}{allow}"),
            Some(format!("Charges +{charges} / Remises \u{2212}{allow}{reasons}")),
        )
    } else {
        (fmt_ac(ac.net, ac_cur), nonempty(Some(ac.reasons.join("; "))))
    };

    // --- Total ligne HT = LineExtensionAmount (net autoritatif) ---
    let mut total_note = None;
    let total_num = if total_el.is_some() {
        num(&text(total_el))
    } else if price_el.is_some() && qty.is_some() {
        match (num(&text(price_el)), num(&text(qty))) {
            (Some(p), Some(q)) => {
                total_note = Some("Calculé : P.U. x quantité".to_string());
                Some(p * q)
            }
            _ => None,
        }
    } else {
        None
    };
    let total_value = money_num(total_num, tot_cur);

    // --- PU HT = (Total ligne HT - frais/remises nets) / quantité ---
    // Deux conventions d'emetteurs coexistent :
    //  - Émetteur A : le LineExtensionAmount INCLUT les AllowanceCharge de la
    //    ligne -> PU de base = (Total ligne HT - frais) / quantité, les frais
    //    restant visibles dans la colonne "Frais / Remises".
    //  - Émetteur B : l'AllowanceCharge repete le montant de la ligne a titre
    //    informationnel (PU declare x quantité == LineExtensionAmount) -> on ne
    //    soustrait rien.
    // Test de distinction : si le PU declare est coherent avec le total ligne,
    // les frais sont informationnels ; sinon on les retire.
    let qty_text = text(qty);
    let qty_f = num(&qty_text).unwrap_or(0.0);
    let (pu_value, pu_note) = match total_num {
        Some(total) if qty_f > 0.0 => {
            let mut pu_base = total;
            if ac.net != 0.0 {
                let coherent = num(&text(price_el)).is_some_and(|pu| (pu * qty_f - total).abs() < 0.02);
                if !coherent {
                    pu_base = total - ac.net;
                }
            }
            let note = if pu_base != total && ac.net > 0.0 {
                format!(
                    "PU de base : (Total ligne HT - frais) / quantité : ({total:.2} - {:.2}) / {qty_text}",
                    ac.net
                )
            } else if pu_base != total && ac.net < 0.0 {
                format!(
                    "PU de base : (Total ligne HT + remise) / quantité : ({total:.2} + {:.2}) / {qty_text}",
                    -ac.net
                )
            } else {
                format!("Total ligne HT / quantité : {total:.2} / {qty_text}")
            };
            (Some(money_num(Some(pu_base / qty_f), tot_cur)), Some(note))
        }
        _ => (price_el.map(|_| money(price_el)), None),
    };

    // --- TVA de la ligne (TaxTotal de la ligne, sinon HT x taux) ---
    let mut tax_value = taxamt_el.map(|_| money(taxamt_el));
    let mut tax_note = None;
    if let (None, Some(_), Some(total)) = (&tax_value, pct, total_num) {
        let t = line_tax(&format!("{total:.2}"), &text(pct));
        if !t.is_empty() {
            tax_value = Some(match tot_cur {
                Some(c) => format!("{t} {c}"),
                None => t,
            });
            tax_note = Some(format!("Calculée : total ligne HT x {} %", text(pct)));
        }
    }

    let mut itemid_el = None;
    if item.is_some() {
        for tag in [
            "SellersItemIdentification",
            "BuyersItemIdentification",
            "ManufacturersItemIdentification",
            "ItemIdentification",
        ] {
            itemid_el = find(find(item, tag), "ID");
            if !text(itemid_el).is_empty() {
                break;
            }
        }
    }
    let desc_el = find(item, "Description");
    let name_el = find(item, "Name").filter(|n| !text(Some(*n)).is_empty()).or(desc_el);

    let mut cells = Map::new();
    cells.insert("id".into(), paths.cell("N° de ligne", find(line, "ID"), None, None));
    cells.insert(
        "orderline".into(),
        if olr.is_some() {
            paths.cell("Ligne de commande", find(olr, "LineID"), None, None)
        } else {
            empty("Ligne de commande")
        },
    );
    cells.insert(
        "orderref".into(),
        if orefer.is_some() {
            paths.cell("Réf. de commande", find(orefer, "ID"), None, None)
        } else {
            empty("Réf. de commande")
        },
    );
    cells.insert(
        "customerref".into(),
        if orefer.is_some() {
            paths.cell("Réf. client", find(orefer, "SalesOrderID"), None, None)
        } else {
            empty("Réf. client")
        },
    );
    cells.insert("name".into(), paths.cell_or_empty("Désignation", name_el));
    cells.insert("desc".into(), paths.cell_or_empty("Description", desc_el));
    cells.insert("itemid".into(), paths.cell_or_empty("Référence article", itemid_el));
    cells.insert(
        "qty".into(),
        if qty.is_some() { paths.cell("Quantité", qty, note_for(qty), None) } else { empty("Quantité") },
    );
    cells.insert(
        "price".into(),
        match nonempty(pu_value) {
            Some(v) => {
                let anchor = if pu_note.is_some() { total_el } else { price_el };
                paths.cell("Prix unitaire HT", anchor, pu_note, Some(v))
            }
            None => empty("Prix unitaire HT"),
        },
    );
    cells.insert("taxrate".into(), paths.cell_or_empty("Taux de TVA", pct));
    cells.insert(
        "taxamt".into(),
        match nonempty(tax_value) {
            Some(v) => paths.cell("TVA de la ligne", taxamt_el.or(total_el), tax_note, Some(v)),
            None => empty("TVA de la ligne"),
        },
    );
    cells.insert(
        "frais".into(),
        if ac.net != 0.0 || !ac.reasons.is_empty() {
            paths.cell("Frais / Remises (AllowanceCharge)", ac_first, ac_note, Some(ac_display))
        } else {
            empty("Frais / Remises (AllowanceCharge)")
        },
    );
    cells.insert(
        "total".into(),
        if total_value.is_empty() {
            empty("Total ligne HT")
        } else {
            paths.cell("Total ligne HT", total_el, total_note, Some(total_value))
        },
    );
    cells.insert("detail".into(), empty("Détail de la ligne"));

    // --- Note(s) de la ligne (cbc:Note) ---
    let note_els: Vec<N> = findall(line, "Note").into_iter().filter(|n| !text(Some(*n)).is_empty()).collect();
    add_note_cells(&mut cells, &note_els, paths);

    json!({ "cells": cells, "fields": line_fields(line.unwrap(), paths) })
}

fn extract_ubl(root: N, paths: &Paths, warnings: &mut Vec<String>) -> Map<String, Value> {
    let root = Some(root);
    let mut h = Vec::new();

    paths.addh(&mut h, "N° de facture", find(root, "ID"), None, None);
    paths.addh(
        &mut h,
        "Type de facture",
        find(root, "InvoiceTypeCode").or_else(|| find(root, "CreditNoteTypeCode")),
        None,
        None,
    );
    paths.addh(&mut h, "Date d'émission", find(root, "IssueDate"), None, None);
    paths.addh(&mut h, "Date d'échéance", find(root, "DueDate"), None, None);
    let profile = find(root, "ProfileID");
    paths.addh(
        &mut h,
        "Profil",
        profile,
        lookup(tables::PROFILES_UBL, &text(profile)).map(str::to_string),
        None,
    );
    paths.addh(&mut h, "Norme", find(root, "CustomizationID"), None, None);
    paths.addh(&mut h, "Devise", find(root, "DocumentCurrencyCode"), None, None);
    paths.addh(&mut h, "Réf. comptable interne", find(root, "AccountingCost"), None, None);
    paths.addh(&mut h, "Réf. acheteur", find(root, "BuyerReference"), None, None);
    paths.addh(&mut h, "Réf. commande vendeur", find(root, "SellerOrderReferencedDocumentID"), None, None);
    paths.addh(&mut h, "Réf. commande acheteur", find(root, "BuyerOrderReferencedDocumentID"), None, None);

    let period = find(root, "InvoicePeriod");
    if period.is_some() {
        let s = text(find(period, "StartDate"));
        let e = text(find(period, "EndDate"));
        if !s.is_empty() || !e.is_empty() {
            let v = format!("{s}  →  {e}").trim_matches(|c| c == ' ' || c == '→').to_string();
            paths.addh(&mut h, "Période de facturation", period, None, Some(v));
        } else {
            let code = text(find(period, "DescriptionCode"));
            if !code.is_empty() {
                paths.addh(&mut h, "Période de facturation", period, None, Some(format!("code {code}")));
            }
        }
    }
    for n in findall(root, "Note") {
        paths.addh(&mut h, "Note / mention", Some(n), None, None);
    }
    let orderref = find(root, "OrderReference");
    paths.addh(&mut h, "N° de commande", find(orderref, "ID"), None, None);
    paths.addh(&mut h, "Réf. commande client", find(orderref, "SalesOrderID"), None, None);
    paths.addh(&mut h, "Date de la commande", find(orderref, "IssueDate"), None, None);
    paths.addh(&mut h, "Réf. contrat", find(find(root, "ContractDocumentReference"), "ID"), None, None);
    for a in findall(root, "AdditionalDocumentReference") {
        paths.addh(&mut h, "Document complémentaire", find(Some(a), "ID"), None, None);
    }

    let mut sections = Vec::new();

    // parties
    sections.push(ubl_party_block("Vendeur", find(find(root, "AccountingSupplierParty"), "Party"), paths, false));
    sections.push(ubl_party_block("Acheteur", find(find(root, "AccountingCustomerParty"), "Party"), paths, true));

    // livraison
    let mut rows = Vec::new();
    let delivery = find(root, "Delivery");
    if delivery.is_some() {
        paths.add(&mut rows, "Date de livraison", find(delivery, "ActualDeliveryDate"), None);
        let addr = find(find(delivery, "DeliveryLocation"), "Address");
        paths.add(&mut rows, "Rue", find(addr, "StreetName"), None);
        paths.add(&mut rows, "Ville", find(addr, "CityName"), None);
        paths.add(&mut rows, "Code postal", find(addr, "PostalZone"), None);
        paths.add(&mut rows, "Département", find(addr, "CountrySubentity"), None);
        paths.add(&mut rows, "Pays", find(find(addr, "Country"), "IdentificationCode"), None);
        paths.add(
            &mut rows,
            "Destinataire",
            find(find(find(delivery, "DeliveryParty"), "PartyName"), "Name"),
            None,
        );
    }
    sections.push(section("Livraison", rows));

    // paiement
    let mut rows = Vec::new();
    let pmeans = find(root, "PaymentMeans");
    if pmeans.is_some() {
        let account = find(pmeans, "PayeeFinancialAccount");
        let branch = find(account, "FinancialInstitutionBranch");
        paths.add(&mut rows, "Mode de paiement", find(pmeans, "PaymentMeansCode"), None);
        paths.add(&mut rows, "Référence de paiement", find(pmeans, "PaymentID"), None);
        paths.add(&mut rows, "IBAN", find(account, "ID"), None);
        paths.add(&mut rows, "BIC", find(branch, "ID"), None);
        paths.add(&mut rows, "Banque", find(branch, "Name"), None);
    }
    let terms = find(root, "PaymentTerms");
    for (title, tag) in [("Conditions de paiement", "Note"), ("Date d'échéance", "DueDate")] {
        let el = find(terms, tag);
        let v = text(el);
        if !v.is_empty() {
            rows.push(row(title, v, paths.of(el), None));
        }
    }
    sections.push(section("Paiement", rows));

    // remises / majorations
    let mut rows = Vec::new();
    for (tag, amount_tag, name) in
        [("Allowance", "AllowanceAmount", "Remise"), ("Charge", "ChargeAmount", "Majoration")]
    {
        for a in findall(root, tag) {
            let amt = find(Some(a), amount_tag);
            if !text(amt).is_empty() {
                rows.push(row(name, money(amt), paths.of(Some(a)), None));
            }
        }
    }
    for (tag, reason_tag, name) in
        [("AllowanceBasis", "AllowanceReason", "Remise"), ("ChargeBasis", "ChargeReason", "Majoration")]
    {
        for b in findall(root, tag) {
            let reason = text(find(Some(b), reason_tag));
            if !reason.is_empty() {
                rows.push(row(name, reason, paths.of(Some(b)), None));
            }
        }
    }
    if !rows.is_empty() {
        sections.push(section("Remises et majorations", rows));
    }

    // totaux
    let mut rows = Vec::new();
    let ttotal = find(root, "TaxTotal");
    if ttotal.is_some() {
        for sub in findall(ttotal, "TaxSubtotal") {
            let sub = Some(sub);
            let pct = text(find(find(sub, "TaxCategory"), "Percent"));
            let base = money(find(sub, "TaxableAmount"));
            let label = if pct.is_empty() { "TVA".to_string() } else { format!("TVA {pct} %") };
            let note = if base.is_empty() { None } else { Some(format!("Base imposable : {base}")) };
            rows.push(row(&label, money(find(sub, "TaxAmount")), paths.of(sub), note));
        }
        let total = find(ttotal, "TaxAmount");
        if total.is_some() {
            rows.push(row("Total TVA", money(total), paths.of(total), None));
        }
    }
    let lmt = find(root, "LegalMonetaryTotal");
    for (title, tag) in [
        ("Total HT", "TaxExclusiveAmount"),
        ("Total lignes", "LineExtensionAmount"),
        ("Total TTC", "TaxInclusiveAmount"),
        ("À payer", "PayableAmount"),
        ("Prépayé", "PrepaidAmount"),
    ] {
        let el = find(lmt, tag);
        if !text(el).is_empty() {
            rows.push(row(title, money(el), paths.of(el), None));
        }
    }
    sections.push(section("Totaux", rows));

    // lignes
    let line_tag = ["InvoiceLine", "CreditNoteLine"].into_iter().find(|t| find(root, t).is_some());
    let lines: Vec<Value> = match line_tag {
        Some(tag) => findall(root, tag).into_iter().map(|l| ubl_line(l, paths)).collect(),
        None => Vec::new(),
    };
    if lines.is_empty() {
        warnings.push("Aucune ligne de facture détectée.".into());
    }

    // resume
    let totals = sections.last().unwrap();
    let summary = summary(vec![
        ("N° de facture", value_of(&h, "N° de facture")),
        ("Date d'émission", value_of(&h, "Date d'émission")),
        ("Échéance", value_of(&h, "Date d'échéance")),
        ("Vendeur", section_value(&sections[0], "Raison sociale")),
        ("Acheteur", section_value(&sections[1], "Raison sociale")),
        ("Total HT", section_value(totals, "Total HT")),
        ("Total TVA", section_value(totals, "Total TVA")),
        ("Total TTC", section_value(totals, "Total TTC")),
        ("À payer", section_value(totals, "À payer")),
    ]);
    structured(h, sections, summary, ubl_columns(), lines)
}

// ------------------------------------------------------------------ extraction CII

fn cii_columns() -> Value {
    columns(&[
        ("id", "N°", "left"),
        ("name", "Désignation", "left"),
        ("desc", "Description", "left"),
        ("itemid", "Réf. article", "left"),
        ("qty", "Quantité", "right"),
        ("price", "P.U. HT", "right"),
        ("taxrate", "TVA", "right"),
        ("taxamt", "TVA ligne", "right"),
        ("total", "Total HT", "right"),
        ("detail", "Détail", "left"),
    ])
}

fn cii_party_block(name: &str, party: ON, paths: &Paths) -> Value {
    let mut rows = Vec::new();
    if party.is_some() {
        let reg = find(party, "SpecifiedTaxRegistration");
        paths.add(&mut rows, "Raison sociale", find(party, "Name"), None);
        paths.add(&mut rows, "N° de TVA", find(reg, "ID"), attr(reg, "schemeID"));
        paths.add(&mut rows, "Identifiant légal", find(find(party, "SpecifiedLegalOrganization"), "ID"), None);
        let addr = find(party, "PostalTradeAddress");
        paths.add(&mut rows, "Rue", find(addr, "LineOne"), None);
        paths.add(&mut rows, "Complément d'adresse", find(addr, "LineTwo"), None);
        paths.add(&mut rows, "Ville", find(addr, "CityName"), None);
        paths.add(&mut rows, "Code postal", find_alt(addr, &["Postcode", "PostcodeCode"]), None);
        paths.add(&mut rows, "Département", find(addr, "CountrySubentity"), None);
        paths.add(&mut rows, "Pays", find(addr, "CountryID"), None);
        let contact = find(party, "DefinedTradeContact");
        paths.add(&mut rows, "Contact", find(contact, "PersonName"), None);
        paths.add(&mut rows, "Téléphone", find(contact, "TelephoneNumber"), None);
        paths.add(&mut rows, "E-mail", find(contact, "ElectronicMail"), None);
    }
    section(name, rows)
}

fn cii_line(li: N, paths: &Paths) -> Value {
    let li = Some(li);
    let product = find_alt(li, &["DefinedTradeProduct", "SpecifiedTradeProduct"]);
    let agr = find_alt(li, &["SpecifiedLineTradeAgreement", "IncludedLineTradeAgreement"]);
    let tr = find(li, "SpecifiedLineTradeTransaction");
    let dl = find_alt(li, &["SpecifiedLineTradeDelivery", "IncludedLineTradeDelivery"]);
    let st = find_alt(li, &["SpecifiedLineTradeSettlement", "IncludedLineTradeSettlement"]);
    let qty = find(tr, "InvoicedQuantity").or_else(|| find(dl, "BilledQuantity"));
    let price_el = find(find(agr, "NetPrice"), "ChargeAmount")
        .or_else(|| find(find(agr, "NetPriceProductTradePrice"), "ChargeAmount"));
    let total_el = find(tr, "LineExtensionAmount")
        .or_else(|| find(find(st, "SpecifiedTradeSettlementLineMonetarySummation"), "LineTotalAmount"));
    let line_tax_el = find(st, "ApplicableTradeTax");
    let tax_el = find(st, "CalculatedAmount").or_else(|| find(line_tax_el, "CalculatedAmount"));
    let pct_el = find(line_tax_el, "RateApplicablePercent").or_else(|| find(st, "RateApplicablePercent"));
    let itemid_el = find_alt(product, &["SellerAssignedID", "BuyerAssignedID"]);
    let name_el = find(li, "Name").or_else(|| find(product, "Name"));
    let desc_el = find(li, "Description").or_else(|| find(product, "Description"));

    // PU HT : LineExtensionAmount / quantité si possible, sinon NetPrice.
    let mut pu_value = price_el.map(|_| cii_money(price_el));
    let mut pu_note = None;
    let total_value = cii_money(total_el);
    if total_el.is_some() && qty.is_some() {
        if let (Some(tq), Some(tv)) = (num(&text(qty)), num(&text(total_el))) {
            if tq > 0.0 {
                let cur = attr(total_el, "currencyID").or_else(|| attr(price_el, "currencyID"));
                pu_value = Some(money_num(Some(tv / tq), cur.as_deref()));
                pu_note = Some(format!("Total ligne HT / quantité : {} / {}", text(total_el), text(qty)));
            }
        }
    }

    // TVA de la ligne : CalculatedAmount si present, sinon total HT x taux / 100.
    let mut tax_value = cii_money(tax_el);
    let mut tax_note = None;
    if tax_value.is_empty() && total_el.is_some() && pct_el.is_some() {
        let t = line_tax(&text(total_el), &text(pct_el));
        if !t.is_empty() {
            tax_value = match attr(total_el, "currencyID") {
                Some(cur) => format!("{t} {cur}"),
                None => t,
            };
            tax_note = Some("Calcul : total ligne HT x taux / 100".to_string());
        }
    }

    let mut note_els: Vec<N> = findall(li, "Note").into_iter().filter(|n| !text(Some(*n)).is_empty()).collect();
    if note_els.is_empty() {
        note_els = findall(li, "IncludedNote")
            .into_iter()
            .filter_map(|n| find(Some(n), "Content"))
            .filter(|c| !text(Some(*c)).is_empty())
            .collect();
    }

    let lineid_el = find(li, "LineID").or_else(|| find(find(li, "AssociatedDocumentLineDocument"), "LineID"));

    let mut cells = Map::new();
    cells.insert("id".into(), paths.cell_or_empty("N° de ligne", lineid_el));
    cells.insert("name".into(), paths.cell_or_empty("Désignation", name_el));
    cells.insert("desc".into(), paths.cell_or_empty("Description", desc_el));
    cells.insert("itemid".into(), paths.cell_or_empty("Référence article", itemid_el));
    cells.insert(
        "qty".into(),
        if qty.is_some() { paths.cell("Quantité", qty, note_for(qty), None) } else { empty("Quantité") },
    );
    cells.insert(
        "price".into(),
        match nonempty(pu_value) {
            Some(v) => {
                let anchor = if pu_note.is_some() { total_el } else { price_el };
                paths.cell("Prix unitaire HT", anchor, pu_note, Some(v))
            }
            None => empty("Prix unitaire HT"),
        },
    );
    cells.insert("taxrate".into(), paths.cell_or_empty("Taux de TVA", pct_el));
    cells.insert(
        "taxamt".into(),
        if tax_value.is_empty() {
            empty("TVA de la ligne")
        } else {
            paths.cell("TVA de la ligne", tax_el, tax_note, Some(tax_value))
        },
    );
    cells.insert(
        "total".into(),
        if total_value.is_empty() {
            empty("Total ligne HT")
        } else {
            paths.cell("Total ligne HT", total_el, None, Some(total_value))
        },
    );
    cells.insert("detail".into(), empty("Détail de la ligne"));
    add_note_cells(&mut cells, &note_els, paths);

    json!({ "cells": cells, "fields": line_fields(li.unwrap(), paths) })
}

fn extract_cii(root: N, paths: &Paths, warnings: &mut Vec<String>) -> Map<String, Value> {
    let root = Some(root);
    let doc = find(root, "ExchangedDocument");
    let ctx = find(root, "ExchangedDocumentContext");
    let txn = find(root, "SupplyChainTradeTransaction");
    if doc.is_none() || txn.is_none() {
        warnings.push("Structure CII inattendue, seules les données brutes sont disponibles.".into());
        let mut out = structured(Vec::new(), Vec::new(), Vec::new(), cii_columns(), Vec::new());
        out.shift_remove("note_columns");
        return out;
    }
    let agreement = find_alt(txn, &["ApplicableTradeAgreement", "ApplicableHeaderTradeAgreement"]);
    let delivery = find_alt(txn, &["ApplicableTradeDelivery", "ApplicableHeaderTradeDelivery"]);
    let settlement = find_alt(txn, &["ApplicableTradeSettlement", "ApplicableHeaderTradeSettlement"]);
    let terms = find(settlement, "SpecifiedTradePaymentTerms");

    let mut h = Vec::new();
    let addh_date = |h: &mut Vec<Value>, title: &str, el: ON| {
        let v = date_text(el);
        if !v.is_empty() {
            paths.addh(h, title, el, None, Some(v));
        }
    };

    paths.addh(&mut h, "N° de facture", find(doc, "ID"), None, None);
    paths.addh(&mut h, "Type de facture", find(doc, "TypeCode"), None, None);
    addh_date(&mut h, "Date d'émission", find(doc, "IssueDateTime"));
    addh_date(
        &mut h,
        "Date d'échéance",
        find(doc, "DueDateDateTime").or_else(|| find(terms, "DueDateDateTime")),
    );
    paths.addh(
        &mut h,
        "Devise",
        find(doc, "DocumentCurrencyCode").or_else(|| find(settlement, "InvoiceCurrencyCode")),
        None,
        None,
    );
    paths.addh(&mut h, "Nombre de lignes", find(doc, "LineCountNumeric"), None, None);
    for n in findall(doc, "Note") {
        paths.addh(&mut h, "Note / mention", Some(n), None, None);
    }
    for n in findall(doc, "IncludedNote") {
        let content = find(Some(n), "Content");
        if !text(content).is_empty() {
            paths.addh(&mut h, "Note / mention", content, None, None);
        }
    }
    let gp = find(find(ctx, "GuidelineSpecifiedDocumentContextParameter"), "ID");
    if gp.is_some() {
        let profile = lookup(tables::PROFILES_CII, &text(gp)).unwrap_or("EN 16931");
        paths.addh(&mut h, "Profil", gp, Some(profile.to_string()), None);
    }
    for line in findall(find(doc, "BuyerReference"), "Line") {
        paths.addh(&mut h, "Référence acheteur / commande", find(Some(line), "ID"), None, None);
    }
    let order_ref = find(find(agreement, "BuyerOrderReferencedDocument"), "IssuerAssignedID");
    if !text(order_ref).is_empty() {
        paths.addh(&mut h, "Référence acheteur / commande", order_ref, None, None);
    }
    let period = find(doc, "IncludedPeriod").or_else(|| find(settlement, "BillingSpecifiedPeriod"));
    if period.is_some() {
        let s = date_text(find(period, "StartDateTime"));
        let e = date_text(find(period, "EndDateTime"));
        if !s.is_empty() || !e.is_empty() {
            let v = format!("{s}  →  {e}").trim_matches(|c| c == ' ' || c == '→').to_string();
            paths.addh(&mut h, "Période", period, None, Some(v));
        }
    }

    let mut sections = vec![
        cii_party_block("Vendeur", find_alt(agreement, &["Seller", "SellerTradeParty"]), paths),
        cii_party_block("Acheteur", find_alt(agreement, &["Buyer", "BuyerTradeParty"]), paths),
    ];

    // livraison
    let mut rows = Vec::new();
    let occurrence = find(find(delivery, "ActualSupplyChainEvent"), "OccurrenceDateTime");
    let v = date_text(occurrence);
    if !v.is_empty() {
        rows.push(row("Date de livraison", v, paths.of(occurrence), None));
    }
    let supplier = find(
        find_alt(delivery, &["SpecifiedLogisticsSupplier", "SpecifiedLogisticsServiceProvider"]),
        "Name",
    );
    if !text(supplier).is_empty() {
        rows.push(row("Destinataire", text(supplier), paths.of(supplier), None));
    }
    sections.push(section("Livraison", rows));

    // paiement
    let mut rows = Vec::new();
    if settlement.is_some() {
        let means = find_alt(settlement, &["PaymentMeans", "SpecifiedTradeSettlementPaymentMeans"]);
        paths.add(
            &mut rows,
            "Mode de paiement",
            find(means, "TypeCode"),
            nonempty(Some(text(find(means, "Information")))),
        );
        let accounts = ["PayeePartyCreditAccount", "PayeePartyCreditorFinancialAccount"];
        let payee = find_alt(settlement, &accounts).or_else(|| find_alt(means, &accounts));
        paths.add(&mut rows, "IBAN", find_alt(payee, &["ID", "IBANID"]), None);
        paths.add(&mut rows, "Titre du compte", find(payee, "AccountName"), None);
        let bank = find(settlement, "PayeeSpecifiedCreditorFinancialInstitution")
            .or_else(|| find(means, "PayeeSpecifiedCreditorFinancialInstitution"));
        paths.add(&mut rows, "BIC", find(bank, "BICID"), None);
        paths.add(&mut rows, "Conditions de paiement", find(terms, "Description"), None);
        paths.add(&mut rows, "Mandat SEPA", find(terms, "DirectDebitMandateID"), None);
    }
    sections.push(section("Paiement", rows));

    // totaux
    let mut rows = Vec::new();
    if settlement.is_some() {
        for tax in findall(settlement, "ApplicableTradeTax") {
            let tax = Some(tax);
            let amt = find(tax, "CalculatedAmount");
            let category = find(tax, "CategoryTradeTax");
            let cat = find(category, "TypeCode").or_else(|| find(tax, "CategoryCode"));
            let pct = find(category, "RateApplicablePercent").or_else(|| find(tax, "RateApplicablePercent"));
            let mut label = "TVA".to_string();
            if !text(pct).is_empty() {
                label += &format!(" {} %", text(pct));
            }
            if let Some(name) = lookup(tables::TAX_CATEGORIES, &text(cat)) {
                label += &format!(" — {name}");
            }
            if !text(amt).is_empty() {
                rows.push(row(&label, cii_money(amt), paths.of(amt), None));
            }
        }
        let summation = find(settlement, "SpecifiedTradeSettlementHeaderMonetarySummation");
        for (title, keys) in [
            ("Total HT", ["LineTotalAmount", "TaxBasisTotalAmount"]),
            ("Total TTC", ["TotalAmount", "GrandTotalAmount"]),
            ("À payer", ["DuePayableAmount", "NetPayableAmount"]),
        ] {
            let el = keys.iter().find_map(|k| {
                find(settlement, k).or_else(|| find(summation, k)).filter(|c| !text(Some(*c)).is_empty())
            });
            if el.is_some() {
                rows.push(row(title, cii_money(el), paths.of(el), None));
            }
        }
    }
    sections.push(section("Totaux", rows));

    let lines: Vec<Value> = findall_alt(txn, &["SpecifiedTradeLineItem", "IncludedSupplyChainTradeLineItem"])
        .into_iter()
        .map(|li| cii_line(li, paths))
        .collect();
    if lines.is_empty() {
        warnings.push("Aucune ligne de facture détectée.".into());
    }

    let totals = sections.last().unwrap();
    let summary = summary(vec![
        ("N° de facture", value_of(&h, "N° de facture")),
        ("Date d'émission", value_of(&h, "Date d'émission")),
        ("Échéance", value_of(&h, "Date d'échéance")),
        ("Vendeur", section_value(&sections[0], "Raison sociale")),
        ("Acheteur", section_value(&sections[1], "Raison sociale")),
        ("Total HT", section_value(totals, "Total HT")),
        ("Total TTC", section_value(totals, "Total TTC")),
        ("À payer", section_value(totals, "À payer")),
    ]);
    structured(h, sections, summary, cii_columns(), lines)
}

// ------------------------------------------------------------------ dump complet

fn b64_decode(s: &str) -> Option<Vec<u8>> {
    let cleaned: Vec<u8> = s
        .bytes()
        .filter(|b| b.is_ascii_alphanumeric() || matches!(b, b'+' | b'/' | b'='))
        .collect();
    base64::engine::general_purpose::STANDARD.decode(&cleaned).ok()
}

fn b64_encode(data: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(data)
}

/// Table de TOUTES les valeurs de l'XML (chemin, etiquette, libelle, valeur).
fn build_rows(root: N, paths: &Paths) -> Vec<Value> {
    let mut rows = Vec::new();
    for el in root.descendants().filter(|n| n.is_element()) {
        let t = text(Some(el));
        let mut attrs = Map::new();
        for a in el.attributes() {
            let key = match a.namespace() {
                Some(ns) => format!("{{{ns}}}{}", a.name()),
                None => a.name().to_string(),
            };
            attrs.insert(key, a.value().into());
        }
        if t.is_empty() && attrs.is_empty() {
            continue;
        }
        let name = local(el);
        let mut r = Map::new();
        r.insert("path".into(), paths.of(Some(el)).into());
        r.insert("tag".into(), name.into());
        r.insert("title".into(), title_for(el).into());
        if name == "EmbeddedDocumentBinaryObject" {
            let size = b64_decode(&t).map(|raw| raw.len()).unwrap_or(0);
            r.insert("binary".into(), true.into());
            r.insert(
                "value".into(),
                format!("Document binaire intégré ({} octets)", thousands(size)).into(),
            );
            r.insert("size".into(), size.into());
            r.insert("truncated".into(), true.into());
        } else {
            let long = t.chars().count() > 400;
            r.insert("value".into(), t.into());
            if !attrs.is_empty() {
                r.insert("attrs".into(), attrs.into());
            }
            if long {
                r.insert("truncated".into(), true.into());
            }
        }
        rows.push(Value::Object(r));
    }
    rows
}

static BASE64_TEXT: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[A-Za-z0-9+/\s=]+$").unwrap());

fn escape_text(s: &str, out: &mut String) {
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            c => out.push(c),
        }
    }
}

/// Balise ouvrante telle qu'ecrite dans la source (prefixes et attributs
/// d'origine), sans le `<`, le `>` ni le `/` final, blancs normalises.
fn start_tag(el: N, source: &str) -> String {
    let bytes = source.as_bytes();
    let start = el.range().start + 1;
    let mut end = start;
    let mut quote = None;
    while end < bytes.len() {
        match (quote, bytes[end]) {
            (None, b'>') => break,
            (None, q @ (b'"' | b'\'')) => quote = Some(q),
            (Some(q), b) if b == q => quote = None,
            _ => {}
        }
        end += 1;
    }
    let raw = source[start..end].trim_end().trim_end_matches('/');
    let mut out = String::with_capacity(raw.len());
    let mut quote = None;
    let mut pending_space = false;
    for c in raw.chars() {
        if quote.is_none() && c.is_whitespace() {
            pending_space = true;
            continue;
        }
        if pending_space && !out.is_empty() {
            out.push(' ');
        }
        pending_space = false;
        match quote {
            None if c == '"' || c == '\'' => quote = Some(c),
            Some(q) if c == q => quote = None,
            _ => {}
        }
        out.push(c);
    }
    out
}

fn write_element(el: N, source: &str, depth: usize, out: &mut String) {
    let tag = start_tag(el, source);
    let qname = tag.split(' ').next().unwrap_or("").to_string();
    out.push('<');
    out.push_str(&tag);

    let mut body = el.text().unwrap_or("").to_string();
    // Les gros blocs base64 (PDF intégré) sont abreges.
    if body.chars().count() > 500 {
        let s = body.trim();
        if BASE64_TEXT.is_match(s) {
            body = format!(
                "{} … [{} caractères de données binaires (base64)]",
                &s[..80],
                s.chars().count()
            );
        }
    }
    let children: Vec<N> = elements(el).collect();
    if children.is_empty() {
        if body.trim().is_empty() {
            out.push_str("/>");
        } else {
            out.push('>');
            escape_text(&body, out);
            out.push_str("</");
            out.push_str(&qname);
            out.push('>');
        }
        return;
    }
    out.push('>');
    escape_text(body.trim(), out);
    for child in children {
        out.push('\n');
        out.push_str(&"  ".repeat(depth + 1));
        write_element(child, source, depth + 1, out);
        if let Some(tail) = child.next_sibling().filter(|n| n.is_text()).and_then(|n| n.text()) {
            escape_text(tail.trim(), out);
        }
    }
    out.push('\n');
    out.push_str(&"  ".repeat(depth));
    out.push_str("</");
    out.push_str(&qname);
    out.push('>');
}

/// XML reindente (2 espaces), prefixes d'espaces de noms d'origine conserves.
fn pretty_xml(root: N, source: &str) -> String {
    let mut out = String::with_capacity(source.len());
    write_element(root, source, 0, &mut out);
    out
}

// ------------------------------------------------------------------ PDF intégré au XML

fn extract_pdf(root: N) -> Option<(Vec<u8>, Option<String>)> {
    for el in root.descendants().filter(|n| n.is_element()) {
        if local(el) != "EmbeddedDocumentBinaryObject" {
            continue;
        }
        let t = text(Some(el));
        if t.is_empty() {
            continue;
        }
        if let Some(raw) = b64_decode(&t) {
            if raw.starts_with(b"%PDF-") {
                return Some((raw, attr(Some(el), "filename")));
            }
        }
    }
    None
}

// ------------------------------------------------------------------ XML

fn lstrip(data: &[u8]) -> &[u8] {
    let start = data.iter().position(|b| !b.is_ascii_whitespace()).unwrap_or(data.len());
    &data[start..]
}

fn looks_like_xml(data: &[u8]) -> bool {
    let d = lstrip(data);
    let d = d.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(d);
    d.first() == Some(&b'<') || d.starts_with(b"\xFF\xFE") || d.starts_with(b"\xFE\xFF")
}

/// Decode les octets d'un XML : UTF-8 (avec ou sans BOM), UTF-16 (avec BOM),
/// sinon repli Latin-1.
fn decode_xml(data: &[u8]) -> String {
    let utf16 = |le: bool, d: &[u8]| {
        let units = d
            .chunks_exact(2)
            .map(|c| if le { u16::from_le_bytes([c[0], c[1]]) } else { u16::from_be_bytes([c[0], c[1]]) });
        char::decode_utf16(units).map(|r| r.unwrap_or('\u{FFFD}')).collect::<String>()
    };
    if let Some(d) = data.strip_prefix(b"\xFF\xFE") {
        return utf16(true, d);
    }
    if let Some(d) = data.strip_prefix(b"\xFE\xFF") {
        return utf16(false, d);
    }
    let d = data.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(data);
    match std::str::from_utf8(d) {
        Ok(s) => s.to_string(),
        Err(_) => d.iter().map(|&b| b as char).collect(),
    }
}

fn parse_xml(source: &str) -> Result<Document<'_>, FacturXError> {
    let options = ParsingOptions { allow_dtd: true, ..ParsingOptions::default() };
    Document::parse_with_options(source, options).map_err(|e| FacturXError(format!("XML invalide : {e}")))
}

// ------------------------------------------------------------------ ZIP (Factur-X CII)

struct Extracted {
    xml: Vec<u8>,
    xml_name: Option<String>,
    pdf: Option<(Vec<u8>, String)>,
}

fn parse_zip(data: &[u8]) -> Result<Extracted, FacturXError> {
    let mut zf = zip::ZipArchive::new(Cursor::new(data))
        .map_err(|e| FacturXError(format!("Archive ZIP invalide : {e}")))?;
    let names: Vec<String> = (0..zf.len())
        .filter_map(|i| zf.by_index_raw(i).ok().map(|f| f.name().to_string()))
        .collect();
    let mut xml_name: Option<&String> = None;
    for n in &names {
        let ln = n.to_lowercase();
        if ln.ends_with(".xml") && (xml_name.is_none() || ln.contains("factur") || ln.contains("en16931")) {
            xml_name = Some(n);
        }
    }
    let xml_name = xml_name.ok_or_else(|| FacturXError("Aucun fichier XML trouvé dans l'archive ZIP.".into()))?;
    let mut read = |name: &str| -> Result<Vec<u8>, FacturXError> {
        let mut buf = Vec::new();
        zf.by_name(name)
            .map_err(|e| FacturXError(format!("Archive ZIP invalide : {e}")))?
            .read_to_end(&mut buf)
            .map_err(|e| FacturXError(format!("Archive ZIP invalide : {e}")))?;
        Ok(buf)
    };
    let xml = read(xml_name)?;
    let pdf = match names.iter().find(|n| n.to_lowercase().ends_with(".pdf")) {
        Some(n) => Some((read(n)?, n.clone())),
        None => None,
    };
    Ok(Extracted { xml, xml_name: Some(xml_name.clone()), pdf })
}

// ------------------------------------------------------------------ PDF (Factur-X)

/// Decodages plausibles d'un flux PDF (zlib, deflate brut, puis tel quel).
fn decompress_candidates(blob: &[u8]) -> Vec<Vec<u8>> {
    let mut out = Vec::new();
    let mut buf = Vec::new();
    if flate2::read::ZlibDecoder::new(blob).read_to_end(&mut buf).is_ok() {
        out.push(std::mem::take(&mut buf));
    }
    buf.clear();
    if flate2::read::DeflateDecoder::new(blob).read_to_end(&mut buf).is_ok() {
        out.push(buf);
    }
    out.push(blob.to_vec());
    out
}

/// Vrai si le blob est un XML de facture (UBL ou CII) — et non du XMP/binaire.
fn is_invoice_xml(blob: &[u8]) -> bool {
    if blob.len() < 64 || lstrip(blob).first() != Some(&b'<') {
        return false;
    }
    let head = &blob[..blob.len().min(300)];
    let contains = |needle: &[u8]| head.windows(needle.len()).any(|w| w == needle);
    if contains(b"xpacket") || contains(b"xmpmeta") {
        return false;
    }
    let source = decode_xml(blob);
    match parse_xml(&source) {
        Ok(doc) => matches!(local(doc.root_element()), "Invoice" | "CreditNote" | "CrossIndustryInvoice"),
        Err(_) => false,
    }
}

static PDF_FILESPEC_NAME: LazyLock<BytesRegex> =
    LazyLock::new(|| BytesRegex::new(r"(?s-u)/Type\s*/Filespec.*?/UF\s*\(([^()]+)\)").unwrap());
static PDF_FILESPEC_REF: LazyLock<BytesRegex> = LazyLock::new(|| {
    BytesRegex::new(r"(?s-u)/Type\s*/Filespec.*?/EF\s*<<[^>]*?/\s*(?:F|UF)\s+(\d+)\s+0\s+R").unwrap()
});
static PDF_STREAM: LazyLock<BytesRegex> =
    LazyLock::new(|| BytesRegex::new(r"(?s-u)stream\r?\n(.*?)\r?\nendstream").unwrap());

/// Flux de l'objet PDF numero `n` (premiere occurrence de "n 0 obj").
fn pdf_object_stream(data: &[u8], n: &[u8]) -> Option<Vec<u8>> {
    let mut needle = n.to_vec();
    needle.extend_from_slice(b" 0 obj");
    let pos = data
        .windows(needle.len())
        .enumerate()
        .find(|(i, w)| *w == needle.as_slice() && (*i == 0 || !data[*i - 1].is_ascii_digit()))
        .map(|(i, _)| i)?;
    PDF_STREAM.captures(&data[pos..]).map(|c| c[1].to_vec())
}

/// Extrait le XML de facture embarqué dans un PDF Factur-X.
///
/// Chemin principal : pièce jointe declaree dans l'objet /Filespec (champ /UF
/// et référence /EF). Repli : scan de tous les flux du PDF.
fn extract_pdf_xml(data: &[u8]) -> Result<(Vec<u8>, String), FacturXError> {
    let xml_name: Option<String> = PDF_FILESPEC_NAME
        .captures(data)
        .map(|c| c[1].iter().map(|&b| b as char).collect());

    if let Some(name) = &xml_name {
        let stream = PDF_FILESPEC_REF.captures(data).and_then(|c| pdf_object_stream(data, &c[1]));
        if let Some(stream) = stream {
            for cand in decompress_candidates(&stream) {
                if is_invoice_xml(&cand) {
                    return Ok((cand, name.clone()));
                }
            }
        }
    }

    for c in PDF_STREAM.captures_iter(data) {
        for cand in decompress_candidates(&c[1]) {
            if is_invoice_xml(&cand) {
                return Ok((cand, xml_name.unwrap_or_else(|| "factur-x.xml".into())));
            }
        }
    }

    Err(FacturXError(
        "PDF sans XML de facture intégré : aucune pièce jointe UBL/CII trouvée (ce n'est pas une facture Factur-X ?)"
            .into(),
    ))
}

// ------------------------------------------------------------------ facade

fn pdf_entry(bytes: &[u8], filename: &str) -> Value {
    json!({ "base64": b64_encode(bytes), "filename": filename, "size": bytes.len() })
}

/// Analyse un fichier (PDF Factur-X, ZIP Factur-X ou XML UBL/CII) et retourne
/// un objet JSON : données structurees + PDF en base64 + XML complet.
pub fn parse_file(filename: &str, data: &[u8]) -> Result<Value, FacturXError> {
    let mut warnings: Vec<String> = Vec::new();
    let (kind, extracted) = if data.starts_with(b"PK\x03\x04") {
        let extracted = parse_zip(data)?;
        warnings.push(format!(
            "XML extrait de l'archive : {}",
            extracted.xml_name.as_deref().unwrap_or_default()
        ));
        ("zip", extracted)
    } else if data.starts_with(b"%PDF-") {
        let (xml, xml_name) = extract_pdf_xml(data)?;
        warnings.push(format!("XML extrait de la pièce jointe du PDF : {xml_name}"));
        ("pdf", Extracted { xml, xml_name: Some(xml_name), pdf: Some((data.to_vec(), filename.to_string())) })
    } else if looks_like_xml(data) {
        ("xml", Extracted { xml: lstrip(data).to_vec(), xml_name: None, pdf: None })
    } else {
        return Err(FacturXError(
            "Format non reconnu : ni PDF (Factur-X), ni archive ZIP, ni XML UBL/CII.".into(),
        ));
    };

    let source = decode_xml(&extracted.xml);
    let doc = parse_xml(&source)?;
    let root = doc.root_element();
    let paths = Paths::build(root);
    let xml_pdf = extract_pdf(root);
    // Pour un XML seul, le PDF principal est celui embarqué dans le XML.
    let main_pdf: Option<(Vec<u8>, String)> = match (kind, extracted.pdf) {
        ("xml", _) => xml_pdf.clone().map(|(raw, name)| (raw, name.unwrap_or_else(|| "facture.pdf".into()))),
        (_, pdf) => pdf,
    };

    let root_local = local(root);
    let (format, mut structured) = match root_local {
        "Invoice" | "CreditNote" => ("UBL", extract_ubl(root, &paths, &mut warnings)),
        "CrossIndustryInvoice" => ("CII", extract_cii(root, &paths, &mut warnings)),
        _ => {
            warnings.push(format!(
                "Document XML inattendu (racine : {root_local}) — seule la table brute est disponible."
            ));
            let mut out = Map::new();
            for key in ["header", "sections", "summary", "lines_columns", "lines"] {
                out.insert(key.into(), json!([]));
            }
            ("XML", out)
        }
    };

    if main_pdf.is_none() {
        warnings.push("Aucun PDF intégré trouvé dans ce fichier.".into());
    }

    // Controles de coherence, seulement si la structure de la facture a ete reconnue.
    let recognized = structured.get("header").and_then(Value::as_array).is_some_and(|h| !h.is_empty());
    if recognized && format != "XML" {
        let today = chrono::Local::now().date_naive();
        let (checks, synthese) = controles::run(root, format, &paths, &structured, today);
        structured.insert("controles".into(), checks.into());
        structured.insert("synthese".into(), synthese);
        structured.insert("regles".into(), en16931::run(root, format, &paths));
    }

    let mut result = Map::new();
    result.insert("kind".into(), kind.into());
    result.insert("format".into(), format.into());
    result.insert("root".into(), root_local.into());
    result.insert("filename".into(), filename.into());
    result.insert(
        "doc_hash".into(),
        Sha256::digest(&extracted.xml).iter().map(|b| format!("{b:02x}")).collect::<String>().into(),
    );
    result.insert(
        "pdf".into(),
        main_pdf.as_ref().map(|(raw, name)| pdf_entry(raw, name)).unwrap_or(Value::Null),
    );
    result.insert("warnings".into(), warnings.into());
    result.insert("rows".into(), build_rows(root, &paths).into());
    // PDF embarqué dans le XML : expose a part quand il est distinct du PDF principal.
    if let Some((raw, name)) = &xml_pdf {
        let distinct = main_pdf.as_ref().is_none_or(|(main, _)| main != raw);
        result.insert(
            "xml_pdf".into(),
            if distinct { pdf_entry(raw, name.as_deref().unwrap_or("facture-xml.pdf")) } else { Value::Null },
        );
    }
    result.extend(structured);
    result.insert("xml_pretty".into(), pretty_xml(root, &source).into());
    Ok(Value::Object(result))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    const CII: &str = r#"<?xml version="1.0" encoding="utf-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:specification:CrossIndustryInvoice:100" xmlns:ram="urn:un:unece:uncefact:data:specification:CrossIndustryInvoice:100/UnqualifiedDataAggregateComponents">
 <rsm:ExchangedDocumentContext><ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>urn:cen.eu:en16931:2017#EN16931#COMFORT</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter></rsm:ExchangedDocumentContext>
 <rsm:ExchangedDocument>
  <ram:ID>4711</ram:ID><ram:TypeCode>380</ram:TypeCode>
  <ram:IssueDateTime>2026-09-10</ram:IssueDateTime><ram:DueDateDateTime>2026-10-10</ram:DueDateDateTime>
  <ram:DocumentCurrencyCode>EUR</ram:DocumentCurrencyCode>
  <ram:Note>test</ram:Note>
 </rsm:ExchangedDocument>
 <rsm:SupplyChainTradeTransaction>
  <ram:ApplicableTradeAgreement>
   <ram:Seller><ram:Name>Vendeur SAS</ram:Name><ram:SpecifiedTaxRegistration><ram:ID>FR12345678901</ram:ID></ram:SpecifiedTaxRegistration><ram:PostalTradeAddress><ram:LineOne>1 rue X</ram:LineOne><ram:CityName>Paris</ram:CityName><ram:Postcode>75001</ram:Postcode><ram:CountryID>FR</ram:CountryID></ram:PostalTradeAddress></ram:Seller>
   <ram:Buyer><ram:Name>Acheteur SA</ram:Name></ram:Buyer>
  </ram:ApplicableTradeAgreement>
  <ram:ApplicableTradeSettlement>
   <ram:PaymentMeans><ram:TypeCode>30</ram:TypeCode></ram:PaymentMeans>
   <ram:PayeePartyCreditAccount><ram:ID>FR7612345678901234567890123</ram:ID></ram:PayeePartyCreditAccount>
   <ram:ApplicableTradeTax><ram:CalculatedAmount currencyID="EUR">20.00</ram:CalculatedAmount><ram:CategoryTradeTax><ram:TypeCode>S</ram:TypeCode><ram:RateApplicablePercent>20.0</ram:RateApplicablePercent></ram:CategoryTradeTax></ram:ApplicableTradeTax>
   <ram:LineTotalAmount currencyID="EUR">100.00</ram:LineTotalAmount>
   <ram:TotalAmount currencyID="EUR">120.00</ram:TotalAmount>
   <ram:DuePayableAmount currencyID="EUR">120.00</ram:DuePayableAmount>
  </ram:ApplicableTradeSettlement>
  <ram:SpecifiedTradeLineItem>
   <ram:LineID>1</ram:LineID><ram:Name>Article test</ram:Name>
   <ram:DefinedTradeProduct><ram:SellerAssignedID>ART-1</ram:SellerAssignedID></ram:DefinedTradeProduct>
   <ram:SpecifiedLineTradeAgreement><ram:NetPrice><ram:ChargeAmount currencyID="EUR">50.00</ram:ChargeAmount></ram:NetPrice></ram:SpecifiedLineTradeAgreement>
   <ram:SpecifiedLineTradeTransaction><ram:InvoicedQuantity unitCode="H87">2.00</ram:InvoicedQuantity><ram:LineExtensionAmount currencyID="EUR">100.00</ram:LineExtensionAmount></ram:SpecifiedLineTradeTransaction>
   <ram:SpecifiedLineTradeSettlement><ram:CalculatedAmount currencyID="EUR">20.00</ram:CalculatedAmount><ram:ApplicableTradeTax><ram:RateApplicablePercent>20.0</ram:RateApplicablePercent></ram:ApplicableTradeTax></ram:SpecifiedLineTradeSettlement>
  </ram:SpecifiedTradeLineItem>
 </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>"#;

    const UBL: &str = r#"<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:cac" xmlns:cbc="urn:cbc">
  <cbc:ID>F-1</cbc:ID><cbc:IssueDate>2026-09-01</cbc:IssueDate><cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
  <cac:AccountingSupplierParty><cac:Party><cac:PartyName><cbc:Name>Vendeur &amp; Fils</cbc:Name></cac:PartyName></cac:Party></cac:AccountingSupplierParty>
  <cac:LegalMonetaryTotal><cbc:TaxExclusiveAmount currencyID="EUR">115.00</cbc:TaxExclusiveAmount></cac:LegalMonetaryTotal>
  <cac:InvoiceLine>
    <cbc:ID>1</cbc:ID><cbc:Note>Compteur : 1234 | Site : Tours ; libre</cbc:Note>
    <cbc:InvoicedQuantity unitCode="C62">10</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="EUR">115.00</cbc:LineExtensionAmount>
    <cac:AllowanceCharge><cbc:ChargeIndicator>true</cbc:ChargeIndicator><cbc:AllowanceChargeReason>Port</cbc:AllowanceChargeReason><cbc:Amount currencyID="EUR">15.00</cbc:Amount></cac:AllowanceCharge>
    <cac:Item><cbc:Name>Toner</cbc:Name><cac:ClassifiedTaxCategory><cbc:Percent>20</cbc:Percent></cac:ClassifiedTaxCategory></cac:Item>
    <cac:Price><cbc:PriceAmount currencyID="EUR">10.00</cbc:PriceAmount></cac:Price>
  </cac:InvoiceLine>
  <cac:InvoiceLine><cbc:ID>2</cbc:ID><cbc:InvoicedQuantity>1</cbc:InvoicedQuantity><cbc:LineExtensionAmount currencyID="EUR">0.00</cbc:LineExtensionAmount></cac:InvoiceLine>
</Invoice>"#;

    fn summary_value(r: &Value, title: &str) -> String {
        value_of(r["summary"].as_array().unwrap(), title)
    }

    #[test]
    fn cii_minimal() {
        let r = parse_file("test-cii.xml", CII.as_bytes()).unwrap();
        assert_eq!(r["format"], "CII");
        assert_eq!(r["kind"], "xml");
        assert_eq!(r["lines"].as_array().unwrap().len(), 1);
        assert_eq!(summary_value(&r, "N° de facture"), "4711");
        assert_eq!(summary_value(&r, "Date d'émission"), "2026-09-10");
        assert_eq!(summary_value(&r, "Échéance"), "2026-10-10");
        assert_eq!(summary_value(&r, "À payer"), "120.00 EUR");
        assert_eq!(summary_value(&r, "Vendeur"), "Vendeur SAS");
        assert_eq!(summary_value(&r, "Total TTC"), "120.00 EUR");
        let cells = &r["lines"][0]["cells"];
        assert_eq!(cells["qty"]["value"], "2.00");
        assert_eq!(cells["qty"]["note"], "H87 — pièce");
        assert_eq!(cells["name"]["value"], "Article test");
        assert_eq!(cells["price"]["value"], "50.00 EUR");
        assert_eq!(cells["taxrate"]["value"], "20.0");
        assert_eq!(
            cells["taxrate"]["path"],
            "CrossIndustryInvoice/SupplyChainTradeTransaction/SpecifiedTradeLineItem/SpecifiedLineTradeSettlement/ApplicableTradeTax/RateApplicablePercent"
        );
        let names: Vec<&str> = r["sections"].as_array().unwrap().iter().map(|s| s["name"].as_str().unwrap()).collect();
        assert_eq!(names, ["Vendeur", "Acheteur", "Livraison", "Paiement", "Totaux"]);
        assert_eq!(r["sections"][4]["rows"][0]["title"], "TVA 20.0 % — TVA standard");
        assert_eq!(r["warnings"], json!(["Aucun PDF intégré trouvé dans ce fichier."]));
        assert!(r["xml_pretty"].as_str().unwrap().starts_with("<rsm:CrossIndustryInvoice xmlns:rsm="));
    }

    #[test]
    fn ubl_lignes_frais_et_notes() {
        let r = parse_file("test-ubl.xml", UBL.as_bytes()).unwrap();
        assert_eq!(r["format"], "UBL");
        assert_eq!(value_of(r["header"].as_array().unwrap(), "Type de facture"), "380");
        assert_eq!(summary_value(&r, "Vendeur"), "Vendeur & Fils");
        let cells = &r["lines"][0]["cells"];
        // Le total inclut les frais (10 x 10 + 15) : le PU de base les retire.
        assert_eq!(cells["price"]["value"], "10.00 EUR");
        assert_eq!(cells["frais"]["value"], "15.00 EUR");
        assert_eq!(cells["frais"]["note"], "Port");
        assert_eq!(cells["taxamt"]["value"], "23.00 EUR");
        assert_eq!(cells["note_compteur"]["value"], "1234");
        assert_eq!(cells["note_site"]["value"], "Tours");
        assert_eq!(cells["note"]["value"], "libre");
        assert_eq!(cells["id"]["path"], "Invoice/InvoiceLine[1]/ID");
        let note_keys: Vec<&str> =
            r["note_columns"].as_array().unwrap().iter().map(|c| c["key"].as_str().unwrap()).collect();
        assert_eq!(note_keys, ["note_compteur", "note_site"]);
        assert_eq!(r["lines"][1]["cells"]["price"]["value"], "0.00 EUR");
        let pretty = r["xml_pretty"].as_str().unwrap();
        assert!(pretty.contains("\n    <cbc:Note>Compteur : 1234 | Site : Tours ; libre</cbc:Note>"));
        assert!(pretty.contains("<cbc:Name>Vendeur &amp; Fils</cbc:Name>"));
    }

    #[test]
    fn modes_de_paiement_traduits_sans_modifier_les_codes() {
        for (code, label) in [
            ("20", "Chèque"), ("42", "Paiement sur compte bancaire"),
            ("45", "Virement bancaire référencé"), ("48", "Carte bancaire"),
            ("49", "Prélèvement"), ("58", "Virement SEPA"),
            ("59", "Prélèvement SEPA"), ("68", "Paiement en ligne"),
        ] {
            let ubl = UBL.replace("<cac:LegalMonetaryTotal>", &format!(
                "<cac:PaymentMeans><cbc:PaymentMeansCode>{code}</cbc:PaymentMeansCode></cac:PaymentMeans><cac:LegalMonetaryTotal>"
            ));
            let cii = CII.replace("<ram:TypeCode>30</ram:TypeCode>", &format!("<ram:TypeCode>{code}</ram:TypeCode>"));
            for xml in [ubl, cii] {
                let r = parse_file("paiement.xml", xml.as_bytes()).unwrap();
                let payment = r["sections"].as_array().unwrap().iter().find(|s| s["name"] == "Paiement").unwrap();
                let row = payment["rows"].as_array().unwrap().iter().find(|row| row["title"] == "Mode de paiement").unwrap();
                assert_eq!(row["value"], code);
                assert_eq!(row["note"], label);
            }
        }
        let unknown = CII.replace("<ram:TypeCode>30</ram:TypeCode>", "<ram:TypeCode>999</ram:TypeCode>");
        let r = parse_file("paiement.xml", unknown.as_bytes()).unwrap();
        let row = &r["sections"][3]["rows"][0];
        assert_eq!(row["value"], "999");
        assert!(row.get("note").is_none());
    }

    #[test]
    fn zip_factur_x() {
        let mut buf = Vec::new();
        {
            let mut zw = zip::ZipWriter::new(Cursor::new(&mut buf));
            let opts = zip::write::SimpleFileOptions::default();
            zw.start_file("factur-x.xml", opts).unwrap();
            zw.write_all(CII.as_bytes()).unwrap();
            zw.start_file("facture.pdf", opts).unwrap();
            zw.write_all(b"%PDF-1.7 test").unwrap();
            zw.finish().unwrap();
        }
        let r = parse_file("facture.zip", &buf).unwrap();
        assert_eq!(r["kind"], "zip");
        assert_eq!(r["pdf"]["size"], 13);
        assert_eq!(r["pdf"]["filename"], "facture.pdf");
        assert_eq!(r["warnings"][0], "XML extrait de l'archive : factur-x.xml");
        let direct = parse_file("test-cii.xml", CII.as_bytes()).unwrap();
        assert_eq!(r["doc_hash"], direct["doc_hash"]);
    }

    #[test]
    fn pdf_avec_xml_en_piece_jointe() {
        let mut enc = flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::default());
        enc.write_all(CII.as_bytes()).unwrap();
        let stream = enc.finish().unwrap();
        let mut pdf = b"%PDF-1.7\n3 0 obj\n<< /Type /Filespec /F (factur-x.xml) /UF (factur-x.xml) /EF << /F 14 0 R >> >>\nendobj\n14 0 obj\n<< /Type /EmbeddedFile /Filter /FlateDecode >>\nstream\n".to_vec();
        pdf.extend_from_slice(&stream);
        pdf.extend_from_slice(b"\nendstream\nendobj\n%%EOF");
        let r = parse_file("facture.pdf", &pdf).unwrap();
        assert_eq!(r["kind"], "pdf");
        assert_eq!(r["format"], "CII");
        assert_eq!(r["pdf"]["size"], pdf.len());
        assert_eq!(r["warnings"][0], "XML extrait de la pièce jointe du PDF : factur-x.xml");
    }

    #[test]
    fn fichiers_rejetes() {
        let e = parse_file("x.bin", b"\x00\x01\x02").unwrap_err();
        assert!(e.0.starts_with("Format non reconnu"));
        let e = parse_file("x.pdf", b"%PDF-1.4 rien dedans").unwrap_err();
        assert!(e.0.starts_with("PDF sans XML de facture"));
        let e = parse_file("x.xml", b"<a><b></a>").unwrap_err();
        assert!(e.0.starts_with("XML invalide"));
    }

    fn controles_of(xml: &str, today: (i32, u32, u32)) -> Vec<Value> {
        let doc = parse_xml(xml).unwrap();
        let root = doc.root_element();
        let paths = Paths::build(root);
        let mut warnings = Vec::new();
        let (format, s) = if local(root) == "CrossIndustryInvoice" {
            ("CII", extract_cii(root, &paths, &mut warnings))
        } else {
            ("UBL", extract_ubl(root, &paths, &mut warnings))
        };
        let today = chrono::NaiveDate::from_ymd_opt(today.0, today.1, today.2).unwrap();
        controles::run(root, format, &paths, &s, today).0
    }

    fn controle<'a>(checks: &'a [Value], prefix: &str) -> &'a Value {
        checks
            .iter()
            .find(|c| c["regle"].as_str().unwrap().starts_with(prefix))
            .unwrap_or_else(|| panic!("controle absent : {prefix}"))
    }

    #[test]
    fn controles_facture_juste() {
        let c = controles_of(CII, (2026, 10, 2));
        assert!(c.iter().all(|x| x["etat"] != "ecart"), "{c:#?}");
        assert_eq!(controle(&c, "Lignes :")["etat"], "conforme");
        assert_eq!(controle(&c, "Somme des lignes")["etat"], "conforme");
        assert_eq!(controle(&c, "Total TTC")["etat"], "conforme");
        assert_eq!(controle(&c, "Total TTC")["attendu"], "120.00");
        assert_eq!(controle(&c, "Net à payer")["etat"], "conforme");
        assert_eq!(controle(&c, "Mentions essentielles")["etat"], "conforme");
        // IBAN et n° de TVA de la fixture : cles de controle fausses.
        assert_eq!(controle(&c, "IBAN")["etat"], "alerte");
        assert_eq!(controle(&c, "N° de TVA")["etat"], "alerte");
        assert_eq!(controle(&c, "Échéance dans 8 jours")["etat"], "info");
        let late = controles_of(CII, (2026, 10, 13));
        assert_eq!(controle(&late, "Échéance dépassée depuis 3 jours")["etat"], "alerte");
    }

    #[test]
    fn controles_ecarts() {
        let xml = CII
            .replace("<ram:TotalAmount currencyID=\"EUR\">120.00", "<ram:TotalAmount currencyID=\"EUR\">120.01")
            .replace(
                "<ram:LineExtensionAmount currencyID=\"EUR\">100.00",
                "<ram:LineExtensionAmount currencyID=\"EUR\">100.02",
            );
        let c = controles_of(&xml, (2026, 10, 2));
        // Ecart d'un centime sur le TTC : 100.00 + 20.00 attendu, 120.01 constate.
        let ttc = controle(&c, "Total TTC");
        assert_eq!(ttc["etat"], "ecart");
        assert_eq!(ttc["attendu"], "120.00");
        assert_eq!(ttc["constate"], "120.01");
        assert_eq!(ttc["ecart"], "0.01");
        assert!(ttc["path"].as_str().unwrap().ends_with("ApplicableTradeSettlement/TotalAmount"));
        assert_eq!(controle(&c, "Net à payer")["ecart"], "-0.01");
        // 2 x 50.00 : 100.01 s'explique par l'arrondi du prix, 100.02 non.
        assert_eq!(controle(&c, "Lignes :")["etat"], "ecart");
        assert_eq!(controle(&c, "Ligne 1 :")["ecart"], "0.02");
        assert_eq!(controle(&c, "Somme des lignes")["ecart"], "-0.02");
        let tolerated = CII.replace(
            "<ram:LineExtensionAmount currencyID=\"EUR\">100.00",
            "<ram:LineExtensionAmount currencyID=\"EUR\">100.01",
        );
        assert_eq!(controle(&controles_of(&tolerated, (2026, 10, 2)), "Lignes :")["etat"], "conforme");
    }

    #[test]
    fn controles_ubl_incomplet() {
        let c = controles_of(UBL, (2026, 10, 2));
        // Ligne 1 : 10 x 10.00 + 15.00 de frais = 115.00 ; ligne 2 sans prix.
        let lignes = controle(&c, "Lignes :");
        assert_eq!(lignes["etat"], "conforme");
        assert!(lignes["detail"].as_str().unwrap().starts_with("1 ligne(s) vérifiée(s) ; 1 sans"));
        assert_eq!(controle(&c, "Total TTC")["etat"], "non_verifiable");
        let mentions = controle(&c, "Mentions essentielles");
        assert_eq!(mentions["etat"], "ecart");
        assert_eq!(mentions["detail"], "Absent du XML : Nom de l'acheteur");
        assert_eq!(controle(&c, "Identification du vendeur")["etat"], "alerte");
        let r = parse_file("test-ubl.xml", UBL.as_bytes()).unwrap();
        assert!(!r["controles"].as_array().unwrap().is_empty());
        assert_eq!(r["synthese"]["ht"], "115.00");
        assert_eq!(r["synthese"]["ttc"], "");
    }

    #[test]
    fn synthese_cii() {
        let r = parse_file("test-cii.xml", CII.as_bytes()).unwrap();
        let s = &r["synthese"];
        assert_eq!(s["numero"], "4711");
        assert_eq!(s["vendeur"], "Vendeur SAS");
        assert_eq!(s["date"], "2026-09-10");
        assert_eq!(s["echeance"], "2026-10-10");
        assert_eq!(s["devise"], "EUR");
        assert_eq!(s["ht"], "100.00");
        assert_eq!(s["tva"], "20.00");
        assert_eq!(s["ttc"], "120.00");
        assert_eq!(s["a_payer"], "120.00");
        assert_eq!(s["avoir"], false);
        // 2026-09-10 est un jeudi.
        assert_eq!(s["week_end"], false);
        assert!(s["jours_echeance"].is_i64());
    }

    #[test]
    fn utilitaires() {
        assert_eq!(thousands(1234567), "1,234,567");
        assert_eq!(thousands(999), "999");
        assert_eq!(note_slug("N° série / Compteur"), "note_n_s_rie_compteur");
        assert_eq!(fmt_ac(-3.5, Some("EUR")), "-3.50 EUR");
        assert_eq!(line_tax("100.00", "20"), "20.00");
        assert_eq!(line_tax("100.00", "0"), "");
    }
}
