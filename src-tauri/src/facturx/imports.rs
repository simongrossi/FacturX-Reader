//! Bornes communes aux extractions ZIP et PDF, y compris les chemins de secours.
use std::io::Read;
use super::FacturXError;

pub const MAX_EXPANDED: usize = 200 * 1024 * 1024;
pub const MAX_XML: usize = 32 * 1024 * 1024;
pub const MAX_METADATA: usize = 4 * 1024 * 1024;
pub const MAX_ZIP_ENTRIES: usize = 2000;

#[derive(Clone, serde::Deserialize, serde::Serialize)]
pub struct ArchiveSelection {
    pub xml: usize,
    pub pdf: Option<usize>,
}

pub fn archive_entries(data: &[u8]) -> Result<Vec<(usize, String)>, FacturXError> {
    let mut zip = zip::ZipArchive::new(std::io::Cursor::new(data))
        .map_err(|e| FacturXError(format!("Archive ZIP invalide : {e}")))?;
    if zip.len() > MAX_ZIP_ENTRIES { return Err(FacturXError("Archive trop volumineuse : plus de 2000 entrées.".into())); }
    (0..zip.len()).map(|i| {
        let entry = zip.by_index_raw(i).map_err(|e| FacturXError(e.to_string()))?;
        Ok((i, entry.name().to_string()))
    }).collect()
}

pub fn read_bounded(reader: impl Read, limit: usize) -> std::io::Result<Vec<u8>> {
    let mut bytes = Vec::new();
    reader.take(limit as u64 + 1).read_to_end(&mut bytes)?;
    if bytes.len() > limit {
        return Err(std::io::Error::new(std::io::ErrorKind::FileTooLarge,
            format!("Limite de décompression dépassée ({limit} octets).")));
    }
    Ok(bytes)
}

pub fn decompress_candidates(blob: &[u8]) -> Result<Vec<Vec<u8>>, FacturXError> {
    let mut out = Vec::new();
    for decoded in [
        read_bounded(flate2::read::ZlibDecoder::new(blob), MAX_XML),
        read_bounded(flate2::read::DeflateDecoder::new(blob), MAX_XML),
    ] {
        match decoded {
            Ok(bytes) => out.push(bytes),
            Err(e) if e.kind() == std::io::ErrorKind::FileTooLarge => return Err(FacturXError(e.to_string())),
            Err(_) => {}, // Ce flux n'utilise pas ce codage ; essayer le suivant.
        }
    }
    if blob.len() <= MAX_XML { out.push(blob.to_vec()); }
    Ok(out)
}

pub fn pdf_stream(stream: &lopdf::Stream, limit: usize) -> Result<Vec<u8>, FacturXError> {
    stream.get_plain_content_with_limit(limit)
        .map_err(|e| FacturXError(format!("Lecture du flux PDF impossible (plafond {limit} octets) : {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn bounded_reads_accept_boundary_and_stop_inflation() {
        assert_eq!(read_bounded(&b"abcd"[..], 4).unwrap(), b"abcd");
        assert_eq!(read_bounded(&b"abcde"[..], 4).unwrap_err().kind(), std::io::ErrorKind::FileTooLarge);
        let mut z = flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::default());
        z.write_all(&vec![b'x'; 65536]).unwrap();
        let data = z.finish().unwrap();
        assert_eq!(read_bounded(flate2::read::ZlibDecoder::new(&data[..]), 1024).unwrap_err().kind(), std::io::ErrorKind::FileTooLarge);
        let mut stream = lopdf::Stream::new(lopdf::Dictionary::new(), vec![b'x'; 65536]);
        stream.compress().unwrap();
        assert!(pdf_stream(&stream, 1024).is_err());
        assert_eq!(pdf_stream(&stream, 65536).unwrap().len(), 65536);
    }
}
