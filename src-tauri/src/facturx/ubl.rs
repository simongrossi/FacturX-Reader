//! Extraction et présentation des données UBL du XML.

use super::*;

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
        paths.add(
            &mut rows,
            "Raison sociale",
            find(find(party, "PartyName"), "Name"),
            None,
        );
        paths.add(
            &mut rows,
            "Identifiant émetteur",
            find(party, "EndpointID"),
            None,
        );
        if include_id {
            paths.add(
                &mut rows,
                "Identifiant client",
                find(find(party, "PartyIdentification"), "ID"),
                None,
            );
        }
        paths.add(
            &mut rows,
            "Dénomination légale",
            find(legal, "RegistrationName"),
            None,
        );
        paths.add(
            &mut rows,
            "SIREN / registre",
            find(legal, "CompanyID"),
            None,
        );
        paths.add(
            &mut rows,
            "N° de TVA",
            find(find(party, "PartyTaxScheme"), "CompanyID"),
            None,
        );
        let addr = find(party, "PostalAddress");
        paths.add(&mut rows, "Rue", find(addr, "StreetName"), None);
        paths.add(
            &mut rows,
            "Complément d'adresse",
            find(addr, "AdditionalStreetName"),
            None,
        );
        paths.add(&mut rows, "Ville", find(addr, "CityName"), None);
        paths.add(&mut rows, "Code postal", find(addr, "PostalZone"), None);
        paths.add(
            &mut rows,
            "Département / Région",
            find(addr, "CountrySubentity"),
            None,
        );
        paths.add(
            &mut rows,
            "Pays",
            find(find(addr, "Country"), "IdentificationCode"),
            None,
        );
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
    let both = ac.charges.0 != 0 && ac.allowances.0 != 0;
    // Colonne Frais : detail brut (charges / remises) si les deux sont presentes, sinon le net.
    let (ac_display, ac_note) = if both {
        let charges = fmt_ac(ac.charges, ac_cur);
        let allow = fmt_ac(ac.allowances, ac_cur);
        let reasons = if ac.reasons.is_empty() {
            String::new()
        } else {
            format!(" ({})", ac.reasons.join("; "))
        };
        (
            format!("+{charges} / \u{2212}{allow}"),
            Some(format!(
                "Charges +{charges} / Remises \u{2212}{allow}{reasons}"
            )),
        )
    } else {
        (
            fmt_ac(ac.net, ac_cur),
            nonempty(Some(ac.reasons.join("; "))),
        )
    };

    // --- Total ligne HT = LineExtensionAmount (net autoritatif) ---
    let mut total_note = None;
    let total_num = if total_el.is_some() {
        decimal(&text(total_el))
    } else if price_el.is_some() && qty.is_some() {
        match (decimal(&text(price_el)), decimal(&text(qty))) {
            (Some(p), Some(q)) => {
                total_note = Some("Calculé : P.U. x quantité".to_string());
                mul_cents(p, q, Dec(SCALE))
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
    let qty_dec = decimal(&qty_text);
    let (pu_value, pu_note) = match (total_num, qty_dec) {
        (Some(total), Some(qty_dec)) if qty_dec.0 > 0 => {
            let mut pu_base = total;
            if ac.net.0 != 0 {
                let coherent = decimal(&text(price_el))
                    .and_then(|pu| mul_cents(pu, qty_dec, Dec(SCALE)))
                    .is_some_and(|value| (value.0 - total.0).abs() < 2 * CENT);
                if !coherent {
                    pu_base = Dec(total.0 - ac.net.0);
                }
            }
            let note = if pu_base != total && ac.net.0 > 0 {
                format!(
                    "PU de base : (Total ligne HT - frais) / quantité : ({total} - {}) / {qty_text}",
                    ac.net
                )
            } else if pu_base != total && ac.net.0 < 0 {
                format!(
                    "PU de base : (Total ligne HT + remise) / quantité : ({total} + {}) / {qty_text}",
                    Dec(-ac.net.0)
                )
            } else {
                format!("Total ligne HT / quantité : {total} / {qty_text}")
            };
            match divide_cents(pu_base, qty_dec) {
                Some(value) => (Some(money_num(Some(value), tot_cur)), Some(note)),
                None => (price_el.map(|_| money(price_el)), None),
            }
        }
        _ => (price_el.map(|_| money(price_el)), None),
    };

    // --- TVA de la ligne (TaxTotal de la ligne, sinon HT x taux) ---
    let mut tax_value = taxamt_el.map(|_| money(taxamt_el));
    let mut tax_note = None;
    if let (None, Some(_), Some(total)) = (&tax_value, pct, total_num) {
        let t = line_tax(&total.to_string(), &text(pct));
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
    let name_el = find(item, "Name")
        .filter(|n| !text(Some(*n)).is_empty())
        .or(desc_el);

    let mut cells = Map::new();
    cells.insert(
        "id".into(),
        paths.cell("N° de ligne", find(line, "ID"), None, None),
    );
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
        if ac.net.0 != 0 || !ac.reasons.is_empty() {
            paths.cell(
                "Frais / Remises (AllowanceCharge)",
                ac_first,
                ac_note,
                Some(ac_display),
            )
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
    let note_els: Vec<N> = findall(line, "Note")
        .into_iter()
        .filter(|n| !text(Some(*n)).is_empty())
        .collect();
    add_note_cells(&mut cells, &note_els, paths);

    json!({ "cells": cells, "fields": line_fields(line.unwrap(), paths) })
}

pub(super) fn extract_ubl(
    root: N,
    paths: &Paths,
    warnings: &mut Vec<String>,
) -> Map<String, Value> {
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
    paths.addh(
        &mut h,
        "Date d'émission",
        find(root, "IssueDate"),
        None,
        None,
    );
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
    paths.addh(
        &mut h,
        "Devise",
        find(root, "DocumentCurrencyCode"),
        None,
        None,
    );
    paths.addh(
        &mut h,
        "Réf. comptable interne",
        find(root, "AccountingCost"),
        None,
        None,
    );
    paths.addh(
        &mut h,
        "Réf. acheteur",
        find(root, "BuyerReference"),
        None,
        None,
    );
    paths.addh(
        &mut h,
        "Réf. commande vendeur",
        find(root, "SellerOrderReferencedDocumentID"),
        None,
        None,
    );
    paths.addh(
        &mut h,
        "Réf. commande acheteur",
        find(root, "BuyerOrderReferencedDocumentID"),
        None,
        None,
    );

    let period = find(root, "InvoicePeriod");
    if period.is_some() {
        let s = text(find(period, "StartDate"));
        let e = text(find(period, "EndDate"));
        if !s.is_empty() || !e.is_empty() {
            let v = format!("{s}  →  {e}")
                .trim_matches(|c| c == ' ' || c == '→')
                .to_string();
            paths.addh(&mut h, "Période de facturation", period, None, Some(v));
        } else {
            let code = text(find(period, "DescriptionCode"));
            if !code.is_empty() {
                paths.addh(
                    &mut h,
                    "Période de facturation",
                    period,
                    None,
                    Some(format!("code {code}")),
                );
            }
        }
    }
    for n in findall(root, "Note") {
        paths.addh(&mut h, "Note / mention", Some(n), None, None);
    }
    let orderref = find(root, "OrderReference");
    paths.addh(&mut h, "N° de commande", find(orderref, "ID"), None, None);
    paths.addh(
        &mut h,
        "Réf. commande client",
        find(orderref, "SalesOrderID"),
        None,
        None,
    );
    paths.addh(
        &mut h,
        "Date de la commande",
        find(orderref, "IssueDate"),
        None,
        None,
    );
    paths.addh(
        &mut h,
        "Réf. contrat",
        find(find(root, "ContractDocumentReference"), "ID"),
        None,
        None,
    );
    for a in findall(root, "AdditionalDocumentReference") {
        paths.addh(
            &mut h,
            "Document complémentaire",
            find(Some(a), "ID"),
            None,
            None,
        );
    }

    let mut sections = Vec::new();

    // parties
    sections.push(ubl_party_block(
        "Vendeur",
        find(find(root, "AccountingSupplierParty"), "Party"),
        paths,
        false,
    ));
    sections.push(ubl_party_block(
        "Acheteur",
        find(find(root, "AccountingCustomerParty"), "Party"),
        paths,
        true,
    ));

    // livraison
    let mut rows = Vec::new();
    let delivery = find(root, "Delivery");
    if delivery.is_some() {
        paths.add(
            &mut rows,
            "Date de livraison",
            find(delivery, "ActualDeliveryDate"),
            None,
        );
        let addr = find(find(delivery, "DeliveryLocation"), "Address");
        paths.add(&mut rows, "Rue", find(addr, "StreetName"), None);
        paths.add(&mut rows, "Ville", find(addr, "CityName"), None);
        paths.add(&mut rows, "Code postal", find(addr, "PostalZone"), None);
        paths.add(
            &mut rows,
            "Département",
            find(addr, "CountrySubentity"),
            None,
        );
        paths.add(
            &mut rows,
            "Pays",
            find(find(addr, "Country"), "IdentificationCode"),
            None,
        );
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
        paths.add(
            &mut rows,
            "Mode de paiement",
            find(pmeans, "PaymentMeansCode"),
            None,
        );
        paths.add(
            &mut rows,
            "Référence de paiement",
            find(pmeans, "PaymentID"),
            None,
        );
        paths.add(&mut rows, "IBAN", find(account, "ID"), None);
        paths.add(&mut rows, "BIC", find(branch, "ID"), None);
        paths.add(&mut rows, "Banque", find(branch, "Name"), None);
    }
    let terms = find(root, "PaymentTerms");
    for (title, tag) in [
        ("Conditions de paiement", "Note"),
        ("Date d'échéance", "DueDate"),
    ] {
        let el = find(terms, tag);
        let v = text(el);
        if !v.is_empty() {
            rows.push(row(title, v, paths.of(el), None));
        }
    }
    sections.push(section("Paiement", rows));

    // remises / majorations
    let mut rows = Vec::new();
    for (tag, amount_tag, name) in [
        ("Allowance", "AllowanceAmount", "Remise"),
        ("Charge", "ChargeAmount", "Majoration"),
    ] {
        for a in findall(root, tag) {
            let amt = find(Some(a), amount_tag);
            if !text(amt).is_empty() {
                rows.push(row(name, money(amt), paths.of(Some(a)), None));
            }
        }
    }
    for (tag, reason_tag, name) in [
        ("AllowanceBasis", "AllowanceReason", "Remise"),
        ("ChargeBasis", "ChargeReason", "Majoration"),
    ] {
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
            let label = if pct.is_empty() {
                "TVA".to_string()
            } else {
                format!("TVA {pct} %")
            };
            let note = if base.is_empty() {
                None
            } else {
                Some(format!("Base imposable : {base}"))
            };
            rows.push(row(
                &label,
                money(find(sub, "TaxAmount")),
                paths.of(sub),
                note,
            ));
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
    let line_tag = ["InvoiceLine", "CreditNoteLine"]
        .into_iter()
        .find(|t| find(root, t).is_some());
    let lines: Vec<Value> = match line_tag {
        Some(tag) => findall(root, tag)
            .into_iter()
            .map(|l| ubl_line(l, paths))
            .collect(),
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
