//! Découpage explicite : les XML restent des originaux séparés, jamais clonés.
use base64::Engine;
use lopdf::{Document, Object};
use serde::Deserialize;
use serde_json::{json, Value};
use std::io::{Cursor, Write};

#[derive(Deserialize)]
pub struct Group { pub start: u32, pub end: u32, pub xml: Option<usize> }

fn load(data: &[u8]) -> Result<Document, String> {
    if data.len() > super::MAX_FILE_SIZE { return Err("PDF trop volumineux (max 200 Mo).".into()); }
    let doc = Document::load_mem_with_options(data, lopdf::LoadOptions::with_max_decompressed_size(20 * 1024 * 1024)).map_err(|e| e.to_string())?;
    if doc.is_encrypted() { return Err("Les PDF chiffrés doivent être déchiffrés avant découpage.".into()); }
    if doc.get_pages().len() > 500 { return Err("Découpage limité à 500 pages.".into()); }
    Ok(doc)
}
fn attachments(doc: &Document) -> Result<Vec<Vec<u8>>, String> {
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let mut total = 0;
    for obj in doc.objects.values() {
        let Ok(dict) = obj.as_dict() else { continue };
        let Ok(ef) = dict.get(b"EF") else { continue };
        let (_, ef) = doc.dereference(ef).map_err(|e| e.to_string())?;
        let ef = ef.as_dict().map_err(|e| e.to_string())?;
        let stream = ef.get(b"UF").or_else(|_| ef.get(b"F")).map_err(|e| e.to_string())?;
        let (id, stream) = doc.dereference(stream).map_err(|e| e.to_string())?;
        if let Some(id) = id { if !seen.insert(id) { continue; } }
        let stream = stream.as_stream().map_err(|e| e.to_string())?;
        let bytes = crate::facturx::split_xml_stream(stream)?;
        if let Some(bytes) = bytes {
            total += bytes.len();
            if total > 20 * 1024 * 1024 { return Err("Les XML intégrés dépassent 20 Mo au total.".into()); }
            out.push(bytes);
        }
        if out.len() > 100 { return Err("Trop de XML intégrés (max 100).".into()); }
    }
    Ok(out)
}
pub fn inspect(data: &[u8]) -> Result<Value, String> {
    let doc = load(data)?;
    let xml = attachments(&doc)?;
    Ok(json!({"pages": doc.get_pages().len(), "xml": xml.iter().enumerate().map(|(i, b)| {
        let text = String::from_utf8_lossy(b);
        let parsed = roxmltree::Document::parse(&text).ok().map(|d| {
            let number = d.descendants().find(|n| n.is_element() && n.tag_name().name() == "ID").and_then(|n| n.text()).unwrap_or("").to_string();
            json!({"numero":number, "format":d.root_element().tag_name().name()})
        });
        json!({"index": i, "name": format!("piece-{}.xml", i+1), "invoice": parsed, "source": String::from_utf8_lossy(b)})
    }).collect::<Vec<_>>() }))
}
fn zip(files: Vec<(String, Vec<u8>)>) -> Result<Vec<u8>, String> {
    let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
    if files.iter().map(|(_, b)| b.len()).sum::<usize>() > 100 * 1024 * 1024 { return Err("Export trop volumineux (max 100 Mo).".into()); }
    for (name, bytes) in files {
        writer.start_file(name, zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated)).map_err(|e| e.to_string())?;
        writer.write_all(&bytes).map_err(|e| e.to_string())?;
    }
    Ok(writer.finish().map_err(|e| e.to_string())?.into_inner())
}
pub fn split(data: &[u8], groups: Vec<Group>) -> Result<Value, String> {
    let doc = load(data)?;
    let xml = attachments(&doc)?;
    let count = doc.get_pages().len() as u32;
    if groups.is_empty() || groups.len() > 500 { return Err("Nombre de groupes invalide.".into()); }
    let mut next = 1;
    let mut used = std::collections::HashSet::new();
    for g in &groups {
        if g.start != next || g.end < g.start || g.end > count { return Err("Les groupes doivent couvrir toutes les pages dans l’ordre, sans chevauchement.".into()); }
        next = g.end + 1;
        if let Some(i) = g.xml { if i >= xml.len() || !used.insert(i) { return Err("Chaque XML doit être associé à un seul groupe au maximum.".into()); } }
    }
    if next != count + 1 { return Err("Certaines pages ne sont pas couvertes.".into()); }
    let mut bundle = Vec::new();
    let mut imports = Vec::new();
    for (i, g) in groups.iter().enumerate() {
        let mut part = doc.clone();
        // Retirer toutes les associations et annonces héritées ; aucune conformité PDF/A n'est revendiquée.
        for obj in part.objects.values_mut() {
            if let Object::Dictionary(d) = obj {
                for key in [b"AF".as_slice(), b"EF", b"Metadata", b"Names", b"Annots", b"AcroForm", b"Outlines", b"OpenAction", b"AA"] { d.remove(key); }
            }
        }
        let remove: Vec<_> = (1..=count).filter(|p| *p < g.start || *p > g.end).collect();
        part.delete_pages(&remove);
        part.prune_objects();
        let mut pdf = Vec::new();
        part.save_to(&mut pdf).map_err(|e| e.to_string())?;
        let name = format!("facture-{}", i+1);
        bundle.push((format!("{name}.pdf"), pdf.clone()));
        if let Some(x) = g.xml {
            bundle.push((format!("{name}.xml"), xml[x].clone()));
            let archive = zip(vec![(format!("{name}.pdf"), pdf), (format!("{name}.xml"), xml[x].clone())])?;
            imports.push(json!({"name": format!("{name}.zip"), "base64": base64::engine::general_purpose::STANDARD.encode(archive)}));
        }
    }
    for (i, bytes) in xml.iter().enumerate() { if !used.contains(&i) { bundle.push((format!("xml-non-associes/piece-{}.xml", i+1), bytes.clone())); } }
    bundle.push(("decoupage.json".into(), serde_json::to_vec_pretty(&json!({"source_sha256": crate::facturx::split_hash(data), "groups": groups.iter().map(|g| json!({"start":g.start,"end":g.end,"xml":g.xml})).collect::<Vec<_>>(), "notice":"PDF dérivés : conformité Factur-X/PDF-A et signatures non conservées. Associations XML confirmées par l’utilisateur."})).unwrap()));
    Ok(json!({"bundle": base64::engine::general_purpose::STANDARD.encode(zip(bundle)?), "imports": imports}))
}

#[cfg(test)]
mod tests {
    use super::*;
    use lopdf::{dictionary, Object, Stream};
    fn fixture() -> Vec<u8> {
        let mut doc = Document::with_version("1.7");
        let pages = doc.new_object_id();
        let xml = doc.add_object(Stream::new(dictionary!{}, b"<Invoice><ID>A</ID></Invoice>".to_vec()));
        let fs = doc.add_object(dictionary!{"Type"=>"Filespec", "F"=>Object::string_literal("invoice.xml"), "EF"=>dictionary!{"F"=>xml}});
        let mut kids = Vec::new();
        for _ in 0..3 {
            let contents = doc.add_object(Stream::new(dictionary!{}, Vec::new()));
            let id = doc.add_object(dictionary!{"Type"=>"Page", "Parent"=>pages, "MediaBox"=>vec![0.into(),0.into(),100.into(),100.into()], "Contents"=>contents});
            kids.push(Object::Reference(id));
        }
        doc.objects.insert(pages, Object::Dictionary(dictionary!{"Type"=>"Pages", "Kids"=>kids, "Count"=>3}));
        let root = doc.add_object(dictionary!{"Type"=>"Catalog", "Pages"=>pages, "AF"=>vec![Object::Reference(fs)]});
        doc.trailer.set("Root", root);
        let mut bytes = Vec::new(); doc.save_to(&mut bytes).unwrap(); bytes
    }
    #[test]
    fn partitions_preserve_xml_separately_and_strip_pdf_associations() {
        let bytes = fixture();
        assert!(split(&bytes, vec![Group{start:1,end:1,xml:None},Group{start:3,end:3,xml:None}]).is_err());
        assert!(split(&bytes, vec![Group{start:1,end:2,xml:Some(0)},Group{start:3,end:3,xml:Some(0)}]).is_err());
        assert_eq!(inspect(&bytes).unwrap()["xml"].as_array().unwrap().len(), 1);
        let result = split(&bytes, vec![Group{start:1,end:2,xml:Some(0)},Group{start:3,end:3,xml:None}]).unwrap();
        assert_eq!(result["imports"].as_array().unwrap().len(), 1);
        let zip_bytes = base64::engine::general_purpose::STANDARD.decode(result["bundle"].as_str().unwrap()).unwrap();
        let mut archive = zip::ZipArchive::new(Cursor::new(zip_bytes)).unwrap();
        use std::io::Read;
        for (name, count) in [("facture-1.pdf",2),("facture-2.pdf",1)] {
            let mut pdf = Vec::new(); archive.by_name(name).unwrap().read_to_end(&mut pdf).unwrap();
            let doc = load(&pdf).unwrap(); assert_eq!(doc.get_pages().len(), count);
            assert!(attachments(&doc).unwrap().is_empty());
            assert!(doc.catalog().unwrap().get(b"AF").is_err());
        }
        let mut xml = Vec::new(); archive.by_name("facture-1.xml").unwrap().read_to_end(&mut xml).unwrap();
        assert_eq!(xml, b"<Invoice><ID>A</ID></Invoice>");
    }
    #[test]
    fn ordinary_import_rejects_multiple_invoice_xmls() {
        let mut doc = load(&fixture()).unwrap();
        for object in doc.objects.values_mut() {
            if let Object::Stream(stream) = object {
                if stream.content.starts_with(b"<Invoice>") { stream.set_content(b"<Invoice><ID>A</ID></Invoice>                                                     ".to_vec()); }
            }
        }
        let stream = doc.add_object(Stream::new(dictionary!{}, b"<Invoice xmlns=\"urn:oasis:names:specification:ubl:schema:xsd:Invoice-2\"><ID>B</ID></Invoice>".to_vec()));
        doc.add_object(dictionary!{"Type"=>"Filespec", "F"=>Object::string_literal("other.xml"), "EF"=>dictionary!{"F"=>stream}});
        let mut data = Vec::new(); doc.save_to(&mut data).unwrap();
        let error = crate::facturx::parse_file("multi.pdf", &data).unwrap_err();
        assert!(error.to_string().contains("plusieurs XML"), "{error}");
    }

    #[test]
    fn rejects_gaps_and_duplicate_xml() {
        let data = fixture();
        assert!(split(&data, vec![Group{start:2,end:3,xml:None}]).is_err());
        assert!(split(&data, vec![Group{start:1,end:1,xml:Some(0)},Group{start:2,end:3,xml:Some(0)}]).is_err());
    }
}
