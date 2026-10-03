//! Lot JSON [{"path": "facture.xml", "format": "CII" | "UBL"}], résultats dans le même ordre.
use std::io::{self, Read};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut input = String::new();
    io::stdin().read_to_string(&mut input)?;
    let requests: Vec<serde_json::Value> = serde_json::from_str(&input)?;
    let inputs = requests.iter().map(|request| {
        let path = request["path"].as_str().ok_or("path manquant")?;
        let format = request["format"].as_str().ok_or("format manquant")?;
        Ok((std::fs::read_to_string(path)?, format.to_string()))
    }).collect::<Result<Vec<_>, Box<dyn std::error::Error>>>()?;
    serde_json::to_writer(io::stdout(), &facturx_reader_lib::reference_validation::validate(&inputs))?;
    Ok(())
}
