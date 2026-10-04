//! Extraction et présentation des données CII du XML.

use super::*;

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
        paths.add(
            &mut rows,
            "N° de TVA",
            find(reg, "ID"),
            attr(reg, "schemeID"),
        );
        paths.add(
            &mut rows,
            "Identifiant légal",
            find(find(party, "SpecifiedLegalOrganization"), "ID"),
            None,
        );
        let addr = find(party, "PostalTradeAddress");
        paths.add(&mut rows, "Rue", find(addr, "LineOne"), None);
        paths.add(
            &mut rows,
            "Complément d'adresse",
            find(addr, "LineTwo"),
            None,
        );
        paths.add(&mut rows, "Ville", find(addr, "CityName"), None);
        paths.add(
            &mut rows,
            "Code postal",
            find_alt(addr, &["Postcode", "PostcodeCode"]),
            None,
        );
        paths.add(
            &mut rows,
            "Département",
            find(addr, "CountrySubentity"),
            None,
        );
        paths.add(&mut rows, "Pays", find(addr, "CountryID"), None);
        let contact = find(party, "DefinedTradeContact");
        paths.add(&mut rows, "Contact", find(contact, "PersonName"), None);
        paths.add(
            &mut rows,
            "Téléphone",
            find(contact, "TelephoneNumber"),
            None,
        );
        paths.add(&mut rows, "E-mail", find(contact, "ElectronicMail"), None);
    }
    section(name, rows)
}

fn cii_line(li: N, paths: &Paths) -> Value {
    let li = Some(li);
    let product = find_alt(li, &["DefinedTradeProduct", "SpecifiedTradeProduct"]);
    let agr = find_alt(
        li,
        &["SpecifiedLineTradeAgreement", "IncludedLineTradeAgreement"],
    );
    let tr = find(li, "SpecifiedLineTradeTransaction");
    let dl = find_alt(
        li,
        &["SpecifiedLineTradeDelivery", "IncludedLineTradeDelivery"],
    );
    let st = find_alt(
        li,
        &[
            "SpecifiedLineTradeSettlement",
            "IncludedLineTradeSettlement",
        ],
    );
    let qty = find(tr, "InvoicedQuantity").or_else(|| find(dl, "BilledQuantity"));
    let price_el = find(find(agr, "NetPrice"), "ChargeAmount")
        .or_else(|| find(find(agr, "NetPriceProductTradePrice"), "ChargeAmount"));
    let total_el = find(tr, "LineExtensionAmount").or_else(|| {
        find(
            find(st, "SpecifiedTradeSettlementLineMonetarySummation"),
            "LineTotalAmount",
        )
    });
    let line_tax_el = find(st, "ApplicableTradeTax");
    let tax_el = find(st, "CalculatedAmount").or_else(|| find(line_tax_el, "CalculatedAmount"));
    let pct_el =
        find(line_tax_el, "RateApplicablePercent").or_else(|| find(st, "RateApplicablePercent"));
    let itemid_el = find_alt(product, &["SellerAssignedID", "BuyerAssignedID"]);
    let name_el = find(li, "Name").or_else(|| find(product, "Name"));
    let desc_el = find(li, "Description").or_else(|| find(product, "Description"));

    // PU HT : LineExtensionAmount / quantité si possible, sinon NetPrice.
    let mut pu_value = price_el.map(|_| cii_money(price_el));
    let mut pu_note = None;
    let total_value = cii_money(total_el);
    if total_el.is_some() && qty.is_some() {
        if let (Some(tq), Some(tv)) = (decimal(&text(qty)), decimal(&text(total_el))) {
            if tq.0 > 0 {
                let cur = attr(total_el, "currencyID").or_else(|| attr(price_el, "currencyID"));
                if let Some(value) = divide_cents(tv, tq) {
                    pu_value = Some(money_num(Some(value), cur.as_deref()));
                    pu_note = Some(format!(
                        "Total ligne HT / quantité : {} / {}",
                        text(total_el),
                        text(qty)
                    ));
                }
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

    let mut note_els: Vec<N> = findall(li, "Note")
        .into_iter()
        .filter(|n| !text(Some(*n)).is_empty())
        .collect();
    if note_els.is_empty() {
        note_els = findall(li, "IncludedNote")
            .into_iter()
            .filter_map(|n| find(Some(n), "Content"))
            .filter(|c| !text(Some(*c)).is_empty())
            .collect();
    }

    let lineid_el =
        find(li, "LineID").or_else(|| find(find(li, "AssociatedDocumentLineDocument"), "LineID"));

    let mut cells = Map::new();
    cells.insert("id".into(), paths.cell_or_empty("N° de ligne", lineid_el));
    cells.insert("name".into(), paths.cell_or_empty("Désignation", name_el));
    cells.insert("desc".into(), paths.cell_or_empty("Description", desc_el));
    cells.insert(
        "itemid".into(),
        paths.cell_or_empty("Référence article", itemid_el),
    );
    cells.insert(
        "qty".into(),
        if qty.is_some() {
            paths.cell("Quantité", qty, note_for(qty), None)
        } else {
            empty("Quantité")
        },
    );
    cells.insert(
        "price".into(),
        match nonempty(pu_value) {
            Some(v) => {
                let anchor = if pu_note.is_some() {
                    total_el
                } else {
                    price_el
                };
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

pub(super) fn extract_cii(
    root: N,
    paths: &Paths,
    warnings: &mut Vec<String>,
) -> Map<String, Value> {
    let root = Some(root);
    let doc = find(root, "ExchangedDocument");
    let ctx = find(root, "ExchangedDocumentContext");
    let txn = find(root, "SupplyChainTradeTransaction");
    if doc.is_none() || txn.is_none() {
        warnings
            .push("Structure CII inattendue, seules les données brutes sont disponibles.".into());
        let mut out = structured(
            Vec::new(),
            Vec::new(),
            Vec::new(),
            cii_columns(),
            Vec::new(),
        );
        out.shift_remove("note_columns");
        return out;
    }
    let agreement = find_alt(
        txn,
        &["ApplicableTradeAgreement", "ApplicableHeaderTradeAgreement"],
    );
    let delivery = find_alt(
        txn,
        &["ApplicableTradeDelivery", "ApplicableHeaderTradeDelivery"],
    );
    let settlement = find_alt(
        txn,
        &[
            "ApplicableTradeSettlement",
            "ApplicableHeaderTradeSettlement",
        ],
    );
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
    paths.addh(
        &mut h,
        "Nombre de lignes",
        find(doc, "LineCountNumeric"),
        None,
        None,
    );
    for n in findall(doc, "Note") {
        paths.addh(&mut h, "Note / mention", Some(n), None, None);
    }
    for n in findall(doc, "IncludedNote") {
        let content = find(Some(n), "Content");
        if !text(content).is_empty() {
            paths.addh(&mut h, "Note / mention", content, None, None);
        }
    }
    let gp = find(
        find(ctx, "GuidelineSpecifiedDocumentContextParameter"),
        "ID",
    );
    if gp.is_some() {
        let profile = lookup(tables::PROFILES_CII, &text(gp)).unwrap_or("EN 16931");
        paths.addh(&mut h, "Profil", gp, Some(profile.to_string()), None);
    }
    for line in findall(find(doc, "BuyerReference"), "Line") {
        paths.addh(
            &mut h,
            "Référence acheteur / commande",
            find(Some(line), "ID"),
            None,
            None,
        );
    }
    let order_ref = find(
        find(agreement, "BuyerOrderReferencedDocument"),
        "IssuerAssignedID",
    );
    if !text(order_ref).is_empty() {
        paths.addh(
            &mut h,
            "Référence acheteur / commande",
            order_ref,
            None,
            None,
        );
    }
    let period = find(doc, "IncludedPeriod").or_else(|| find(settlement, "BillingSpecifiedPeriod"));
    if period.is_some() {
        let s = date_text(find(period, "StartDateTime"));
        let e = date_text(find(period, "EndDateTime"));
        if !s.is_empty() || !e.is_empty() {
            let v = format!("{s}  →  {e}")
                .trim_matches(|c| c == ' ' || c == '→')
                .to_string();
            paths.addh(&mut h, "Période", period, None, Some(v));
        }
    }

    let mut sections = vec![
        cii_party_block(
            "Vendeur",
            find_alt(agreement, &["Seller", "SellerTradeParty"]),
            paths,
        ),
        cii_party_block(
            "Acheteur",
            find_alt(agreement, &["Buyer", "BuyerTradeParty"]),
            paths,
        ),
    ];

    // livraison
    let mut rows = Vec::new();
    let occurrence = find(
        find(delivery, "ActualSupplyChainEvent"),
        "OccurrenceDateTime",
    );
    let v = date_text(occurrence);
    if !v.is_empty() {
        rows.push(row("Date de livraison", v, paths.of(occurrence), None));
    }
    let supplier = find(
        find_alt(
            delivery,
            &[
                "SpecifiedLogisticsSupplier",
                "SpecifiedLogisticsServiceProvider",
            ],
        ),
        "Name",
    );
    if !text(supplier).is_empty() {
        rows.push(row(
            "Destinataire",
            text(supplier),
            paths.of(supplier),
            None,
        ));
    }
    sections.push(section("Livraison", rows));

    // paiement
    let mut rows = Vec::new();
    if settlement.is_some() {
        let means = find_alt(
            settlement,
            &["PaymentMeans", "SpecifiedTradeSettlementPaymentMeans"],
        );
        paths.add(
            &mut rows,
            "Mode de paiement",
            find(means, "TypeCode"),
            nonempty(Some(text(find(means, "Information")))),
        );
        let accounts = [
            "PayeePartyCreditAccount",
            "PayeePartyCreditorFinancialAccount",
        ];
        let payee = find_alt(settlement, &accounts).or_else(|| find_alt(means, &accounts));
        paths.add(&mut rows, "IBAN", find_alt(payee, &["ID", "IBANID"]), None);
        paths.add(
            &mut rows,
            "Titre du compte",
            find(payee, "AccountName"),
            None,
        );
        let bank = find(settlement, "PayeeSpecifiedCreditorFinancialInstitution")
            .or_else(|| find(means, "PayeeSpecifiedCreditorFinancialInstitution"));
        paths.add(&mut rows, "BIC", find(bank, "BICID"), None);
        paths.add(
            &mut rows,
            "Conditions de paiement",
            find(terms, "Description"),
            None,
        );
        paths.add(
            &mut rows,
            "Mandat SEPA",
            find(terms, "DirectDebitMandateID"),
            None,
        );
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
            let pct = find(category, "RateApplicablePercent")
                .or_else(|| find(tax, "RateApplicablePercent"));
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
        let summation = find(
            settlement,
            "SpecifiedTradeSettlementHeaderMonetarySummation",
        );
        for (title, keys) in [
            ("Total HT", ["LineTotalAmount", "TaxBasisTotalAmount"]),
            ("Total TTC", ["TotalAmount", "GrandTotalAmount"]),
            ("À payer", ["DuePayableAmount", "NetPayableAmount"]),
        ] {
            let el = keys.iter().find_map(|k| {
                find(settlement, k)
                    .or_else(|| find(summation, k))
                    .filter(|c| !text(Some(*c)).is_empty())
            });
            if el.is_some() {
                rows.push(row(title, cii_money(el), paths.of(el), None));
            }
        }
    }
    sections.push(section("Totaux", rows));

    let lines: Vec<Value> = findall_alt(
        txn,
        &["SpecifiedTradeLineItem", "IncludedSupplyChainTradeLineItem"],
    )
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
