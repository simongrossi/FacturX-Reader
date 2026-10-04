//! Controles de coherence d'une facture : arithmetique en decimaux exacts,
//! mentions essentielles, identifiants (SIREN/SIRET, TVA, IBAN) et echeance.
//!
//! Chaque controle porte un etat :
//!   - `conforme`       : la regle est verifiee ;
//!   - `ecart`          : la valeur du XML differe de la valeur recalculee ;
//!   - `alerte`         : point a examiner (identifiant douteux, echeance depassee) ;
//!   - `info`           : information utile, sans anomalie ;
//!   - `non_verifiable` : donnees absentes du XML, la regle ne peut pas etre evaluee.
//!
//! Une regle sans objet (ex. pas de lignes dans un profil BASIC WL) n'est pas emise.

use std::fmt;

use chrono::NaiveDate;
use serde_json::{json, Map, Value};

use super::{find, find_alt, findall, findall_alt, text, Paths, N, ON};

// ------------------------------------------------------------------ decimaux

/// 8 decimales : couvre les prix unitaires et quantites a forte precision.
pub(super) const SCALE: i128 = 100_000_000;
pub(super) const CENT: i128 = SCALE / 100;

/// Decimal a virgule fixe. Aucun flottant : les sommes sont exactes.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(super) struct Dec(pub(super) i128);

impl Dec {
    const ZERO: Dec = Dec(0);

    /// Valeur et nombre de decimales ecrites. `None` si vide, non numerique
    /// ou plus precis que 8 decimales.
    pub(super) fn parse(s: &str) -> Option<(Dec, u32)> {
        let s = s.trim();
        let (neg, body) = match s.strip_prefix('-') {
            Some(rest) => (true, rest),
            None => (false, s.strip_prefix('+').unwrap_or(s)),
        };
        let (int, frac) = body.split_once('.').unwrap_or((body, ""));
        if (int.is_empty() && frac.is_empty())
            || int.len() > 18
            || frac.len() > 8
            || !int.bytes().chain(frac.bytes()).all(|b| b.is_ascii_digit())
        {
            return None;
        }
        let int_v: i128 = if int.is_empty() { 0 } else { int.parse().ok()? };
        let frac_v: i128 = if frac.is_empty() { 0 } else { frac.parse().ok()? };
        let v = int_v * SCALE + frac_v * 10i128.pow(8 - frac.len() as u32);
        Some((Dec(if neg { -v } else { v }), frac.len() as u32))
    }

    fn abs(self) -> Dec {
        Dec(self.0.abs())
    }
}

impl fmt::Display for Dec {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let a = self.0.abs();
        let mut frac = format!("{:08}", a % SCALE);
        while frac.len() > 2 && frac.ends_with('0') {
            frac.pop();
        }
        write!(f, "{}{}.{frac}", if self.0 < 0 { "-" } else { "" }, a / SCALE)
    }
}

/// Division arrondie au plus proche, demi a l'ecart de zero (d > 0).
pub(super) fn round_div(n: i128, d: i128) -> i128 {
    if n >= 0 {
        (n + d / 2) / d
    } else {
        -((-n + d / 2) / d)
    }
}

/// a x b / diviseur, arrondi au centime.
pub(super) fn mul_cents(a: Dec, b: Dec, divisor: Dec) -> Option<Dec> {
    if divisor.0 == 0 {
        return None;
    }
    let (n, d) = (a.0.checked_mul(b.0)?, divisor.0.checked_mul(CENT)?);
    let (n, d) = if d < 0 { (-n, -d) } else { (n, d) };
    Some(Dec(round_div(n, d) * CENT))
}

/// Montant lu dans le XML, avec sa precision et son chemin.
#[derive(Clone, Debug)]
struct Amt {
    v: Dec,
    dp: u32,
    raw: String,
    path: String,
}

fn amt(el: ON, paths: &Paths) -> Option<Amt> {
    let raw = text(el);
    let (v, dp) = Dec::parse(&raw)?;
    Some(Amt { v, dp, raw, path: paths.of(el) })
}

// ------------------------------------------------------------------ donnees communes

#[derive(Default)]
struct Line {
    id: String,
    path: String,
    /// Reference article et designation, pour la bibliotheque.
    reference: String,
    name: String,
    qty: Option<Amt>,
    price: Option<Amt>,
    base_qty: Option<Amt>,
    total: Option<Amt>,
    /// Frais - remises de la ligne.
    ac_net: i128,
    adjustments: Vec<LineAdjustment>,
    tax_rate: Option<Amt>,
    tax_amount: Option<Amt>,
}

struct LineAdjustment {
    charge: bool,
    amount: Amt,
}

#[derive(Default)]
struct Breakdown {
    base: Option<Amt>,
    rate: Option<Amt>,
    tax: Option<Amt>,
}

#[derive(Default)]
struct Totals {
    lines: Vec<Line>,
    lines_sum: Option<Amt>,
    allowances: Option<Amt>,
    charges: Option<Amt>,
    basis: Option<Amt>,
    tax: Option<Amt>,
    grand: Option<Amt>,
    prepaid: Option<Amt>,
    rounding: Option<Amt>,
    payable: Option<Amt>,
    breakdown: Vec<Breakdown>,
    discount_pct: Option<Amt>,
    discount_amount: Option<Amt>,
}

fn is_true(el: ON) -> bool {
    matches!(text(el).to_lowercase().as_str(), "true" | "1" | "yes" | "oui")
}

fn ubl_totals(root: N, paths: &Paths) -> Totals {
    let r = Some(root);
    let a = |el: ON| amt(el, paths);
    let lmt = find(r, "LegalMonetaryTotal");
    let tax_totals = findall(r, "TaxTotal");
    let tt = tax_totals
        .iter()
        .copied()
        .find(|t| find(Some(*t), "TaxSubtotal").is_some())
        .or_else(|| tax_totals.first().copied());
    let mut t = Totals {
        lines_sum: a(find(lmt, "LineExtensionAmount")),
        allowances: a(find(lmt, "AllowanceTotalAmount")),
        charges: a(find(lmt, "ChargeTotalAmount")),
        basis: a(find(lmt, "TaxExclusiveAmount")),
        tax: a(find(tt, "TaxAmount")),
        grand: a(find(lmt, "TaxInclusiveAmount")),
        prepaid: a(find(lmt, "PrepaidAmount")),
        rounding: a(find(lmt, "PayableRoundingAmount")),
        payable: a(find(lmt, "PayableAmount")),
        discount_pct: a(find(find(r, "PaymentTerms"), "SettlementDiscountPercent")),
        ..Totals::default()
    };
    for sub in findall(tt, "TaxSubtotal") {
        let sub = Some(sub);
        t.breakdown.push(Breakdown {
            base: a(find(sub, "TaxableAmount")),
            rate: a(find(find(sub, "TaxCategory"), "Percent")),
            tax: a(find(sub, "TaxAmount")),
        });
    }
    for line in findall_alt(r, &["InvoiceLine", "CreditNoteLine"]) {
        let l = Some(line);
        let price = find(l, "Price");
        let mut ac_net = 0;
        let mut adjustments = Vec::new();
        for ac in findall(l, "AllowanceCharge") {
            let ac = Some(ac);
            let indicator = find(ac, "ChargeIndicator");
            let amount = a(find(ac, "Amount"));
            let v = amount.as_ref().map_or(0, |x| x.v.0);
            // ChargeIndicator absent = majoration, comme dans le moteur d'affichage.
            let charge = indicator.is_none() || is_true(indicator);
            ac_net += if charge { v } else { -v };
            if let Some(amount) = amount { adjustments.push(LineAdjustment { charge, amount }); }
        }
        let item = find(l, "Item");
        t.lines.push(Line {
            id: text(find(l, "ID")),
            path: paths.of(l),
            reference: text(find(find(item, "SellersItemIdentification"), "ID")),
            name: text(find(item, "Name")),
            qty: a(find_alt(l, &["InvoicedQuantity", "CreditedQuantity"])),
            price: a(find(price, "PriceAmount")),
            base_qty: a(find(price, "BaseQuantity")),
            total: a(find(l, "LineExtensionAmount")),
            ac_net,
            adjustments,
            tax_rate: a(find(find(find(l, "Item"), "ClassifiedTaxCategory"), "Percent")),
            tax_amount: a(find(find(l, "TaxTotal"), "TaxAmount")),
        });
    }
    t
}

fn cii_totals(root: N, paths: &Paths) -> Totals {
    let a = |el: ON| amt(el, paths);
    let txn = find(Some(root), "SupplyChainTradeTransaction");
    let settlement = find_alt(txn, &["ApplicableTradeSettlement", "ApplicableHeaderTradeSettlement"]);
    let sum = find(settlement, "SpecifiedTradeSettlementHeaderMonetarySummation");
    let pick = |names: &[&str]| names.iter().find_map(|n| find(sum, n).or_else(|| find(settlement, n)));
    // TaxTotalAmount peut etre repete (devise de facture et devise comptable).
    let currency = text(find(settlement, "InvoiceCurrencyCode"));
    let tax_totals = findall(sum, "TaxTotalAmount");
    let tax_el = tax_totals
        .iter()
        .copied()
        .find(|t| !currency.is_empty() && t.attribute("currencyID") == Some(currency.as_str()))
        .or_else(|| tax_totals.first().copied());
    let discount = find(find(settlement, "SpecifiedTradePaymentTerms"), "ApplicableTradePaymentDiscountTerms");
    let mut t = Totals {
        lines_sum: a(pick(&["LineTotalAmount"])),
        allowances: a(pick(&["AllowanceTotalAmount"])),
        charges: a(pick(&["ChargeTotalAmount"])),
        basis: a(pick(&["TaxBasisTotalAmount"])),
        tax: a(tax_el),
        grand: a(pick(&["GrandTotalAmount", "TotalAmount"])),
        prepaid: a(pick(&["TotalPrepaidAmount"])),
        rounding: a(pick(&["RoundingAmount"])),
        payable: a(pick(&["DuePayableAmount", "NetPayableAmount"])),
        discount_pct: a(find(discount, "CalculationPercent")),
        discount_amount: a(find(discount, "ActualDiscountAmount")),
        ..Totals::default()
    };
    for tax in findall(settlement, "ApplicableTradeTax") {
        let tax = Some(tax);
        t.breakdown.push(Breakdown {
            base: a(find(tax, "BasisAmount")),
            rate: a(find(find(tax, "CategoryTradeTax"), "RateApplicablePercent")
                .or_else(|| find(tax, "RateApplicablePercent"))),
            tax: a(find(tax, "CalculatedAmount")),
        });
    }
    for li in findall_alt(txn, &["SpecifiedTradeLineItem", "IncludedSupplyChainTradeLineItem"]) {
        let l = Some(li);
        let agr = find_alt(l, &["SpecifiedLineTradeAgreement", "IncludedLineTradeAgreement"]);
        let tr = find(l, "SpecifiedLineTradeTransaction");
        let dl = find_alt(l, &["SpecifiedLineTradeDelivery", "IncludedLineTradeDelivery"]);
        let st = find_alt(l, &["SpecifiedLineTradeSettlement", "IncludedLineTradeSettlement"]);
        let price = find_alt(agr, &["NetPriceProductTradePrice", "NetPrice"]);
        let mut ac_net = 0;
        let mut adjustments = Vec::new();
        for ac in findall(st, "SpecifiedTradeAllowanceCharge") {
            let ac = Some(ac);
            let indicator = find(ac, "ChargeIndicator");
            let amount = a(find(ac, "ActualAmount"));
            let v = amount.as_ref().map_or(0, |x| x.v.0);
            let charge = is_true(find(indicator, "Indicator").or(indicator));
            ac_net += if charge { v } else { -v };
            if let Some(amount) = amount { adjustments.push(LineAdjustment { charge, amount }); }
        }
        let product = find_alt(l, &["SpecifiedTradeProduct", "DefinedTradeProduct"]);
        t.lines.push(Line {
            id: text(find(l, "LineID").or_else(|| find(find(l, "AssociatedDocumentLineDocument"), "LineID"))),
            path: paths.of(l),
            reference: text(find(product, "SellerAssignedID")),
            name: text(find(product, "Name")).chars().take(300).collect(),
            qty: a(find(tr, "InvoicedQuantity").or_else(|| find(dl, "BilledQuantity"))),
            price: a(find(price, "ChargeAmount")),
            base_qty: a(find(price, "BasisQuantity")),
            total: a(find(tr, "LineExtensionAmount")
                .or_else(|| find(find(st, "SpecifiedTradeSettlementLineMonetarySummation"), "LineTotalAmount"))),
            ac_net,
            adjustments,
            tax_rate: a(find(find(st, "ApplicableTradeTax"), "RateApplicablePercent")
                .or_else(|| find(st, "RateApplicablePercent"))),
            tax_amount: a(find(st, "CalculatedAmount")
                .or_else(|| find(find(st, "ApplicableTradeTax"), "CalculatedAmount"))),
        });
    }
    t
}

// ------------------------------------------------------------------ resultats

fn check(regle: &str, etat: &str, attendu: &str, constate: &str, ecart: &str, path: &str, detail: &str) -> Value {
    json!({
        "regle": regle,
        "etat": etat,
        "attendu": attendu,
        "constate": constate,
        "ecart": ecart,
        "path": path,
        "detail": detail,
    })
}

fn simple(regle: &str, etat: &str, path: &str, detail: &str) -> Value {
    check(regle, etat, "", "", "", path, detail)
}

/// Compare une valeur recalculee a la valeur du XML, avec une tolerance.
fn compare(out: &mut Vec<Value>, regle: &str, detail: &str, expected: Dec, found: &Amt, tolerance: i128) {
    let diff = Dec(found.v.0 - expected.0);
    let (etat, ecart) = if diff.abs().0 <= tolerance { ("conforme", String::new()) } else { ("ecart", diff.to_string()) };
    out.push(check(regle, etat, &expected.to_string(), &found.v.to_string(), &ecart, &found.path, detail));
}

fn val(a: &Option<Amt>) -> i128 {
    a.as_ref().map_or(0, |x| x.v.0)
}

fn tax_breakdown_expected(b: &Breakdown) -> Option<Dec> {
    mul_cents(b.base.as_ref()?.v, b.rate.as_ref()?.v, Dec(100 * SCALE))
}

// ------------------------------------------------------------------ regles arithmetiques

struct LineCalculation {
    base_expected: Dec,
    adjusted_expected: Dec,
    reference: Dec,
    tolerance: Dec,
    matches: bool,
}

fn line_calculation(line: &Line) -> Option<LineCalculation> {
    let (qty, price, total) = (line.qty.as_ref()?, line.price.as_ref()?, line.total.as_ref()?);
    let base = line.base_qty.as_ref().map_or(Dec(SCALE), |b| b.v);
    let expected = mul_cents(qty.v, price.v, base)?;
    // Même tolérance et mêmes deux conventions que le contrôle de ligne.
    let tolerance = Dec(qty.v.abs().0 / (2 * 10i128.pow(price.dp)));
    let adjusted = Dec(expected.0 + line.ac_net);
    let near = |candidate: Dec| (total.v.0 - candidate.0).abs() <= tolerance.0;
    Some(LineCalculation {
        base_expected: expected,
        adjusted_expected: adjusted,
        reference: if line.ac_net != 0 { adjusted } else { expected },
        tolerance,
        matches: near(expected) || near(adjusted),
    })
}

fn line_provenance(line: &Line) -> Value {
    let input = |label: &str, amount: Option<&Amt>| match amount {
        Some(a) => provenance_input(label, Some(a)),
        None => json!({ "label": label, "value": "", "note": "Absent du XML" }),
    };
    let mut inputs = vec![
        input("Quantité", line.qty.as_ref()),
        input("Prix unitaire déclaré", line.price.as_ref()),
        line.base_qty.as_ref().map(|a| provenance_input("Quantité de base", Some(a)))
            .unwrap_or_else(|| json!({ "label": "Quantité de base", "value": "1", "note": "Valeur implicite du contrôle" })),
    ];
    for adjustment in &line.adjustments {
        inputs.push(provenance_input(if adjustment.charge { "Frais de ligne" } else { "Remise de ligne" }, Some(&adjustment.amount)));
    }
    inputs.push(input("Total de ligne déclaré", line.total.as_ref()));
    if let Some(rate) = &line.tax_rate { inputs.push(provenance_input("Taux de TVA déclaré", Some(rate))); }
    if let Some(tax) = &line.tax_amount { inputs.push(provenance_input("TVA de ligne déclarée", Some(tax))); }
    let comparison = line_calculation(line).map(|c| json!({
        "formula": "Quantité × prix unitaire / quantité de base (arrondi au centime)",
        "base_expected": c.base_expected.to_string(),
        "adjusted_expected": c.adjusted_expected.to_string(),
        "adjustments_net": Dec(line.ac_net).to_string(),
        "expected": c.reference.to_string(),
        "tolerance": c.tolerance.to_string(),
        "matches": c.matches,
    }));
    json!({ "path": line.path, "inputs": inputs, "comparison": comparison })
}

fn check_lines(out: &mut Vec<Value>, t: &Totals) {
    if t.lines.is_empty() {
        return;
    }
    let (mut ok, mut skipped) = (0usize, 0usize);
    let mut gaps = Vec::new();
    for (line_index, line) in t.lines.iter().enumerate() {
        let (Some(qty), Some(price), Some(total)) = (&line.qty, &line.price, &line.total) else {
            skipped += 1;
            continue;
        };
        let Some(calculation) = line_calculation(line) else {
            skipped += 1;
            continue;
        };
        if calculation.matches {
            ok += 1;
            continue;
        }
        let label = if line.id.is_empty() { "Ligne".to_string() } else { format!("Ligne {}", line.id) };
        let mut gap = check(
            &format!("{label} : quantité × prix unitaire = total de ligne"),
            "ecart",
            &calculation.reference.to_string(),
            &total.v.to_string(),
            &Dec(total.v.0 - calculation.reference.0).to_string(),
            &total.path,
            &format!("{} × {}{}", qty.v, price.v, if line.ac_net != 0 { " + frais/remises de ligne" } else { "" }),
        );
        gap["line_index"] = line_index.into();
        gaps.push(gap);
    }
    let regle = "Lignes : quantité × prix unitaire = total de ligne";
    let first_path = t.lines.first().map_or("", |l| l.path.as_str());
    let skipped_note = if skipped > 0 { format!(" ; {skipped} sans quantité, prix ou total") } else { String::new() };
    if ok == 0 && gaps.is_empty() {
        out.push(simple(regle, "non_verifiable", first_path, "Quantité, prix unitaire ou total absents des lignes."));
    } else if gaps.is_empty() {
        out.push(simple(regle, "conforme", first_path, &format!("{ok} ligne(s) vérifiée(s){skipped_note}")));
    } else {
        out.push(simple(
            regle,
            "ecart",
            first_path,
            &format!("{} ligne(s) en écart sur {}{skipped_note}", gaps.len(), ok + gaps.len()),
        ));
        out.extend(gaps);
    }
}

fn check_totals(out: &mut Vec<Value>, t: &Totals) {
    // Somme des lignes = total des lignes (BR-CO-10).
    if let Some(found) = &t.lines_sum {
        if !t.lines.is_empty() && t.lines.iter().all(|l| l.total.is_some()) {
            let sum = Dec(t.lines.iter().map(|l| val(&l.total)).sum());
            compare(out, "Somme des lignes = total des lignes", "Σ totaux de ligne", sum, found, 0);
        }
    }
    // Total HT = total des lignes - remises + frais (BR-CO-13).
    if let (Some(lines_sum), Some(found)) = (&t.lines_sum, &t.basis) {
        let expected = Dec(lines_sum.v.0 - val(&t.allowances) + val(&t.charges));
        compare(out, "Total HT = total des lignes − remises + frais", "Niveau document", expected, found, 0);
    }
    // TVA par taux = base × taux (BR-CO-17), au centime pres.
    for (tax_index, b) in t.breakdown.iter().enumerate() {
        let (Some(base), Some(rate), Some(found)) = (&b.base, &b.rate, &b.tax) else { continue };
        if let Some(expected) = tax_breakdown_expected(b) {
            let regle = format!("TVA {} % = base × taux", rate.v);
            compare(out, &regle, &format!("{} × {} %", base.v, rate.v), expected, found, CENT);
            if let Some(control) = out.last_mut() { control["tax_breakdown_index"] = tax_index.into(); }
        }
    }
    // Total TVA = somme des TVA par taux (BR-CO-14).
    let breakdown_sum = (!t.breakdown.is_empty() && t.breakdown.iter().all(|b| b.tax.is_some()))
        .then(|| Dec(t.breakdown.iter().map(|b| val(&b.tax)).sum()));
    if let (Some(sum), Some(found)) = (breakdown_sum, &t.tax) {
        compare(out, "Total TVA = somme des TVA par taux", "Σ ventilation de TVA", sum, found, 0);
    }
    // Total TTC = total HT + total TVA (BR-CO-15).
    let regle = "Total TTC = total HT + total TVA";
    let ht = t.basis.as_ref().or(t.lines_sum.as_ref());
    let tva = t.tax.as_ref().map(|x| x.v).or(breakdown_sum);
    match (ht, tva, &t.grand) {
        (Some(ht), Some(tva), Some(found)) => {
            compare(out, regle, &format!("{} + {tva}", ht.v), Dec(ht.v.0 + tva.0), found, 0);
        }
        (_, _, grand) => {
            let path = grand.as_ref().map_or("", |g| g.path.as_str());
            out.push(simple(regle, "non_verifiable", path, "Total HT, total TVA ou total TTC absent du XML."));
        }
    }
    // Net a payer = total TTC - acomptes + arrondi (BR-CO-16).
    if let (Some(grand), Some(found)) = (&t.grand, &t.payable) {
        let expected = Dec(grand.v.0 - val(&t.prepaid) + val(&t.rounding));
        compare(out, "Net à payer = total TTC − acomptes + arrondi", "", expected, found, 0);
    }
}

// ------------------------------------------------------------------ mentions et identifiants

/// (valeur, chemin) d'une ligne de l'en-tete (`section` = None) ou d'une section.
fn field(s: &Map<String, Value>, section: Option<&str>, titles: &[&str]) -> Option<(String, String)> {
    let rows = match section {
        None => s.get("header")?.as_array()?,
        Some(name) => s.get("sections")?.as_array()?.iter().find(|x| x["name"] == name)?["rows"].as_array()?,
    };
    titles.iter().find_map(|title| {
        let r = rows.iter().find(|r| r["title"] == *title && r["value"].as_str().is_some_and(|v| !v.is_empty()))?;
        Some((r["value"].as_str()?.to_string(), r["path"].as_str().unwrap_or("").to_string()))
    })
}

fn luhn(digits: &str) -> bool {
    let sum: u32 = digits
        .bytes()
        .rev()
        .enumerate()
        .map(|(i, b)| {
            let d = u32::from(b - b'0');
            if i % 2 == 1 {
                let d = d * 2;
                if d > 9 { d - 9 } else { d }
            } else {
                d
            }
        })
        .sum();
    sum % 10 == 0
}

/// `Some(valide)` pour un SIREN (9 chiffres) ou un SIRET (14 chiffres), `None` sinon.
fn siren_siret_valid(id: &str) -> Option<bool> {
    let id: String = id.chars().filter(|c| !c.is_whitespace()).collect();
    if !(id.len() == 9 || id.len() == 14) || !id.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    // Les SIRET de La Poste (SIREN 356000000) ne suivent pas la cle de Luhn.
    if id.len() == 14 && id.starts_with("356000000") {
        return None;
    }
    Some(luhn(&id))
}

/// `Some(valide)` pour un n° de TVA francais a cle numerique, `None` sinon.
fn fr_vat_valid(vat: &str) -> Option<bool> {
    let vat: String = vat.chars().filter(|c| !c.is_whitespace()).collect::<String>().to_uppercase();
    let rest = vat.strip_prefix("FR")?;
    if rest.len() != 11 || !rest.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let key: u64 = rest[..2].parse().ok()?;
    let siren: u64 = rest[2..].parse().ok()?;
    Some(key == (12 + 3 * (siren % 97)) % 97)
}

/// `Some(valide)` pour une chaine de forme IBAN (controle modulo 97), `None` sinon.
fn iban_valid(iban: &str) -> Option<bool> {
    let iban: String = iban.chars().filter(|c| !c.is_whitespace()).collect::<String>().to_uppercase();
    let b = iban.as_bytes();
    if !(15..=34).contains(&b.len())
        || !b.iter().all(u8::is_ascii_alphanumeric)
        || !b[..2].iter().all(u8::is_ascii_alphabetic)
        || !b[2..4].iter().all(u8::is_ascii_digit)
    {
        return None;
    }
    let mut rem: u32 = 0;
    for &c in b[4..].iter().chain(&b[..4]) {
        if c.is_ascii_digit() {
            rem = (rem * 10 + u32::from(c - b'0')) % 97;
        } else {
            rem = (rem * 100 + u32::from(c - b'A') + 10) % 97;
        }
    }
    Some(rem == 1)
}

fn check_mentions(out: &mut Vec<Value>, s: &Map<String, Value>) {
    let required: [(&str, Option<&str>, &[&str]); 6] = [
        ("Numéro de facture", None, &["N° de facture"]),
        ("Date d'émission", None, &["Date d'émission"]),
        ("Type de facture", None, &["Type de facture"]),
        ("Devise", None, &["Devise"]),
        ("Nom du vendeur", Some("Vendeur"), &["Raison sociale", "Dénomination légale"]),
        ("Nom de l'acheteur", Some("Acheteur"), &["Raison sociale", "Dénomination légale"]),
    ];
    let missing: Vec<&str> =
        required.iter().filter(|(_, sec, titles)| field(s, *sec, titles).is_none()).map(|(n, _, _)| *n).collect();
    let regle = "Mentions essentielles présentes";
    if missing.is_empty() {
        out.push(simple(regle, "conforme", "", "Numéro, date, type, devise, vendeur, acheteur"));
    } else {
        out.push(simple(regle, "ecart", "", &format!("Absent du XML : {}", missing.join(", "))));
    }

    let legal = field(s, Some("Vendeur"), &["SIREN / registre", "Identifiant légal"]);
    let vat = field(s, Some("Vendeur"), &["N° de TVA"]);
    if legal.is_none() && vat.is_none() {
        out.push(simple(
            "Identification du vendeur",
            "alerte",
            "",
            "Ni identifiant légal (SIREN/SIRET) ni n° de TVA du vendeur dans le XML.",
        ));
    }
    if let Some((v, path)) = &legal {
        match siren_siret_valid(v) {
            Some(true) => out.push(simple("SIREN / SIRET du vendeur", "conforme", path, "Clé de contrôle valide")),
            Some(false) => out.push(simple(
                "SIREN / SIRET du vendeur",
                "alerte",
                path,
                &format!("Clé de contrôle invalide : {v}"),
            )),
            None => {}
        }
    }
    if let Some((v, path)) = &vat {
        match fr_vat_valid(v) {
            Some(true) => out.push(simple("N° de TVA du vendeur", "conforme", path, "Clé de contrôle valide")),
            Some(false) => {
                out.push(simple("N° de TVA du vendeur", "alerte", path, &format!("Clé de contrôle invalide : {v}")))
            }
            None => {}
        }
    }
    if let Some((v, path)) = field(s, Some("Paiement"), &["IBAN"]) {
        match iban_valid(&v) {
            Some(true) => out.push(simple("IBAN", "conforme", &path, "Clé de contrôle valide")),
            Some(false) => out.push(simple("IBAN", "alerte", &path, &format!("Clé de contrôle invalide : {v}"))),
            None => out.push(simple("IBAN", "alerte", &path, &format!("Format d'IBAN non reconnu : {v}"))),
        }
    }
}

// ------------------------------------------------------------------ dates cles

fn parse_date(s: &str) -> Option<NaiveDate> {
    let s = s.trim();
    let digits: String = s.chars().take(10).filter(char::is_ascii_digit).collect();
    let well_formed = (s.len() >= 10 && s.as_bytes()[4] == b'-' && s.as_bytes()[7] == b'-') || s.len() == 8;
    if digits.len() != 8 || !well_formed {
        return None;
    }
    NaiveDate::from_ymd_opt(digits[0..4].parse().ok()?, digits[4..6].parse().ok()?, digits[6..8].parse().ok()?)
}

fn plural(n: i64) -> &'static str {
    if n > 1 { "s" } else { "" }
}

/// Jours restants avant l'echeance (negatif = depassee). `None` pour un avoir,
/// une facture soldee ou une echeance absente ou illisible.
fn due_days(s: &Map<String, Value>, t: &Totals, is_credit_note: bool, today: NaiveDate) -> Option<i64> {
    if is_credit_note || t.payable.as_ref().is_some_and(|p| p.v.0 <= 0) {
        return None;
    }
    let (v, _) = field(s, None, &["Date d'échéance"])?;
    Some((parse_date(&v)? - today).num_days())
}

fn check_dates(out: &mut Vec<Value>, s: &Map<String, Value>, t: &Totals, is_credit_note: bool, today: NaiveDate) {
    if is_credit_note || t.payable.as_ref().is_some_and(|p| p.v.0 <= 0) {
        return;
    }
    if let Some((v, path)) = field(s, None, &["Date d'échéance"]) {
        if let Some(days) = due_days(s, t, is_credit_note, today) {
            let note = "L'échéance ne préjuge pas du paiement effectif.";
            out.push(match days {
                d if d < 0 => simple(
                    &format!("Échéance dépassée depuis {} jour{}", -d, plural(-d)),
                    "alerte",
                    &path,
                    &format!("Échéance : {v}. {note}"),
                ),
                0 => simple("Échéance aujourd'hui", "alerte", &path, &format!("Échéance : {v}. {note}")),
                d => simple(
                    &format!("Échéance dans {d} jour{}", plural(d)),
                    "info",
                    &path,
                    &format!("Échéance : {v}"),
                ),
            });
        }
    }
    if let Some(pct) = &t.discount_pct {
        let gain = t.discount_amount.as_ref().map(|a| a.v).or_else(|| {
            t.payable.as_ref().and_then(|p| mul_cents(p.v, pct.v, Dec(100 * SCALE)))
        });
        if let Some(gain) = gain.filter(|g| *g > Dec::ZERO) {
            out.push(simple(
                &format!("Escompte de {} % pour paiement anticipé", pct.v),
                "info",
                &pct.path,
                &format!("Gain possible : {gain}. Voir les conditions de paiement pour le délai."),
            ));
        }
    }
}

// ------------------------------------------------------------------ point d'entree

fn provenance_input(label: &str, amount: Option<&Amt>) -> Value {
    match amount {
        Some(a) => json!({ "label": label, "value": a.raw, "path": a.path }),
        None => json!({ "label": label, "value": "0", "note": "Absent du XML, compté pour zéro dans ce contrôle" }),
    }
}

fn tax_breakdown_provenance(b: &Breakdown) -> Value {
    let input = |label: &str, amount: Option<&Amt>| match amount {
        Some(a) => provenance_input(label, Some(a)),
        None => json!({ "label": label, "value": "", "note": "Absent ou non numérique dans le XML" }),
    };
    let comparison = match (&b.base, &b.rate, &b.tax) {
        (Some(_), Some(_), Some(tax)) => tax_breakdown_expected(b).map(|expected| json!({
            "formula": "Base imposable × taux / 100 (arrondi au centime)",
            "expected": expected.to_string(),
            "found": tax.v.to_string(),
            "difference": Dec(tax.v.0 - expected.0).to_string(),
            "tolerance": Dec(CENT).to_string(),
            "matches": (tax.v.0 - expected.0).abs() <= CENT,
        })),
        _ => None,
    };
    json!({
        "rate": b.rate.as_ref().map(|a| a.raw.as_str()).unwrap_or(""),
        "inputs": [
            input("Base imposable déclarée", b.base.as_ref()),
            input("Taux déclaré (%)", b.rate.as_ref()),
            input("TVA déclarée", b.tax.as_ref()),
        ],
        "comparison": comparison,
    })
}

fn provenance_comparison(provenance: &mut Map<String, Value>, key: &str, formula: &str, expected: Dec, inputs: Vec<Value>) {
    if let Some(entry) = provenance.get_mut(key).and_then(Value::as_object_mut) {
        entry.insert("comparison".into(), json!({
            "formula": formula, "expected": expected.to_string(), "inputs": inputs,
        }));
    }
}

/// Synthese d'une facture pour le tableau multi-factures : montants en decimaux
/// sans devise, tels que lus dans le XML (jamais reconstitues, sauf la TVA
/// sommee par taux quand le total est absent).
fn synthese(s: &Map<String, Value>, t: &Totals, type_code: &str, is_credit_note: bool, today: NaiveDate) -> Value {
    let head = |titles: &[&str]| field(s, None, titles).map(|(v, _)| v).unwrap_or_default();
    let party = |name: &str| {
        field(s, Some(name), &["Raison sociale", "Dénomination légale"]).map(|(v, _)| v).unwrap_or_default()
    };
    let money = |a: Option<&Amt>| a.map(|x| x.v.to_string()).unwrap_or_default();
    let tva = t.tax.as_ref().map(|x| x.v).or_else(|| {
        (!t.breakdown.is_empty() && t.breakdown.iter().all(|b| b.tax.is_some()))
            .then(|| Dec(t.breakdown.iter().map(|b| val(&b.tax)).sum()))
    });
    // La provenance suit exactement les choix de valeur faits ci-dessus : un
    // champ XML reste un champ XML, même lorsque son libellé diffère (HT), et
    // seule la somme de TVA par taux est présentée comme calculée.
    let mut provenance = Map::new();
    for (key, title) in [("date", "Date d'émission"), ("echeance", "Date d'échéance")] {
        if let Some((value, path)) = field(s, None, &[title]) {
            if !path.is_empty() {
                provenance.insert(key.into(), json!({ "type": "extracted", "value": value, "path": path }));
            }
        }
    }
    let mut put_xml = |key: &str, value: String, path: String| {
        if !value.is_empty() && !path.is_empty() {
            provenance.insert(key.into(), json!({ "type": "xml", "value": value, "path": path }));
        }
    };
    for (key, amount) in [
        ("ht", t.basis.as_ref().or(t.lines_sum.as_ref())),
        ("ttc", t.grand.as_ref()),
        ("a_payer", t.payable.as_ref()),
    ] {
        if let Some(amount) = amount { put_xml(key, amount.raw.clone(), amount.path.clone()); }
    }
    if let Some(amount) = &t.tax {
        put_xml("tva", amount.raw.clone(), amount.path.clone());
    } else if let Some(total) = tva {
        let inputs: Vec<Value> = t.breakdown.iter().filter_map(|b| b.tax.as_ref())
            .map(|a| json!({ "value": a.raw, "path": a.path })).collect();
        provenance.insert("tva".into(), json!({
            "type": "calculated", "value": total.to_string(),
            "formula": "Somme des montants de TVA par taux", "inputs": inputs,
        }));
    }
    if let (Some(lines), Some(_basis)) = (&t.lines_sum, &t.basis) {
        let expected = Dec(lines.v.0 - val(&t.allowances) + val(&t.charges));
        provenance_comparison(&mut provenance, "ht", "Total des lignes − remises + frais", expected, vec![
            provenance_input("Total des lignes", Some(lines)),
            provenance_input("Remises", t.allowances.as_ref()),
            provenance_input("Frais", t.charges.as_ref()),
        ]);
    }
    if let (Some(ht), Some(tax), Some(_grand)) = (t.basis.as_ref().or(t.lines_sum.as_ref()), tva, &t.grand) {
        let tax_input = t.tax.as_ref().map(|a| provenance_input("TVA", Some(a))).unwrap_or_else(||
            json!({ "label": "TVA (somme des taux)", "value": tax.to_string(), "note": "Détail dans la carte Total TVA" }));
        provenance_comparison(&mut provenance, "ttc", "Total HT + total TVA", Dec(ht.v.0 + tax.0), vec![
            provenance_input("Total HT", Some(ht)), tax_input,
        ]);
    }
    if let (Some(grand), Some(_payable)) = (&t.grand, &t.payable) {
        provenance_comparison(&mut provenance, "a_payer", "Total TTC − acomptes + arrondi", Dec(grand.v.0 - val(&t.prepaid) + val(&t.rounding)), vec![
            provenance_input("Total TTC", Some(grand)),
            provenance_input("Acomptes", t.prepaid.as_ref()),
            provenance_input("Arrondi", t.rounding.as_ref()),
        ]);
    }
    let seller = |titles: &[&str]| field(s, Some("Vendeur"), titles).map(|(v, _)| v).unwrap_or_default();
    let iban = field(s, Some("Paiement"), &["IBAN"]);
    let lignes: Vec<Value> = t
        .lines
        .iter()
        .map(|l| {
            json!({
                "ref": l.reference,
                "nom": l.name,
                "qte": money(l.qty.as_ref()),
                "pu": l.price.as_ref().map(|x| x.v.to_string()).unwrap_or_default(),
                "total": money(l.total.as_ref()),
            })
        })
        .collect();
    let provenance_lignes: Vec<Value> = t.lines.iter().map(line_provenance).collect();
    let provenance_tva_taux: Vec<Value> = t.breakdown.iter().map(tax_breakdown_provenance).collect();
    json!({
        "vendeur_tva": seller(&["N° de TVA"]),
        "vendeur_id_legal": seller(&["SIREN / registre", "Identifiant légal"]),
        "iban": iban.as_ref().map(|(v, _)| v.clone()).unwrap_or_default(),
        "iban_path": iban.map(|(_, p)| p).unwrap_or_default(),
        "lignes": lignes,
        "provenance_lignes": provenance_lignes,
        "provenance_tva_taux": provenance_tva_taux,
        "numero": head(&["N° de facture"]),
        "type": type_code,
        "avoir": is_credit_note,
        "date": head(&["Date d'émission"]),
        "echeance": head(&["Date d'échéance"]),
        "jours_echeance": due_days(s, t, is_credit_note, today),
        "week_end": parse_date(&head(&["Date d'émission"]))
            .is_some_and(|d| chrono::Datelike::weekday(&d).number_from_monday() >= 6),
        "vendeur": party("Vendeur"),
        "acheteur": party("Acheteur"),
        "devise": head(&["Devise"]),
        "ht": money(t.basis.as_ref().or(t.lines_sum.as_ref())),
        "tva": tva.map(|v| v.to_string()).unwrap_or_default(),
        "ttc": money(t.grand.as_ref()),
        "a_payer": money(t.payable.as_ref()),
        "provenance": provenance,
    })
}

fn check_container(out: &mut Vec<Value>, conteneur: &super::PdfContainerInfo, xml_profil: Option<&str>) {
    // 1. Conteneur PDF/A-3
    if conteneur.est_pdfa && conteneur.pdfa_part == Some(3) {
        let conf = conteneur.pdfa_conformance.as_deref().unwrap_or("");
        out.push(json!({
            "regle": "PDF/A-3 déclaré dans les métadonnées",
            "etat": "conforme",
            "attendu": "PDF/A-3 (ISO 19005-3)",
            "constate": format!("PDF/A-3{}", conf),
            "detail": "Déclaration lue dans les métadonnées XMP. La conformité réelle du fichier à ISO 19005-3 n'est pas vérifiée.",
        }));
    } else if conteneur.est_pdfa {
        let part_str = conteneur.pdfa_part.map(|p| p.to_string()).unwrap_or_else(|| "?".into());
        out.push(json!({
            "regle": "PDF/A-3 déclaré dans les métadonnées",
            "etat": "alerte",
            "attendu": "PDF/A-3 (ISO 19005-3)",
            "constate": format!("PDF/A-{}", part_str),
            "detail": "Le fichier est un PDF/A mais pas de version 3 (requise pour l'embarquement de pièces jointes Factur-X).",
        }));
    } else {
        out.push(json!({
            "regle": "PDF/A-3 déclaré dans les métadonnées",
            "etat": "alerte",
            "attendu": "PDF/A-3 (ISO 19005-3)",
            "constate": "Non déclaré PDF/A",
            "detail": "Aucune déclaration de conformité PDF/A-3 trouvée dans les métadonnées XMP.",
        }));
    }

    // 2. Pièce jointe XML déclarée
    let pj_name = conteneur.nom_piece_jointe.as_deref().unwrap_or("factur-x.xml");
    if conteneur.piece_jointe_declaree {
        let rel_txt = conteneur.af_relationship.as_deref().unwrap_or("non précisée");
        out.push(json!({
            "regle": "Pièce jointe XML déclarée",
            "etat": "conforme",
            "attendu": "Déclarée dans le catalogue PDF (/AF ou /EmbeddedFiles)",
            "constate": format!("{} (relation : {})", pj_name, rel_txt),
            "detail": "La pièce jointe XML est déclarée dans le catalogue du PDF.",
        }));
    } else {
        out.push(json!({
            "regle": "Pièce jointe XML déclarée",
            "etat": "alerte",
            "attendu": "Déclarée dans le catalogue PDF (/AF ou /EmbeddedFiles)",
            "constate": format!("{} extrait hors catalogue", pj_name),
            "detail": "Le XML a été trouvé dans un flux du PDF mais n'est pas proprement déclaré dans les pièces jointes associées.",
        }));
    }

    // 3. Profil annoncé (XMP vs XML)
    if let Some(xmp_prof) = &conteneur.profil_xmp {
        let coherent = match xml_profil {
            Some(xml_prof) => {
                let x = xmp_prof.to_uppercase().replace([' ', '_', '-'], "");
                let m = xml_prof.to_uppercase().replace([' ', '_', '-'], "");
                m.contains(&x) || x.contains(&m) || (m.contains("EN16931") && x.contains("EN16931"))
            }
            None => true,
        };
        if coherent {
            out.push(json!({
                "regle": "Profil Factur-X annoncé",
                "etat": "conforme",
                "attendu": format!("Concordance XMP / XML ({})", xml_profil.unwrap_or("—")),
                "constate": format!("Profil XMP {}", xmp_prof),
                "detail": "Le niveau de conformité annoncé dans les métadonnées PDF correspond au profil du XML.",
            }));
        } else {
            out.push(json!({
                "regle": "Profil Factur-X annoncé",
                "etat": "ecart",
                "attendu": format!("Profil XML {}", xml_profil.unwrap_or("—")),
                "constate": format!("Profil XMP {}", xmp_prof),
                "ecart": "Divergence de profil",
                "detail": "Le profil déclaré dans les métadonnées PDF (XMP) ne correspond pas au profil du XML embarqué.",
            }));
        }
    } else {
        out.push(json!({
            "regle": "Profil Factur-X annoncé",
            "etat": "info",
            "attendu": "Profil annoncé dans les métadonnées XMP",
            "constate": "Non renseigné",
            "detail": "Les métadonnées XMP du PDF ne précisent pas de ConformanceLevel.",
        }));
    }

    // 4. Structure du fichier : quelques exigences de PDF/A-3 lues dans le PDF lui-meme.
    out.extend(conteneur.structure.iter().cloned());
}

/// Controles et synthese d'une facture UBL ou CII deja extraite (`structured`).
pub(super) fn run(
    root: N,
    format: &str,
    paths: &Paths,
    structured: &Map<String, Value>,
    conteneur: Option<&super::PdfContainerInfo>,
    today: NaiveDate,
) -> (Vec<Value>, Value) {
    let totals = if format == "UBL" { ubl_totals(root, paths) } else { cii_totals(root, paths) };
    let type_code = field(structured, None, &["Type de facture"]).map(|(v, _)| v).unwrap_or_default();
    let is_credit_note = root.tag_name().name() == "CreditNote" || type_code == "381";
    let mut out = Vec::new();
    // Famille de chaque controle : `calcul`, `mention`, `date` ou `conteneur`.
    let tag = |out: &mut Vec<Value>, from: usize, family: &str| {
        for item in &mut out[from..] {
            item["famille"] = family.into();
        }
    };
    check_lines(&mut out, &totals);
    check_totals(&mut out, &totals);
    tag(&mut out, 0, "calcul");
    let from = out.len();
    check_mentions(&mut out, structured);
    tag(&mut out, from, "mention");
    let from = out.len();
    check_dates(&mut out, structured, &totals, is_credit_note, today);
    tag(&mut out, from, "date");
    if let Some(c) = conteneur {
        let from = out.len();
        let xml_profil = field(structured, None, &["Profil", "ID de profil"]).map(|(v, _)| v);
        check_container(&mut out, c, xml_profil.as_deref());
        tag(&mut out, from, "conteneur");
    }
    let synthese = synthese(structured, &totals, &type_code, is_credit_note, today);
    (out, synthese)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decimaux() {
        assert_eq!(Dec::parse("12.5").unwrap(), (Dec(1_250_000_000), 1));
        assert_eq!(Dec::parse("-0.01").unwrap().0.to_string(), "-0.01");
        assert_eq!(Dec::parse("1234.56789").unwrap().0.to_string(), "1234.56789");
        assert_eq!(Dec::parse("7").unwrap().0.to_string(), "7.00");
        assert!(Dec::parse("").is_none());
        assert!(Dec::parse("1,5").is_none());
        assert!(Dec::parse("1e3").is_none());
        let d = |s: &str| Dec::parse(s).unwrap().0;
        // 0.1 + 0.2 = 0.3 exactement, contrairement aux flottants.
        assert_eq!(Dec(d("0.1").0 + d("0.2").0), d("0.3"));
        // Arrondi au centime, demi a l'ecart de zero.
        assert_eq!(mul_cents(d("3"), d("0.335"), Dec(SCALE)).unwrap().to_string(), "1.01");
        assert_eq!(mul_cents(d("-3"), d("0.335"), Dec(SCALE)).unwrap().to_string(), "-1.01");
        assert_eq!(mul_cents(d("100.00"), d("5.5"), Dec(100 * SCALE)).unwrap().to_string(), "5.50");
        assert!(mul_cents(d("1"), d("1"), Dec::ZERO).is_none());
    }

    #[test]
    fn identifiants() {
        assert_eq!(siren_siret_valid("732 829 320"), Some(true));
        assert_eq!(siren_siret_valid("732829321"), Some(false));
        assert_eq!(siren_siret_valid("73282932000074"), Some(true));
        assert_eq!(siren_siret_valid("DE123"), None);
        assert_eq!(fr_vat_valid("FR44732829320"), Some(true));
        assert_eq!(fr_vat_valid("FR45732829320"), Some(false));
        assert_eq!(fr_vat_valid("DE123456789"), None);
        assert_eq!(iban_valid("FR76 3000 6000 0112 3456 7890 189"), Some(true));
        assert_eq!(iban_valid("FR7630006000011234567890188"), Some(false));
        assert_eq!(iban_valid("compte 12"), None);
    }

    #[test]
    fn dates() {
        assert_eq!(parse_date("2026-10-10"), NaiveDate::from_ymd_opt(2026, 10, 10));
        assert_eq!(parse_date("20261010"), NaiveDate::from_ymd_opt(2026, 10, 10));
        assert_eq!(parse_date("2026-10-10T00:00:00"), NaiveDate::from_ymd_opt(2026, 10, 10));
        assert_eq!(parse_date("10/10/2026"), None);
        assert_eq!(parse_date("2026-13-40"), None);
    }
}
