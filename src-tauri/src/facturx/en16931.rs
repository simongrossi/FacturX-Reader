//! Regles metier de la norme EN 16931-1 (BR, BR-CO, BR-DEC, regles de TVA par
//! categorie), evaluees nativement sur le XML UBL ou CII.
//!
//! Ce n'est PAS le Schematron officiel : c'est une implementation directe des
//! regles a partir de leur enonce. Ne sont pas couverts : la validation XSD, les
//! listes de codes (hors categories de TVA), les regles nationales (CIUS) et le
//! conteneur PDF/A-3. Une regle sans objet pour la facture n'est pas emise.

use serde_json::{json, Value};

use super::controles::{mul_cents, Dec, CENT, SCALE};
use super::{attr, find, find_alt, findall, findall_alt, text, Paths, N, ON};

/// Terme metier lu dans le XML : valeur non vide et chemin.
#[derive(Clone, Debug)]
struct F {
    v: String,
    path: String,
}

impl F {
    fn dec(&self) -> Option<(Dec, u32)> {
        Dec::parse(&self.v)
    }
}

type OF = Option<F>;

#[derive(Default)]
struct Tax {
    path: String,
    basis: OF,
    amount: OF,
    cat: OF,
    rate: OF,
    reason: OF,
}

#[derive(Default)]
struct AllowanceCharge {
    path: String,
    charge: bool,
    amount: OF,
    cat: OF,
    rate: OF,
    reason: OF,
}

#[derive(Default)]
struct Line {
    path: String,
    id: OF,
    qty: OF,
    unit: Option<String>,
    net: OF,
    name: OF,
    price: OF,
    cat: OF,
    rate: OF,
}

#[derive(Default)]
struct Invoice {
    spec: OF,
    number: OF,
    date: OF,
    type_code: OF,
    currency: OF,
    due: OF,
    terms: OF,
    tax_point: OF,
    tax_point_code: OF,
    seller_name: OF,
    seller_address: Option<String>,
    seller_country: OF,
    seller_id: OF,
    seller_legal: OF,
    seller_vat: OF,
    seller_tax_reg: OF,
    buyer_name: OF,
    buyer_address: Option<String>,
    buyer_country: OF,
    buyer_vat: OF,
    buyer_legal: OF,
    rep_vat: OF,
    payment: Option<String>,
    pay_code: OF,
    account: OF,
    acs: Vec<AllowanceCharge>,
    taxes: Vec<Tax>,
    lines: Vec<Line>,
    lines_sum: OF,
    allowances: OF,
    charges: OF,
    basis: OF,
    tax_total: OF,
    grand: OF,
    prepaid: OF,
    rounding: OF,
    payable: OF,
}

fn is_true(el: ON) -> bool {
    matches!(text(el).to_lowercase().as_str(), "true" | "1")
}

// ------------------------------------------------------------------ lecture UBL

fn read_ubl(root: N, paths: &Paths) -> Invoice {
    let r = Some(root);
    let f = |el: ON| -> OF {
        let v = text(el);
        (!v.is_empty()).then(|| F { v, path: paths.of(el) })
    };
    // CompanyID d'un PartyTaxScheme selon que le regime est la TVA ou non.
    let tax_scheme = |party: ON, vat: bool| -> OF {
        findall(party, "PartyTaxScheme")
            .into_iter()
            .find(|s| (text(find(find(Some(*s), "TaxScheme"), "ID")).to_uppercase() == "VAT") == vat)
            .and_then(|s| f(find(Some(s), "CompanyID")))
    };
    let seller = find(find(r, "AccountingSupplierParty"), "Party");
    let buyer = find(find(r, "AccountingCustomerParty"), "Party");
    let seller_addr = find(seller, "PostalAddress");
    let buyer_addr = find(buyer, "PostalAddress");
    let currency = text(find(r, "DocumentCurrencyCode"));
    let tax_totals = findall(r, "TaxTotal");
    let tt = tax_totals
        .iter()
        .copied()
        .find(|t| attr(find(Some(*t), "TaxAmount"), "currencyID").as_deref() == Some(currency.as_str()))
        .or_else(|| tax_totals.first().copied());
    let lmt = find(r, "LegalMonetaryTotal");
    let pm = find(r, "PaymentMeans");
    let mut inv = Invoice {
        spec: f(find(r, "CustomizationID")),
        number: f(find(r, "ID")),
        date: f(find(r, "IssueDate")),
        type_code: f(find_alt(r, &["InvoiceTypeCode", "CreditNoteTypeCode"])),
        currency: f(find(r, "DocumentCurrencyCode")),
        due: f(find(r, "DueDate")).or_else(|| f(find(pm, "PaymentDueDate"))),
        terms: f(find(find(r, "PaymentTerms"), "Note")),
        tax_point: f(find(r, "TaxPointDate")),
        tax_point_code: f(find(find(r, "InvoicePeriod"), "DescriptionCode")),
        seller_name: f(find(find(seller, "PartyLegalEntity"), "RegistrationName")),
        seller_address: seller_addr.map(|a| paths.of(Some(a))),
        seller_country: f(find(find(seller_addr, "Country"), "IdentificationCode")),
        seller_id: f(find(find(seller, "PartyIdentification"), "ID")),
        seller_legal: f(find(find(seller, "PartyLegalEntity"), "CompanyID")),
        seller_vat: tax_scheme(seller, true),
        seller_tax_reg: tax_scheme(seller, false),
        buyer_name: f(find(find(buyer, "PartyLegalEntity"), "RegistrationName")),
        buyer_address: buyer_addr.map(|a| paths.of(Some(a))),
        buyer_country: f(find(find(buyer_addr, "Country"), "IdentificationCode")),
        buyer_vat: tax_scheme(buyer, true),
        buyer_legal: f(find(find(buyer, "PartyLegalEntity"), "CompanyID")),
        rep_vat: f(find(find(find(r, "TaxRepresentativeParty"), "PartyTaxScheme"), "CompanyID")),
        payment: pm.map(|p| paths.of(Some(p))),
        pay_code: f(find(pm, "PaymentMeansCode")),
        account: f(find(find(pm, "PayeeFinancialAccount"), "ID")),
        lines_sum: f(find(lmt, "LineExtensionAmount")),
        allowances: f(find(lmt, "AllowanceTotalAmount")),
        charges: f(find(lmt, "ChargeTotalAmount")),
        basis: f(find(lmt, "TaxExclusiveAmount")),
        tax_total: f(find(tt, "TaxAmount")),
        grand: f(find(lmt, "TaxInclusiveAmount")),
        prepaid: f(find(lmt, "PrepaidAmount")),
        rounding: f(find(lmt, "PayableRoundingAmount")),
        payable: f(find(lmt, "PayableAmount")),
        ..Invoice::default()
    };
    for ac in findall(r, "AllowanceCharge") {
        let a = Some(ac);
        let cat = find(a, "TaxCategory");
        inv.acs.push(AllowanceCharge {
            path: paths.of(a),
            charge: is_true(find(a, "ChargeIndicator")),
            amount: f(find(a, "Amount")),
            cat: f(find(cat, "ID")),
            rate: f(find(cat, "Percent")),
            reason: f(find(a, "AllowanceChargeReason")).or_else(|| f(find(a, "AllowanceChargeReasonCode"))),
        });
    }
    for sub in findall(tt, "TaxSubtotal") {
        let s = Some(sub);
        let cat = find(s, "TaxCategory");
        inv.taxes.push(Tax {
            path: paths.of(s),
            basis: f(find(s, "TaxableAmount")),
            amount: f(find(s, "TaxAmount")),
            cat: f(find(cat, "ID")),
            rate: f(find(cat, "Percent")),
            reason: f(find(cat, "TaxExemptionReason")).or_else(|| f(find(cat, "TaxExemptionReasonCode"))),
        });
    }
    for line in findall_alt(r, &["InvoiceLine", "CreditNoteLine"]) {
        let l = Some(line);
        let qty = find_alt(l, &["InvoicedQuantity", "CreditedQuantity"]);
        let item = find(l, "Item");
        let cat = find(item, "ClassifiedTaxCategory");
        inv.lines.push(Line {
            path: paths.of(l),
            id: f(find(l, "ID")),
            qty: f(qty),
            unit: attr(qty, "unitCode"),
            net: f(find(l, "LineExtensionAmount")),
            name: f(find(item, "Name")),
            price: f(find(find(l, "Price"), "PriceAmount")),
            cat: f(find(cat, "ID")),
            rate: f(find(cat, "Percent")),
        });
    }
    inv
}

// ------------------------------------------------------------------ lecture CII

fn read_cii(root: N, paths: &Paths) -> Invoice {
    let r = Some(root);
    let f = |el: ON| -> OF {
        let v = super::date_text(el);
        (!v.is_empty()).then(|| F { v, path: paths.of(el) })
    };
    // Identifiant fiscal selon son schemeID : VA = TVA, FC = autre enregistrement fiscal.
    let registration = |party: ON, scheme: &str| -> OF {
        findall(party, "SpecifiedTaxRegistration")
            .into_iter()
            .filter_map(|reg| find(Some(reg), "ID"))
            .find(|id| id.attribute("schemeID") == Some(scheme))
            .and_then(|id| f(Some(id)))
    };
    let doc = find(r, "ExchangedDocument");
    let txn = find(r, "SupplyChainTradeTransaction");
    let agreement = find_alt(txn, &["ApplicableHeaderTradeAgreement", "ApplicableTradeAgreement"]);
    let settlement = find_alt(txn, &["ApplicableHeaderTradeSettlement", "ApplicableTradeSettlement"]);
    let seller = find_alt(agreement, &["SellerTradeParty", "Seller"]);
    let buyer = find_alt(agreement, &["BuyerTradeParty", "Buyer"]);
    let seller_addr = find(seller, "PostalTradeAddress");
    let buyer_addr = find(buyer, "PostalTradeAddress");
    let terms = find(settlement, "SpecifiedTradePaymentTerms");
    let pm = find_alt(settlement, &["SpecifiedTradeSettlementPaymentMeans", "PaymentMeans"]);
    let account = find_alt(pm, &["PayeePartyCreditorFinancialAccount", "PayeePartyCreditAccount"]);
    let sum = find(settlement, "SpecifiedTradeSettlementHeaderMonetarySummation");
    let currency = text(find(settlement, "InvoiceCurrencyCode"));
    let tax_totals = findall(sum, "TaxTotalAmount");
    let tax_total = tax_totals
        .iter()
        .copied()
        .find(|t| t.attribute("currencyID") == Some(currency.as_str()))
        .or_else(|| tax_totals.first().copied());
    let first_tax = find(settlement, "ApplicableTradeTax");
    let mut inv = Invoice {
        spec: f(find(find(find(r, "ExchangedDocumentContext"), "GuidelineSpecifiedDocumentContextParameter"), "ID")),
        number: f(find(doc, "ID")),
        date: f(find(doc, "IssueDateTime")),
        type_code: f(find(doc, "TypeCode")),
        currency: f(find(settlement, "InvoiceCurrencyCode")),
        due: f(find(terms, "DueDateDateTime")),
        terms: f(find(terms, "Description")),
        tax_point: f(find(first_tax, "TaxPointDate")),
        tax_point_code: f(find(first_tax, "DueDateTypeCode")),
        seller_name: f(find(seller, "Name")),
        seller_address: seller_addr.map(|a| paths.of(Some(a))),
        seller_country: f(find(seller_addr, "CountryID")),
        seller_id: f(find_alt(seller, &["ID", "GlobalID"])),
        seller_legal: f(find(find(seller, "SpecifiedLegalOrganization"), "ID")),
        seller_vat: registration(seller, "VA"),
        seller_tax_reg: registration(seller, "FC"),
        buyer_name: f(find(buyer, "Name")),
        buyer_address: buyer_addr.map(|a| paths.of(Some(a))),
        buyer_country: f(find(buyer_addr, "CountryID")),
        buyer_vat: registration(buyer, "VA"),
        buyer_legal: f(find(find(buyer, "SpecifiedLegalOrganization"), "ID")),
        rep_vat: registration(find(agreement, "SellerTaxRepresentativeTradeParty"), "VA"),
        payment: pm.map(|p| paths.of(Some(p))),
        pay_code: f(find(pm, "TypeCode")),
        account: f(find_alt(account, &["IBANID", "ProprietaryID", "ID"])),
        lines_sum: f(find(sum, "LineTotalAmount")),
        allowances: f(find(sum, "AllowanceTotalAmount")),
        charges: f(find(sum, "ChargeTotalAmount")),
        basis: f(find(sum, "TaxBasisTotalAmount")),
        tax_total: f(tax_total),
        grand: f(find(sum, "GrandTotalAmount")),
        prepaid: f(find(sum, "TotalPrepaidAmount")),
        rounding: f(find(sum, "RoundingAmount")),
        payable: f(find(sum, "DuePayableAmount")),
        ..Invoice::default()
    };
    for ac in findall(settlement, "SpecifiedTradeAllowanceCharge") {
        let a = Some(ac);
        let cat = find(a, "CategoryTradeTax");
        inv.acs.push(AllowanceCharge {
            path: paths.of(a),
            charge: is_true(find(find(a, "ChargeIndicator"), "Indicator")),
            amount: f(find(a, "ActualAmount")),
            cat: f(find(cat, "CategoryCode")),
            rate: f(find(cat, "RateApplicablePercent")),
            reason: f(find(a, "Reason")).or_else(|| f(find(a, "ReasonCode"))),
        });
    }
    for tax in findall(settlement, "ApplicableTradeTax") {
        let t = Some(tax);
        inv.taxes.push(Tax {
            path: paths.of(t),
            basis: f(find(t, "BasisAmount")),
            amount: f(find(t, "CalculatedAmount")),
            cat: f(find(t, "CategoryCode")),
            rate: f(find(t, "RateApplicablePercent")),
            reason: f(find(t, "ExemptionReason")).or_else(|| f(find(t, "ExemptionReasonCode"))),
        });
    }
    for li in findall_alt(txn, &["IncludedSupplyChainTradeLineItem", "SpecifiedTradeLineItem"]) {
        let l = Some(li);
        let st = find_alt(l, &["SpecifiedLineTradeSettlement", "IncludedLineTradeSettlement"]);
        let agr = find_alt(l, &["SpecifiedLineTradeAgreement", "IncludedLineTradeAgreement"]);
        let qty = find(find_alt(l, &["SpecifiedLineTradeDelivery", "IncludedLineTradeDelivery"]), "BilledQuantity");
        let tax = find(st, "ApplicableTradeTax");
        inv.lines.push(Line {
            path: paths.of(l),
            id: f(find(find(l, "AssociatedDocumentLineDocument"), "LineID")),
            qty: f(qty),
            unit: attr(qty, "unitCode"),
            net: f(find(find(st, "SpecifiedTradeSettlementLineMonetarySummation"), "LineTotalAmount")),
            name: f(find(find_alt(l, &["SpecifiedTradeProduct", "DefinedTradeProduct"]), "Name")),
            price: f(find(find_alt(agr, &["NetPriceProductTradePrice", "NetPrice"]), "ChargeAmount")),
            cat: f(find(tax, "CategoryCode")),
            rate: f(find(tax, "RateApplicablePercent")),
        });
    }
    inv
}

// ------------------------------------------------------------------ evaluation

/// Les profils MINIMUM et BASIC WL de Factur-X ne portent pas toutes les donnees
/// de la norme : seules les regles qui ont un objet y sont evaluees.
#[derive(Clone, Copy, PartialEq)]
enum Level {
    Minimum,
    BasicWl,
    Full,
}

struct Rules {
    out: Vec<Value>,
}

impl Rules {
    fn check(&mut self, id: &str, label: &str, ok: bool, detail: impl Into<String>, path: &str) {
        self.out.push(json!({
            "id": id,
            "libelle": label,
            "etat": if ok { "conforme" } else { "non_conforme" },
            "detail": if ok { String::new() } else { detail.into() },
            "path": path,
        }));
    }

    /// Regle de presence d'un terme metier.
    fn present(&mut self, id: &str, label: &str, field: &OF) {
        let path = field.as_ref().map_or("", |f| f.path.as_str());
        self.check(id, label, field.is_some(), "Absent du XML.", path);
    }
}

fn amount(f: &OF) -> Option<Dec> {
    f.as_ref().and_then(|x| x.dec()).map(|(d, _)| d)
}

fn zero_if_absent(f: &OF) -> Option<Dec> {
    match f {
        None => Some(Dec(0)),
        Some(x) => x.dec().map(|(d, _)| d),
    }
}

fn cat_of(f: &OF) -> &str {
    f.as_ref().map_or("", |x| x.v.as_str())
}

fn line_label(line: &Line) -> String {
    match &line.id {
        Some(id) => format!("ligne {}", id.v),
        None => "ligne sans identifiant".to_string(),
    }
}

fn presence_rules(r: &mut Rules, inv: &Invoice, level: Level) {
    r.present("BR-01", "Identifiant de spécification (BT-24)", &inv.spec);
    r.present("BR-02", "Numéro de facture (BT-1)", &inv.number);
    r.present("BR-03", "Date d'émission (BT-2)", &inv.date);
    r.present("BR-04", "Code de type de facture (BT-3)", &inv.type_code);
    r.present("BR-05", "Code de devise (BT-5)", &inv.currency);
    r.present("BR-06", "Nom du vendeur (BT-27)", &inv.seller_name);
    r.present("BR-07", "Nom de l'acheteur (BT-44)", &inv.buyer_name);
    if level != Level::Minimum {
        let addr = inv.seller_address.clone().unwrap_or_default();
        r.check("BR-08", "Adresse postale du vendeur (BG-5)", inv.seller_address.is_some(), "Absente du XML.", &addr);
    }
    r.present("BR-09", "Code pays du vendeur (BT-40)", &inv.seller_country);
    if level != Level::Minimum {
        let addr = inv.buyer_address.clone().unwrap_or_default();
        r.check("BR-10", "Adresse postale de l'acheteur (BG-8)", inv.buyer_address.is_some(), "Absente du XML.", &addr);
        r.present("BR-11", "Code pays de l'acheteur (BT-55)", &inv.buyer_country);
        r.present("BR-12", "Somme des montants nets des lignes (BT-106)", &inv.lines_sum);
    }
    r.present("BR-13", "Total hors TVA (BT-109)", &inv.basis);
    r.present("BR-14", "Total TVA comprise (BT-112)", &inv.grand);
    r.present("BR-15", "Montant à payer (BT-115)", &inv.payable);
    let ok = inv.seller_id.is_some() || inv.seller_legal.is_some() || inv.seller_vat.is_some();
    r.check(
        "BR-CO-26",
        "Identification du vendeur (BT-29, BT-30 ou BT-31)",
        ok,
        "Ni identifiant, ni identifiant légal, ni n° de TVA du vendeur.",
        "",
    );
}

fn line_rules(r: &mut Rules, inv: &Invoice) {
    r.check("BR-16", "Au moins une ligne de facture (BG-25)", !inv.lines.is_empty(), "Aucune ligne.", "");
    // Une regle par nature de controle, toutes lignes confondues.
    let mut per_line = |id: &str, label: &str, test: &dyn Fn(&Line) -> bool| {
        let failing: Vec<&Line> = inv.lines.iter().filter(|l| !test(l)).collect();
        let detail = failing.iter().take(8).map(|l| line_label(l)).collect::<Vec<_>>().join(", ");
        let more = if failing.len() > 8 { format!(" et {} autres", failing.len() - 8) } else { String::new() };
        let path = failing.first().map_or("", |l| l.path.as_str()).to_string();
        r.check(id, label, failing.is_empty(), format!("Non respecté : {detail}{more}."), &path);
    };
    if inv.lines.is_empty() {
        return;
    }
    per_line("BR-21", "Identifiant de chaque ligne (BT-126)", &|l| l.id.is_some());
    per_line("BR-22", "Quantité facturée de chaque ligne (BT-129)", &|l| l.qty.is_some());
    per_line("BR-23", "Unité de mesure de chaque quantité (BT-130)", &|l| l.unit.is_some());
    per_line("BR-24", "Montant net de chaque ligne (BT-131)", &|l| l.net.is_some());
    per_line("BR-25", "Nom de l'article de chaque ligne (BT-153)", &|l| l.name.is_some());
    per_line("BR-26", "Prix net de l'article de chaque ligne (BT-146)", &|l| l.price.is_some());
    per_line("BR-27", "Prix net de l'article non négatif (BT-146)", &|l| amount(&l.price).is_none_or(|p| p.0 >= 0));
    per_line("BR-CO-04", "Catégorie de TVA de chaque ligne (BT-151)", &|l| l.cat.is_some());
    per_line("BR-DEC-23", "Montant net de ligne à 2 décimales au plus (BT-131)", &|l| {
        l.net.as_ref().is_none_or(|n| n.dec().is_some_and(|(_, dp)| dp <= 2))
    });
}

fn document_rules(r: &mut Rules, inv: &Invoice, level: Level) {
    for ac in &inv.acs {
        let (ids, what) = if ac.charge {
            (["BR-36", "BR-37", "BR-38"], "frais de niveau document")
        } else {
            (["BR-31", "BR-32", "BR-33"], "remise de niveau document")
        };
        r.check(ids[0], &format!("Montant de chaque {what}"), ac.amount.is_some(), "Montant absent.", &ac.path);
        r.check(ids[1], &format!("Catégorie de TVA de chaque {what}"), ac.cat.is_some(), "Catégorie absente.", &ac.path);
        r.check(ids[2], &format!("Motif ou code de motif de chaque {what}"), ac.reason.is_some(), "Motif absent.", &ac.path);
    }
    for tax in &inv.taxes {
        r.check("BR-45", "Base d'imposition de chaque ventilation de TVA (BT-116)", tax.basis.is_some(), "Base absente.", &tax.path);
        r.check("BR-46", "Montant de TVA de chaque ventilation (BT-117)", tax.amount.is_some(), "Montant absent.", &tax.path);
        r.check("BR-47", "Catégorie de TVA de chaque ventilation (BT-118)", tax.cat.is_some(), "Catégorie absente.", &tax.path);
        let ok = tax.rate.is_some() || cat_of(&tax.cat) == "O";
        r.check("BR-48", "Taux de TVA de chaque ventilation (BT-119)", ok, "Taux absent.", &tax.path);
        let known = matches!(cat_of(&tax.cat), "S" | "Z" | "E" | "AE" | "K" | "G" | "O" | "L" | "M" | "B");
        if tax.cat.is_some() {
            r.check(
                "BR-CL-17",
                "Code de catégorie de TVA connu (UNCL 5305)",
                known,
                format!("Code inconnu : {}.", cat_of(&tax.cat)),
                &tax.path,
            );
        }
    }
    r.check(
        "BR-CO-18",
        "Au moins une ventilation de TVA (BG-23)",
        !inv.taxes.is_empty(),
        "Aucune ventilation de TVA.",
        "",
    );
    if let Some(path) = &inv.payment {
        r.check(
            "BR-49",
            "Code de moyen de paiement (BT-81)",
            inv.pay_code.is_some(),
            "Instructions de paiement sans code.",
            path,
        );
        if matches!(cat_of(&inv.pay_code), "30" | "58") {
            r.check(
                "BR-61",
                "Compte de paiement pour un virement (BT-84)",
                inv.account.is_some(),
                "Virement sans identifiant de compte.",
                path,
            );
        }
    }
    if inv.tax_point.is_some() || inv.tax_point_code.is_some() {
        let both = inv.tax_point.is_some() && inv.tax_point_code.is_some();
        r.check(
            "BR-CO-03",
            "Date d'exigibilité de la TVA et son code mutuellement exclusifs (BT-7, BT-8)",
            !both,
            "Les deux sont présents.",
            inv.tax_point.as_ref().map_or("", |f| f.path.as_str()),
        );
    }
    for (name, vat) in [("vendeur (BT-31)", &inv.seller_vat), ("acheteur (BT-48)", &inv.buyer_vat), ("représentant fiscal (BT-63)", &inv.rep_vat)] {
        if let Some(v) = vat {
            let ok = v.v.len() > 2 && v.v.bytes().take(2).all(|b| b.is_ascii_uppercase());
            r.check(
                "BR-CO-09",
                &format!("N° de TVA du {name} préfixé par un code pays"),
                ok,
                format!("Préfixe invalide : {}.", v.v),
                &v.path,
            );
        }
    }
    if amount(&inv.payable).is_some_and(|p| p.0 > 0) && level != Level::Minimum {
        r.check(
            "BR-CO-25",
            "Échéance ou conditions de paiement si le montant à payer est positif (BT-9, BT-20)",
            inv.due.is_some() || inv.terms.is_some(),
            "Ni date d'échéance ni conditions de paiement.",
            inv.payable.as_ref().map_or("", |f| f.path.as_str()),
        );
    }
}

fn calculation_rules(r: &mut Rules, inv: &Invoice, level: Level) {
    let mut equal = |id: &str, label: &str, expected: Option<Dec>, found: &OF, tolerance: i128| {
        let (Some(expected), Some(f)) = (expected, found) else { return };
        let Some((value, _)) = f.dec() else {
            r.check(id, label, false, format!("Montant non numérique : {}.", f.v), &f.path);
            return;
        };
        let ok = (value.0 - expected.0).abs() <= tolerance;
        r.check(id, label, ok, format!("Attendu {expected}, constaté {value}."), &f.path);
    };
    if level == Level::Full && !inv.lines.is_empty() && inv.lines.iter().all(|l| amount(&l.net).is_some()) {
        let sum = Dec(inv.lines.iter().filter_map(|l| amount(&l.net)).map(|d| d.0).sum());
        equal("BR-CO-10", "Somme des lignes = total des lignes (BT-106)", Some(sum), &inv.lines_sum, 0);
    }
    if level != Level::Minimum {
        let side = |charge: bool| -> Option<Dec> {
            let items: Vec<&AllowanceCharge> = inv.acs.iter().filter(|a| a.charge == charge).collect();
            items.iter().map(|a| amount(&a.amount).map(|d| d.0)).sum::<Option<i128>>().map(Dec)
        };
        equal("BR-CO-11", "Total des remises = somme des remises de niveau document (BT-107)", side(false), &inv.allowances, 0);
        equal("BR-CO-12", "Total des frais = somme des frais de niveau document (BT-108)", side(true), &inv.charges, 0);
        let net = match (amount(&inv.lines_sum), zero_if_absent(&inv.allowances), zero_if_absent(&inv.charges)) {
            (Some(l), Some(a), Some(c)) => Some(Dec(l.0 - a.0 + c.0)),
            _ => None,
        };
        equal("BR-CO-13", "Total HT = total des lignes − remises + frais (BT-109)", net, &inv.basis, 0);
        if !inv.taxes.is_empty() {
            let sum = inv.taxes.iter().map(|t| amount(&t.amount).map(|d| d.0)).sum::<Option<i128>>().map(Dec);
            equal("BR-CO-14", "Total TVA = somme des TVA par catégorie (BT-110)", sum, &inv.tax_total, 0);
        }
    }
    let gross = match (amount(&inv.basis), zero_if_absent(&inv.tax_total)) {
        (Some(b), Some(t)) => Some(Dec(b.0 + t.0)),
        _ => None,
    };
    equal("BR-CO-15", "Total TTC = total HT + total TVA (BT-112)", gross, &inv.grand, 0);
    let due = match (amount(&inv.grand), zero_if_absent(&inv.prepaid), zero_if_absent(&inv.rounding)) {
        (Some(g), Some(p), Some(rd)) => Some(Dec(g.0 - p.0 + rd.0)),
        _ => None,
    };
    equal("BR-CO-16", "Montant à payer = total TTC − acomptes + arrondi (BT-115)", due, &inv.payable, 0);
    // La norme tolere moins d'une unite monetaire d'ecart sur la TVA par categorie.
    for tax in &inv.taxes {
        if let (Some(basis), Some(rate)) = (amount(&tax.basis), amount(&tax.rate)) {
            let label = format!("TVA de la catégorie {} à {} % = base × taux (BT-117)", cat_of(&tax.cat), rate);
            equal("BR-CO-17", &label, mul_cents(basis, rate, Dec(100 * SCALE)), &tax.amount, SCALE - CENT);
        }
    }
    for (id, label, field) in [
        ("BR-DEC-09", "Total des lignes à 2 décimales au plus (BT-106)", &inv.lines_sum),
        ("BR-DEC-10", "Total des remises à 2 décimales au plus (BT-107)", &inv.allowances),
        ("BR-DEC-11", "Total des frais à 2 décimales au plus (BT-108)", &inv.charges),
        ("BR-DEC-12", "Total HT à 2 décimales au plus (BT-109)", &inv.basis),
        ("BR-DEC-13", "Total TVA à 2 décimales au plus (BT-110)", &inv.tax_total),
        ("BR-DEC-14", "Total TTC à 2 décimales au plus (BT-112)", &inv.grand),
        ("BR-DEC-16", "Montant payé à 2 décimales au plus (BT-113)", &inv.prepaid),
        ("BR-DEC-17", "Arrondi à 2 décimales au plus (BT-114)", &inv.rounding),
        ("BR-DEC-18", "Montant à payer à 2 décimales au plus (BT-115)", &inv.payable),
    ] {
        if let Some(f) = field {
            let ok = f.dec().is_some_and(|(_, dp)| dp <= 2);
            r.check(id, label, ok, format!("Valeur : {}.", f.v), &f.path);
        }
    }
    for tax in &inv.taxes {
        for (id, label, field) in [
            ("BR-DEC-19", "Base d'imposition à 2 décimales au plus (BT-116)", &tax.basis),
            ("BR-DEC-20", "Montant de TVA par catégorie à 2 décimales au plus (BT-117)", &tax.amount),
        ] {
            if let Some(f) = field {
                let ok = f.dec().is_some_and(|(_, dp)| dp <= 2);
                r.check(id, label, ok, format!("Valeur : {}.", f.v), &f.path);
            }
        }
    }
}

/// Regles propres a une categorie de TVA (BR-S, BR-Z, BR-E, BR-AE, BR-IC, BR-G, BR-O).
fn vat_category_rules(r: &mut Rules, inv: &Invoice, level: Level) {
    let categories = [
        ("S", "S", "taux normal"),
        ("Z", "Z", "taux zéro"),
        ("E", "E", "exonéré"),
        ("AE", "AE", "autoliquidation"),
        ("K", "IC", "livraison intracommunautaire"),
        ("G", "G", "export hors UE"),
        ("O", "O", "hors champ de la TVA"),
    ];
    let seller_tax_id = inv.seller_vat.is_some() || inv.seller_tax_reg.is_some() || inv.rep_vat.is_some();
    for (code, prefix, name) in categories {
        let lines: Vec<&Line> = inv.lines.iter().filter(|l| cat_of(&l.cat) == code).collect();
        let acs: Vec<&AllowanceCharge> = inv.acs.iter().filter(|a| cat_of(&a.cat) == code).collect();
        let taxes: Vec<&Tax> = inv.taxes.iter().filter(|t| cat_of(&t.cat) == code).collect();
        if lines.is_empty() && acs.is_empty() && taxes.is_empty() {
            continue;
        }
        let id = |n: &str| format!("BR-{prefix}-{n}");
        let first_path = taxes.first().map(|t| t.path.as_str()).or(lines.first().map(|l| l.path.as_str())).unwrap_or("");

        // 01 : la ventilation contient la categorie utilisee par les lignes, remises ou frais.
        if !lines.is_empty() || !acs.is_empty() {
            let ok = if code == "S" { !taxes.is_empty() } else { taxes.len() == 1 };
            let detail = if code == "S" { "Aucune ventilation pour cette catégorie." } else { "Il faut exactement une ventilation pour cette catégorie." };
            r.check(&id("01"), &format!("Ventilation de TVA présente pour la catégorie {code} ({name})"), ok, detail, first_path);
        }
        // 02 a 04 : identification fiscale des parties.
        let (ok, label, detail) = match code {
            "O" => (
                inv.seller_vat.is_none() && inv.rep_vat.is_none() && inv.buyer_vat.is_none(),
                "Aucun n° de TVA du vendeur, de son représentant ni de l'acheteur".to_string(),
                "Un n° de TVA est présent alors que la facture est hors champ.",
            ),
            "AE" => (
                seller_tax_id && (inv.buyer_vat.is_some() || inv.buyer_legal.is_some()),
                "N° de TVA du vendeur, et n° de TVA ou identifiant légal de l'acheteur".to_string(),
                "Identifiant fiscal du vendeur ou de l'acheteur absent.",
            ),
            "K" => (
                (inv.seller_vat.is_some() || inv.rep_vat.is_some()) && inv.buyer_vat.is_some(),
                "N° de TVA du vendeur et de l'acheteur".to_string(),
                "N° de TVA du vendeur ou de l'acheteur absent.",
            ),
            "G" => (
                inv.seller_vat.is_some() || inv.rep_vat.is_some(),
                "N° de TVA du vendeur ou de son représentant fiscal".to_string(),
                "N° de TVA du vendeur absent.",
            ),
            _ => (
                seller_tax_id,
                "N° de TVA, identifiant fiscal du vendeur ou n° de TVA de son représentant".to_string(),
                "Aucun identifiant fiscal du vendeur.",
            ),
        };
        r.check(&id("02"), &format!("Catégorie {code} : {label}"), ok, detail, first_path);

        // 05 a 07 : taux coherent avec la categorie.
        let rates = lines.iter().map(|l| (&l.rate, l.path.as_str())).chain(acs.iter().map(|a| (&a.rate, a.path.as_str())));
        let bad: Vec<&str> = rates
            .filter(|(rate, _)| match code {
                "S" => !amount(rate).is_some_and(|d| d.0 > 0),
                "O" => rate.is_some(),
                _ => !amount(rate).is_some_and(|d| d.0 == 0),
            })
            .map(|(_, path)| path)
            .collect();
        let expected = match code {
            "S" => "supérieur à zéro",
            "O" => "absent",
            _ => "égal à zéro",
        };
        r.check(
            &id("05"),
            &format!("Catégorie {code} : taux de TVA {expected} sur les lignes, remises et frais"),
            bad.is_empty(),
            format!("{} élément(s) avec un taux incohérent.", bad.len()),
            bad.first().copied().unwrap_or(""),
        );

        // 08 : base d'imposition = lignes - remises + frais de la categorie (par taux pour S).
        if level == Level::Full {
            for tax in &taxes {
                let same_rate = |rate: &OF| code != "S" || amount(rate) == amount(&tax.rate);
                let parts: Option<i128> = lines
                    .iter()
                    .filter(|l| same_rate(&l.rate))
                    .map(|l| amount(&l.net).map(|d| d.0))
                    .chain(acs.iter().filter(|a| same_rate(&a.rate)).map(|a| amount(&a.amount).map(|d| if a.charge { d.0 } else { -d.0 })))
                    .sum();
                if let (Some(expected), Some(found)) = (parts, amount(&tax.basis)) {
                    let expected = Dec(expected);
                    r.check(
                        &id("08"),
                        &format!("Catégorie {code} : base d'imposition = lignes − remises + frais (BT-116)"),
                        expected == found,
                        format!("Attendu {expected}, constaté {found}."),
                        tax.basis.as_ref().map_or("", |f| f.path.as_str()),
                    );
                }
            }
        }
        // 09 : montant de TVA nul hors taux normal (le taux normal releve de BR-CO-17).
        if code != "S" {
            for tax in &taxes {
                if let Some(found) = amount(&tax.amount) {
                    r.check(
                        &id("09"),
                        &format!("Catégorie {code} : montant de TVA égal à zéro (BT-117)"),
                        found.0 == 0,
                        format!("Constaté {found}."),
                        tax.amount.as_ref().map_or("", |f| f.path.as_str()),
                    );
                }
            }
        }
        // 10 : motif d'exoneration interdit (S, Z) ou obligatoire (autres).
        for tax in &taxes {
            let (ok, label, detail) = if matches!(code, "S" | "Z") {
                (tax.reason.is_none(), "pas de motif d'exonération", "Un motif d'exonération est présent.")
            } else {
                (tax.reason.is_some(), "motif ou code de motif d'exonération présent", "Motif d'exonération absent.")
            };
            r.check(&id("10"), &format!("Catégorie {code} : {label} (BT-120, BT-121)"), ok, detail, &tax.path);
        }
    }
}

/// Evalue les regles metier EN 16931 et retourne le rapport.
pub(super) fn run(root: N, format: &str, paths: &Paths) -> Value {
    let inv = if format == "UBL" { read_ubl(root, paths) } else { read_cii(root, paths) };
    let spec = inv.spec.as_ref().map(|f| f.v.to_lowercase()).unwrap_or_default();
    let level = if spec.contains("minimum") {
        Level::Minimum
    } else if spec.contains("basicwl") {
        Level::BasicWl
    } else {
        Level::Full
    };
    let mut r = Rules { out: Vec::new() };
    presence_rules(&mut r, &inv, level);
    if level == Level::Full {
        line_rules(&mut r, &inv);
    }
    if level != Level::Minimum {
        document_rules(&mut r, &inv, level);
    }
    calculation_rules(&mut r, &inv, level);
    if level != Level::Minimum {
        vat_category_rules(&mut r, &inv, level);
    }
    let failed = r.out.iter().filter(|x| x["etat"] == "non_conforme").count();
    json!({
        "niveau": match level {
            Level::Minimum => "Profil MINIMUM : hors norme EN 16931, seules les règles ayant un objet sont évaluées.",
            Level::BasicWl => "Profil BASIC WL : hors norme EN 16931, règles de ligne non évaluées.",
            Level::Full => "Règles métier EN 16931 (implémentation native, hors Schematron officiel).",
        },
        "evaluees": r.out.len(),
        "non_conformes": failed,
        "liste": r.out,
    })
}

#[cfg(test)]
mod tests {
    use super::super::parse_xml;
    use super::*;

    const CII: &str = r#"<rsm:CrossIndustryInvoice xmlns:rsm="urn:rsm" xmlns:ram="urn:ram" xmlns:udt="urn:udt">
<rsm:ExchangedDocumentContext><ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>urn:cen.eu:en16931:2017</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter></rsm:ExchangedDocumentContext>
<rsm:ExchangedDocument><ram:ID>F-1</ram:ID><ram:TypeCode>380</ram:TypeCode><ram:IssueDateTime><udt:DateTimeString format="102">20260924</udt:DateTimeString></ram:IssueDateTime></rsm:ExchangedDocument>
<rsm:SupplyChainTradeTransaction>
<ram:IncludedSupplyChainTradeLineItem><ram:AssociatedDocumentLineDocument><ram:LineID>1</ram:LineID></ram:AssociatedDocumentLineDocument><ram:SpecifiedTradeProduct><ram:Name>Papier</ram:Name></ram:SpecifiedTradeProduct><ram:SpecifiedLineTradeAgreement><ram:NetPriceProductTradePrice><ram:ChargeAmount>50.00</ram:ChargeAmount></ram:NetPriceProductTradePrice></ram:SpecifiedLineTradeAgreement><ram:SpecifiedLineTradeDelivery><ram:BilledQuantity unitCode="C62">2</ram:BilledQuantity></ram:SpecifiedLineTradeDelivery><ram:SpecifiedLineTradeSettlement><ram:ApplicableTradeTax><ram:TypeCode>VAT</ram:TypeCode><ram:CategoryCode>S</ram:CategoryCode><ram:RateApplicablePercent>20.00</ram:RateApplicablePercent></ram:ApplicableTradeTax><ram:SpecifiedTradeSettlementLineMonetarySummation><ram:LineTotalAmount>100.00</ram:LineTotalAmount></ram:SpecifiedTradeSettlementLineMonetarySummation></ram:SpecifiedLineTradeSettlement></ram:IncludedSupplyChainTradeLineItem>
<ram:ApplicableHeaderTradeAgreement>
<ram:SellerTradeParty><ram:Name>Vendeur SAS</ram:Name><ram:PostalTradeAddress><ram:CountryID>FR</ram:CountryID></ram:PostalTradeAddress><ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">FR44732829320</ram:ID></ram:SpecifiedTaxRegistration></ram:SellerTradeParty>
<ram:BuyerTradeParty><ram:Name>Acheteur SARL</ram:Name><ram:PostalTradeAddress><ram:CountryID>FR</ram:CountryID></ram:PostalTradeAddress></ram:BuyerTradeParty>
</ram:ApplicableHeaderTradeAgreement>
<ram:ApplicableHeaderTradeSettlement><ram:InvoiceCurrencyCode>EUR</ram:InvoiceCurrencyCode>
<ram:SpecifiedTradeSettlementPaymentMeans><ram:TypeCode>58</ram:TypeCode><ram:PayeePartyCreditorFinancialAccount><ram:IBANID>FR7630006000011234567890189</ram:IBANID></ram:PayeePartyCreditorFinancialAccount></ram:SpecifiedTradeSettlementPaymentMeans>
<ram:ApplicableTradeTax><ram:CalculatedAmount>20.00</ram:CalculatedAmount><ram:TypeCode>VAT</ram:TypeCode><ram:BasisAmount>100.00</ram:BasisAmount><ram:CategoryCode>S</ram:CategoryCode><ram:RateApplicablePercent>20.00</ram:RateApplicablePercent></ram:ApplicableTradeTax>
<ram:SpecifiedTradePaymentTerms><ram:DueDateDateTime><udt:DateTimeString format="102">20261030</udt:DateTimeString></ram:DueDateDateTime></ram:SpecifiedTradePaymentTerms>
<ram:SpecifiedTradeSettlementHeaderMonetarySummation><ram:LineTotalAmount>100.00</ram:LineTotalAmount><ram:TaxBasisTotalAmount>100.00</ram:TaxBasisTotalAmount><ram:TaxTotalAmount currencyID="EUR">20.00</ram:TaxTotalAmount><ram:GrandTotalAmount>120.00</ram:GrandTotalAmount><ram:DuePayableAmount>120.00</ram:DuePayableAmount></ram:SpecifiedTradeSettlementHeaderMonetarySummation>
</ram:ApplicableHeaderTradeSettlement>
</rsm:SupplyChainTradeTransaction></rsm:CrossIndustryInvoice>"#;

    fn failed(xml: &str) -> Vec<String> {
        let doc = parse_xml(xml).unwrap();
        let root = doc.root_element();
        let report = run(root, "CII", &Paths::build(root));
        let list = report["liste"].as_array().unwrap();
        assert_eq!(report["evaluees"], list.len());
        let ids: Vec<String> =
            list.iter().filter(|x| x["etat"] == "non_conforme").map(|x| x["id"].as_str().unwrap().to_string()).collect();
        assert_eq!(report["non_conformes"], ids.len());
        ids
    }

    #[test]
    fn facture_conforme() {
        assert_eq!(failed(CII), Vec::<String>::new());
    }

    #[test]
    fn mentions_et_calculs() {
        let xml = CII.replace("<ram:Name>Acheteur SARL</ram:Name>", "").replace("<ram:GrandTotalAmount>120.00", "<ram:GrandTotalAmount>120.01");
        assert_eq!(failed(&xml), ["BR-07", "BR-CO-15", "BR-CO-16"]);
        // Trois decimales et virement sans compte.
        let xml = CII
            .replace("<ram:DuePayableAmount>120.00", "<ram:DuePayableAmount>120.000")
            .replace("<ram:PayeePartyCreditorFinancialAccount><ram:IBANID>FR7630006000011234567890189</ram:IBANID></ram:PayeePartyCreditorFinancialAccount>", "");
        assert_eq!(failed(&xml), ["BR-61", "BR-DEC-18"]);
        // Sans echeance ni conditions de paiement, sans identification du vendeur.
        let xml = CII
            .replace("<ram:SpecifiedTradePaymentTerms><ram:DueDateDateTime><udt:DateTimeString format=\"102\">20261030</udt:DateTimeString></ram:DueDateDateTime></ram:SpecifiedTradePaymentTerms>", "")
            .replace("<ram:SpecifiedTaxRegistration><ram:ID schemeID=\"VA\">FR44732829320</ram:ID></ram:SpecifiedTaxRegistration>", "");
        assert_eq!(failed(&xml), ["BR-CO-26", "BR-CO-25", "BR-S-02"]);
    }

    #[test]
    fn categories_de_tva() {
        // Ligne exoneree declaree avec un taux et une TVA non nulle, sans motif.
        let xml = CII.replace("<ram:CategoryCode>S</ram:CategoryCode>", "<ram:CategoryCode>E</ram:CategoryCode>");
        assert_eq!(failed(&xml), ["BR-E-05", "BR-E-09", "BR-E-10"]);
        // Base d'imposition differente de la somme des lignes de la categorie.
        let xml = CII.replace("<ram:BasisAmount>100.00", "<ram:BasisAmount>90.00");
        assert_eq!(failed(&xml), ["BR-CO-17", "BR-S-08"]);
        // Ligne au taux normal sans ventilation correspondante.
        let xml = CII.replace(
            "<ram:BasisAmount>100.00</ram:BasisAmount><ram:CategoryCode>S</ram:CategoryCode><ram:RateApplicablePercent>20.00",
            "<ram:BasisAmount>100.00</ram:BasisAmount><ram:CategoryCode>Z</ram:CategoryCode><ram:RateApplicablePercent>0.00",
        );
        assert!(failed(&xml).contains(&"BR-S-01".to_string()));
    }

    #[test]
    fn profil_minimum() {
        let xml = CII.replace("urn:cen.eu:en16931:2017", "urn:factur-x.eu:1p0:minimum");
        let doc = parse_xml(&xml).unwrap();
        let root = doc.root_element();
        let report = run(root, "CII", &Paths::build(root));
        assert!(report["niveau"].as_str().unwrap().starts_with("Profil MINIMUM"));
        assert!(report["liste"].as_array().unwrap().iter().all(|x| x["id"] != "BR-16" && x["id"] != "BR-CO-18"));
        assert_eq!(report["non_conformes"], 0);
    }
}
