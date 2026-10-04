//! Lecture des conteneurs ZIP et PDF Factur-X, séparée de l’extraction métier XML.

use super::*;
use regex::bytes::Regex as BytesRegex;

// ------------------------------------------------------------------ Conteneur PDF / PDF/A-3

#[derive(Clone, Debug, Default)]
pub struct PdfContainerInfo {
    pub est_pdfa: bool,
    pub pdfa_part: Option<u32>,
    pub pdfa_conformance: Option<String>,
    pub piece_jointe_declaree: bool,
    pub nom_piece_jointe: Option<String>,
    pub af_relationship: Option<String>,
    pub profil_xmp: Option<String>,
    /// Controles de structure lus dans le fichier (voir `pdf_structure`).
    pub structure: Vec<Value>,
}

impl PdfContainerInfo {
    pub fn pdfa_version(&self) -> String {
        if self.est_pdfa {
            if let Some(part) = self.pdfa_part {
                let conf = self.pdfa_conformance.as_deref().unwrap_or("");
                format!("PDF/A-{part}{conf}")
            } else {
                "PDF/A (version non précisée)".into()
            }
        } else {
            "Non déclaré PDF/A".into()
        }
    }

    pub fn to_json(&self) -> Value {
        json!({
            "est_pdf": true,
            "est_pdfa": self.est_pdfa,
            "pdfa_part": self.pdfa_part,
            "pdfa_conformance": self.pdfa_conformance,
            "pdfa_version": self.pdfa_version(),
            "piece_jointe_declaree": self.piece_jointe_declaree,
            "nom_piece_jointe": self.nom_piece_jointe,
            "af_relationship": self.af_relationship,
            "profil_xmp": self.profil_xmp,
            "structure_controles": self.structure.len(),
            "structure_ecarts": self.structure.iter().filter(|c| c["etat"] == "ecart").count(),
            "structure_alertes": self.structure.iter().filter(|c| c["etat"] == "alerte").count(),
        })
    }
}

// ------------------------------------------------------------------ ZIP (Factur-X CII)

pub(super) struct Extracted {
    pub(super) xml: Vec<u8>,
    pub(super) xml_name: Option<String>,
    pub(super) pdf: Option<(Vec<u8>, String)>,
    pub(super) conteneur_pdf: Option<PdfContainerInfo>,
}

pub(super) fn parse_zip(
    data: &[u8],
    selection: Option<&ArchiveSelection>,
) -> Result<Extracted, FacturXError> {
    let names = imports::archive_entries(data)?;
    let xmls: Vec<_> = names
        .iter()
        .filter(|(_, n)| n.to_lowercase().ends_with(".xml"))
        .collect();
    let pdfs: Vec<_> = names
        .iter()
        .filter(|(_, n)| n.to_lowercase().ends_with(".pdf"))
        .collect();
    let xml = match selection {
        Some(choice) => xmls.iter().copied().find(|(i, _)| *i == choice.xml),
        None if xmls.len() == 1 && pdfs.len() <= 1 => xmls.first().copied(),
        _ => None,
    }
    .ok_or_else(|| FacturXError("Sélectionnez un XML valide dans l'archive.".into()))?;
    let pdf =
        match selection {
            Some(choice) => match choice.pdf {
                Some(index) => Some(pdfs.iter().copied().find(|(i, _)| *i == index).ok_or_else(
                    || FacturXError("Sélection PDF invalide dans l'archive.".into()),
                )?),
                None => None,
            },
            None => pdfs.first().copied(),
        };
    let mut zip =
        zip::ZipArchive::new(Cursor::new(data)).map_err(|e| FacturXError(e.to_string()))?;
    let mut read = |index: usize, limit: usize| -> Result<Vec<u8>, FacturXError> {
        let entry = zip
            .by_index(index)
            .map_err(|e| FacturXError(e.to_string()))?;
        if entry.size() > limit as u64 {
            return Err(FacturXError(format!(
                "Entrée ZIP trop volumineuse après décompression : {}.",
                entry.name()
            )));
        }
        read_bounded(entry, limit)
            .map_err(|e| FacturXError(format!("Extraction ZIP impossible : {e}")))
    };
    let xml_bytes = read(xml.0, MAX_XML)?;
    let pdf = match pdf {
        Some((index, name)) => Some((read(*index, MAX_EXPANDED - MAX_XML)?, name.clone())),
        None => None,
    };
    Ok(Extracted {
        xml: xml_bytes,
        xml_name: Some(xml.1.clone()),
        pdf,
        conteneur_pdf: None,
    })
}

// ------------------------------------------------------------------ PDF (Factur-X)

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
        Ok(doc) => matches!(
            local(doc.root_element()),
            "Invoice" | "CreditNote" | "CrossIndustryInvoice"
        ),
        Err(_) => false,
    }
}

static PDF_FILESPEC_NAME: LazyLock<BytesRegex> =
    LazyLock::new(|| BytesRegex::new(r"(?s-u)/Type\s*/Filespec.*?/UF\s*\(([^()]+)\)").unwrap());
static PDF_FILESPEC_REF: LazyLock<BytesRegex> = LazyLock::new(|| {
    BytesRegex::new(r"(?s-u)/Type\s*/Filespec.*?/EF\s*<<[^>]*?/\s*(?:F|UF)\s+(\d+)\s+0\s+R")
        .unwrap()
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

fn decode_pdf_str(bytes: &[u8]) -> String {
    if bytes.len() >= 2 && bytes[0] == 0xFE && bytes[1] == 0xFF {
        let u16s: Vec<u16> = bytes[2..]
            .chunks_exact(2)
            .map(|c| u16::from_be_bytes([c[0], c[1]]))
            .collect();
        String::from_utf16_lossy(&u16s)
    } else if let Ok(s) = std::str::from_utf8(bytes) {
        s.to_string()
    } else {
        bytes.iter().map(|&b| b as char).collect()
    }
}

fn extract_xmp_field<'a>(xmp: &'a str, tag: &str) -> Option<&'a str> {
    let open_pat = format!("<{tag}");
    if let Some(pos) = xmp.find(&open_pat) {
        let after_tag = &xmp[pos + open_pat.len()..];
        if let Some(close_bracket) = after_tag.find('>') {
            let content = &after_tag[close_bracket + 1..];
            if let Some(end_pos) = content.find('<') {
                return Some(&content[..end_pos]);
            }
        }
    }
    // Forme attribut, entre guillemets doubles ou simples.
    for quote in ['"', '\''] {
        let attr_pat = format!("{tag}={quote}");
        if let Some(pos) = xmp.find(&attr_pat) {
            let after_attr = &xmp[pos + attr_pat.len()..];
            if let Some(end) = after_attr.find(quote) {
                return Some(&after_attr[..end]);
            }
        }
    }
    None
}

/// Suit une reference jusqu'a l'objet designe.
fn pdf_resolve<'a>(doc: &'a lopdf::Document, object: &'a lopdf::Object) -> &'a lopdf::Object {
    match object {
        lopdf::Object::Reference(id) => doc.get_object(*id).unwrap_or(object),
        other => other,
    }
}

fn pdf_name(dict: &lopdf::Dictionary, key: &[u8]) -> Option<String> {
    match dict.get(key).ok()? {
        lopdf::Object::Name(n) => Some(String::from_utf8_lossy(n).into_owned()),
        _ => None,
    }
}

/// Controles de structure du PDF, lus dans le fichier lui-meme et non dans ses declarations :
/// chiffrement, profil de sortie, polices incorporees, identifiant, actions interdites,
/// metadonnees Factur-X, type et relation de la piece jointe. Ce sont quelques exigences de
/// PDF/A-3 (ISO 19005-3) parmi beaucoup d'autres : un fichier qui les passe toutes n'est pas
/// pour autant conforme.
fn pdf_structure(
    doc: &lopdf::Document,
    xmp: Option<&str>,
    attachment: &str,
    cii: bool,
    relationship: Option<&str>,
    mime: Option<&str>,
) -> Vec<Value> {
    const PARTIAL: &str = "Contrôle partiel de la structure du fichier ; ne remplace pas une validation PDF/A-3 complète (veraPDF).";
    let check = |regle: &str, etat: &str, attendu: &str, constate: String, detail: &str| json!({ "regle": regle, "etat": etat, "attendu": attendu, "constate": constate, "detail": format!("{detail} {PARTIAL}") });
    let mut out = Vec::new();
    let dicts = || {
        doc.objects.values().filter_map(|o| match o {
            lopdf::Object::Dictionary(d) => Some(d),
            lopdf::Object::Stream(s) => Some(&s.dict),
            _ => None,
        })
    };

    // 1. Chiffrement : interdit en PDF/A.
    let encrypted = doc.trailer.has(b"Encrypt") || doc.is_encrypted();
    out.push(check(
        "PDF non chiffré",
        if encrypted { "ecart" } else { "conforme" },
        "Aucun chiffrement",
        if encrypted {
            "Fichier chiffré".into()
        } else {
            "Non chiffré".into()
        },
        "Un PDF/A ne doit pas être chiffré.",
    ));

    // 2. Profil de sortie (OutputIntent) avec profil ICC.
    let intents = doc
        .catalog()
        .ok()
        .and_then(|c| c.get(b"OutputIntents").ok())
        .map(|o| pdf_resolve(doc, o))
        .and_then(|o| o.as_array().ok())
        .map(|list| {
            list.iter()
                .filter_map(|i| pdf_resolve(doc, i).as_dict().ok())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let pdfa_intent = intents
        .iter()
        .find(|d| pdf_name(d, b"S").as_deref() == Some("GTS_PDFA1"));
    let (etat, constate) = match pdfa_intent {
        Some(d) if d.has(b"DestOutputProfile") => (
            "conforme",
            format!(
                "Présent{}",
                match d.get(b"OutputConditionIdentifier") {
                    Ok(lopdf::Object::String(s, _)) => format!(" ({})", decode_pdf_str(s)),
                    _ => String::new(),
                }
            ),
        ),
        Some(_) => ("alerte", "Déclaré sans profil ICC incorporé".into()),
        None => ("alerte", "Absent".into()),
    };
    out.push(check(
        "Profil de sortie (couleurs)",
        etat,
        "OutputIntent GTS_PDFA1 avec profil ICC",
        constate,
        "PDF/A exige un profil de sortie dès que le fichier emploie des couleurs dépendantes du périphérique, ce qui est le cas de presque tous les PDF.",
    ));

    // 3. Polices incorporees. Les polices composites (Type0) le sont par leur police descendante,
    //    les polices Type3 sont decrites dans le fichier.
    let mut fonts = 0usize;
    let mut missing: Vec<String> = Vec::new();
    for font in dicts().filter(|d| pdf_name(d, b"Type").as_deref() == Some("Font")) {
        let subtype = pdf_name(font, b"Subtype").unwrap_or_default();
        if subtype == "Type0" || subtype == "Type3" {
            continue;
        }
        fonts += 1;
        let embedded = font
            .get(b"FontDescriptor")
            .ok()
            .and_then(|o| pdf_resolve(doc, o).as_dict().ok())
            .is_some_and(|d| d.has(b"FontFile") || d.has(b"FontFile2") || d.has(b"FontFile3"));
        if !embedded {
            let name = pdf_name(font, b"BaseFont").unwrap_or_else(|| "police sans nom".into());
            if !missing.contains(&name) {
                missing.push(name);
            }
        }
    }
    let (etat, constate) = if fonts == 0 {
        ("info", "Aucune police dans le fichier".to_string())
    } else if missing.is_empty() {
        (
            "conforme",
            format!(
                "{fonts} police{} incorporée{}",
                if fonts > 1 { "s" } else { "" },
                if fonts > 1 { "s" } else { "" }
            ),
        )
    } else {
        let shown = missing
            .iter()
            .take(5)
            .cloned()
            .collect::<Vec<_>>()
            .join(", ");
        (
            "ecart",
            format!(
                "{} non incorporée{} : {shown}{}",
                missing.len(),
                if missing.len() > 1 { "s" } else { "" },
                if missing.len() > 5 { "…" } else { "" }
            ),
        )
    };
    out.push(check(
        "Polices incorporées",
        etat,
        "Toutes les polices incorporées",
        constate,
        "PDF/A exige que chaque police utilisée soit incorporée au fichier.",
    ));

    // 4. Identifiant du fichier.
    let has_id = doc.trailer.has(b"ID");
    out.push(check(
        "Identifiant du fichier",
        if has_id { "conforme" } else { "alerte" },
        "Identifiant (/ID) présent",
        if has_id {
            "Présent".into()
        } else {
            "Absent".into()
        },
        "PDF/A exige un identifiant de fichier.",
    ));

    // 5. Actions interdites : JavaScript, lancement de programme.
    let forbidden = dicts()
        .filter(|d| {
            d.has(b"JS") || matches!(pdf_name(d, b"S").as_deref(), Some("JavaScript" | "Launch"))
        })
        .count();
    out.push(check(
        "Aucun script ni lancement de programme",
        if forbidden > 0 { "ecart" } else { "conforme" },
        "Aucune action JavaScript ou Launch",
        if forbidden > 0 {
            format!(
                "{forbidden} action{} interdite{}",
                if forbidden > 1 { "s" } else { "" },
                if forbidden > 1 { "s" } else { "" }
            )
        } else {
            "Aucune".into()
        },
        "PDF/A interdit les actions JavaScript et le lancement de programmes.",
    ));

    // 6. Metadonnees Factur-X (schema d'extension XMP).
    let field = |tag: &str| {
        xmp.and_then(|x| {
            extract_xmp_field(x, &format!("fx:{tag}"))
                .or_else(|| extract_xmp_field(x, &format!("zf:{tag}")))
        })
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
    };
    let absent: Vec<&str> = [
        "DocumentType",
        "DocumentFileName",
        "Version",
        "ConformanceLevel",
    ]
    .into_iter()
    .filter(|t| field(t).is_none())
    .collect();
    let file_name = field("DocumentFileName");
    let (etat, constate) = if absent.len() == 4 && !cii {
        // Un PDF qui porte une facture UBL n'est pas un Factur-X.
        (
            "info",
            "Sans objet : la pièce jointe n'est pas une facture CII".to_string(),
        )
    } else if !absent.is_empty() {
        ("alerte", format!("Absent : {}", absent.join(", ")))
    } else if file_name
        .as_deref()
        .is_some_and(|n| !n.eq_ignore_ascii_case(attachment))
    {
        (
            "alerte",
            format!(
                "Fichier annoncé {}, pièce jointe {attachment}",
                file_name.unwrap_or_default()
            ),
        )
    } else {
        (
            "conforme",
            format!(
                "{} {}, {}",
                field("DocumentType").unwrap_or_default(),
                field("Version").unwrap_or_default(),
                file_name.unwrap_or_default()
            ),
        )
    };
    out.push(check(
        "Métadonnées Factur-X",
        etat,
        "DocumentType, DocumentFileName, Version et ConformanceLevel, nom concordant avec la pièce jointe",
        constate,
        "Factur-X exige ces quatre métadonnées XMP, et que le nom annoncé soit celui de la pièce jointe.",
    ));

    // 7. Piece jointe : relation et type.
    let relation_ok = matches!(relationship, Some("Data" | "Source" | "Alternative"));
    let mime_ok = mime.is_some_and(|m| {
        m.eq_ignore_ascii_case("text/xml") || m.eq_ignore_ascii_case("application/xml")
    });
    out.push(check(
        "Pièce jointe : relation et type",
        if relation_ok && mime_ok { "conforme" } else { "alerte" },
        "Relation Data, Source ou Alternative ; type text/xml",
        format!("Relation {}, type {}", relationship.unwrap_or("absente"), mime.unwrap_or("absent")),
        "PDF/A-3 exige une relation (AFRelationship) et un type MIME pour chaque fichier joint ; Factur-X fixe les valeurs admises.",
    ));
    out
}

/// Analyse structurelle du PDF via `lopdf` : recherche des fichiers associés
/// (/AF et /Names/EmbeddedFiles), métadonnées XMP (PDF/A-3, ConformanceLevel)
/// et extraction du flux XML de facture.
fn extract_pdf_with_lopdf(
    data: &[u8],
) -> Result<Option<(Vec<u8>, String, PdfContainerInfo)>, FacturXError> {
    let doc = match lopdf::Document::load_mem_with_options(
        data,
        lopdf::LoadOptions::with_max_decompressed_size(MAX_XML),
    ) {
        Ok(doc) => doc,
        Err(e @ lopdf::Error::Decompress(lopdf::DecompressError::MemoryLimitExceeded { .. })) => {
            return Err(FacturXError(e.to_string()))
        }
        Err(_) => return Ok(None),
    };

    let mut declared_files = Vec::new();
    let mut is_pdfa = false;
    let mut pdfa_part = None;
    let mut pdfa_conformance = None;
    let mut profil_xmp = None;
    let mut xmp_text: Option<String> = None;

    if let Ok(catalog) = doc.catalog() {
        // 1. /AF (Associated Files de PDF/A-3)
        if let Ok(af) = catalog.get(b"AF").and_then(|o| o.as_array()) {
            for item in af {
                if let Ok(ref_id) = item.as_reference() {
                    declared_files.push(ref_id);
                }
            }
        }

        // 2. /Names -> /EmbeddedFiles
        if let Ok(names_obj) = catalog.get(b"Names") {
            let names_dict = match names_obj {
                lopdf::Object::Dictionary(d) => Some(d),
                lopdf::Object::Reference(r) => {
                    doc.get_object(*r).ok().and_then(|o| o.as_dict().ok())
                }
                _ => None,
            };
            if let Some(nd) = names_dict {
                if let Ok(ef_obj) = nd.get(b"EmbeddedFiles") {
                    let ef_dict = match ef_obj {
                        lopdf::Object::Dictionary(d) => Some(d),
                        lopdf::Object::Reference(r) => {
                            doc.get_object(*r).ok().and_then(|o| o.as_dict().ok())
                        }
                        _ => None,
                    };
                    if let Some(efd) = ef_dict {
                        if let Ok(arr) = efd.get(b"Names").and_then(|o| o.as_array()) {
                            for (idx, item) in arr.iter().enumerate() {
                                if idx % 2 == 1 {
                                    if let Ok(ref_id) = item.as_reference() {
                                        declared_files.push(ref_id);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        // 3. /Metadata (XMP)
        if let Ok(meta_obj) = catalog.get(b"Metadata") {
            let meta_stream = match meta_obj {
                lopdf::Object::Stream(s) => Some(s),
                lopdf::Object::Reference(r) => {
                    doc.get_object(*r).ok().and_then(|o| o.as_stream().ok())
                }
                _ => None,
            };
            if let Some(ms) = meta_stream {
                let bytes = imports::pdf_stream(ms, MAX_METADATA)?;
                let text = String::from_utf8_lossy(&bytes);
                if text.contains("pdfaid:part") {
                    is_pdfa = true;
                    if let Some(p) = extract_xmp_field(&text, "pdfaid:part") {
                        pdfa_part = p.trim().parse::<u32>().ok();
                    }
                    if let Some(c) = extract_xmp_field(&text, "pdfaid:conformance") {
                        pdfa_conformance = Some(c.trim().to_string());
                    }
                }
                xmp_text = Some(text.to_string());
                if let Some(lvl) = extract_xmp_field(&text, "fx:ConformanceLevel")
                    .or_else(|| extract_xmp_field(&text, "zf:ConformanceLevel"))
                    .or_else(|| extract_xmp_field(&text, "ConformanceLevel"))
                {
                    let trimmed = lvl.trim();
                    if !trimmed.is_empty() {
                        profil_xmp = Some(trimmed.to_string());
                    }
                }
            }
        }
    }

    // Recherche parmi les objets Filespec
    let mut candidate_xml: Option<(Vec<u8>, String, bool, Option<String>, Option<String>)> = None;
    // Une annexe trop volumineuse ne doit pas masquer un autre XML de facture valide.
    // On conserve l'erreur si aucun XML exploitable n'est trouvé.
    let mut first_stream_error: Option<FacturXError> = None;

    for (id, obj) in &doc.objects {
        if let lopdf::Object::Dictionary(dict) = obj {
            let is_filespec = dict
                .get(b"Type")
                .map(|t| t == &lopdf::Object::Name(b"Filespec".to_vec()))
                .unwrap_or(false)
                || dict.has(b"EF");
            if !is_filespec {
                continue;
            }

            let uf = dict.get(b"UF").ok().and_then(|o| match o {
                lopdf::Object::String(s, _) => Some(decode_pdf_str(s)),
                _ => None,
            });
            let f = dict.get(b"F").ok().and_then(|o| match o {
                lopdf::Object::String(s, _) => Some(decode_pdf_str(s)),
                _ => None,
            });
            let name = uf.or(f).unwrap_or_else(|| "factur-x.xml".into());
            let rel = dict.get(b"AFRelationship").ok().and_then(|o| match o {
                lopdf::Object::Name(n) => Some(String::from_utf8_lossy(n).into_owned()),
                _ => None,
            });
            let is_declared = declared_files.contains(id);

            let ef_dict = dict.get(b"EF").ok().and_then(|o| match o {
                lopdf::Object::Dictionary(d) => Some(d),
                lopdf::Object::Reference(r) => {
                    doc.get_object(*r).ok().and_then(|x| x.as_dict().ok())
                }
                _ => None,
            });

            if let Some(ef) = ef_dict {
                let stream_ref = ef
                    .get(b"UF")
                    .or_else(|_| ef.get(b"F"))
                    .ok()
                    .and_then(|o| o.as_reference().ok());
                if let Some(sref) = stream_ref {
                    if let Ok(stream_obj) = doc.get_object(sref).and_then(|o| o.as_stream()) {
                        let stream_bytes = match imports::pdf_stream(stream_obj, MAX_XML) {
                            Ok(bytes) => bytes,
                            Err(error) => {
                                first_stream_error.get_or_insert(error);
                                continue;
                            }
                        };
                        let candidates = match decompress_candidates(&stream_bytes) {
                            Ok(candidates) => candidates,
                            Err(error) => {
                                first_stream_error.get_or_insert(error);
                                continue;
                            }
                        };
                        for cand in candidates {
                            if is_invoice_xml(&cand) {
                                let is_primary_name = name.to_lowercase().contains("factur-x")
                                    || name.to_lowercase().contains("zugferd")
                                    || name.to_lowercase().contains("xrechnung")
                                    || name.to_lowercase().ends_with(".xml");
                                if candidate_xml.is_none() || (is_declared && is_primary_name) {
                                    candidate_xml = Some((
                                        cand,
                                        name.clone(),
                                        is_declared,
                                        rel.clone(),
                                        pdf_name(&stream_obj.dict, b"Subtype"),
                                    ));
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    let Some((xml, xml_name, piece_jointe_declaree, af_relationship, mime)) = candidate_xml else {
        return match first_stream_error {
            Some(error) => Err(error),
            None => Ok(None),
        };
    };
    let cii = xml.windows(20).any(|w| w == b"CrossIndustryInvoice");
    let structure = pdf_structure(
        &doc,
        xmp_text.as_deref(),
        &xml_name,
        cii,
        af_relationship.as_deref(),
        mime.as_deref(),
    );
    Ok(Some((
        xml,
        xml_name.clone(),
        PdfContainerInfo {
            est_pdfa: is_pdfa,
            pdfa_part,
            pdfa_conformance,
            piece_jointe_declaree,
            nom_piece_jointe: Some(xml_name),
            af_relationship,
            profil_xmp,
            structure,
        },
    )))
}

/// Extrait le XML de facture embarqué dans un PDF Factur-X.
///
/// Chemin principal : parseur PDF structurel (lopdf) avec inspection des pièces
/// jointes déclarées (/AF, /EmbeddedFiles) et métadonnées XMP.
/// Repli robuste : scan des flux du PDF par expressions régulières.
pub(super) fn extract_pdf_xml(
    data: &[u8],
) -> Result<(Vec<u8>, String, PdfContainerInfo), FacturXError> {
    // 1. Essai avec le parseur structurel lopdf
    if let Some(res) = extract_pdf_with_lopdf(data)? {
        return Ok(res);
    }

    // 2. Repli par expressions regulieres si structure inhabituelle
    let xml_name: Option<String> = PDF_FILESPEC_NAME
        .captures(data)
        .map(|c| c[1].iter().map(|&b| b as char).collect());

    let piece_jointe_declaree = xml_name.is_some();
    let mut first_stream_error: Option<FacturXError> = None;

    if let Some(name) = &xml_name {
        let stream = PDF_FILESPEC_REF
            .captures(data)
            .and_then(|c| pdf_object_stream(data, &c[1]));
        if let Some(stream) = stream {
            let candidates = match decompress_candidates(&stream) {
                Ok(candidates) => candidates,
                Err(error) => {
                    first_stream_error.get_or_insert(error);
                    Vec::new()
                }
            };
            for cand in candidates {
                if is_invoice_xml(&cand) {
                    return Ok((
                        cand,
                        name.clone(),
                        PdfContainerInfo {
                            est_pdfa: false,
                            pdfa_part: None,
                            pdfa_conformance: None,
                            piece_jointe_declaree: true,
                            nom_piece_jointe: Some(name.clone()),
                            af_relationship: None,
                            profil_xmp: None,
                            // Parseur de secours : la structure du fichier n'a pas pu etre lue.
                            structure: Vec::new(),
                        },
                    ));
                }
            }
        }
    }

    for c in PDF_STREAM.captures_iter(data) {
        let candidates = match decompress_candidates(&c[1]) {
            Ok(candidates) => candidates,
            Err(error) => {
                first_stream_error.get_or_insert(error);
                continue;
            }
        };
        for cand in candidates {
            if is_invoice_xml(&cand) {
                let name = xml_name.unwrap_or_else(|| "factur-x.xml".into());
                return Ok((
                    cand,
                    name.clone(),
                    PdfContainerInfo {
                        est_pdfa: false,
                        pdfa_part: None,
                        pdfa_conformance: None,
                        piece_jointe_declaree,
                        nom_piece_jointe: Some(name),
                        af_relationship: None,
                        profil_xmp: None,
                        structure: Vec::new(),
                    },
                ));
            }
        }
    }

    if let Some(error) = first_stream_error {
        return Err(error);
    }
    Err(FacturXError(
        "PDF sans XML de facture intégré : aucune pièce jointe UBL/CII trouvée (ce n'est pas une facture Factur-X ?)"
            .into(),
    ))
}
