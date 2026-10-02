/* Validation officielle Schematron EN 16931 via SaxonJS embarqué (100 % local).
 * Feuilles officielles CEN / Commission européenne (ConnectingEurope/eInvoicing-EN16931).
 */

const SchematronValidator = (() => {
  const sefCache = {
    CII: null,
    UBL: null,
  };

  async function loadSef(format) {
    if (sefCache[format]) return sefCache[format];
    const filename = format === "UBL" ? "schematron/ubl-validation.sef.json" : "schematron/cii-validation.sef.json";
    try {
      const resp = await fetch(filename);
      if (!resp.ok) throw new Error("HTTP " + resp.status + " sur " + filename);
      const json = await resp.json();
      sefCache[format] = json;
      return json;
    } catch (err) {
      console.warn("Impossible de charger la feuille SEF Schematron " + format + " :", err);
      return null;
    }
  }

  function parseSvrl(svrlText) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svrlText, "application/xml");
    const failedNodes = doc.querySelectorAll("failed-assert, *|failed-assert");
    const asserts = [];
    let fatals = 0;
    let warnings = 0;

    failedNodes.forEach((node) => {
      const id = node.getAttribute("id") || "";
      const flag = (node.getAttribute("flag") || "fatal").toLowerCase();
      const location = node.getAttribute("location") || "";
      const textNode = node.querySelector("text, *|text");
      const text = textNode ? textNode.textContent.trim().replace(/\s+/g, " ") : "";

      const isWarning = flag === "warning" || flag === "info";
      if (isWarning) warnings++;
      else fatals++;

      asserts.push({
        id,
        flag: isWarning ? "warning" : "fatal",
        texte: text,
        location,
      });
    });

    return {
      evalue: true,
      total: asserts.length,
      non_conformes: fatals,
      avertissements: warnings,
      erreurs: asserts,
    };
  }

  async function validate(xmlString, format) {
    if (!xmlString || (format !== "CII" && format !== "UBL")) {
      return { evalue: false, non_conformes: 0, avertissements: 0, erreurs: [] };
    }
    if (typeof SaxonJS === "undefined") {
      console.warn("SaxonJS non disponible dans l'environnement.");
      return { evalue: false, erreur_moteur: "SaxonJS non chargé" };
    }

    const sef = await loadSef(format);
    if (!sef) {
      return { evalue: false, erreur_moteur: "Feuille SEF introuvable" };
    }

    const t0 = performance.now();
    try {
      const res = SaxonJS.transform({
        stylesheetInternal: sef,
        sourceText: xmlString,
        destination: "serialized",
      });
      const t1 = performance.now();
      const svrl = res.principalResult || "";
      const parsed = parseSvrl(svrl);
      parsed.duree_ms = Math.round(t1 - t0);
      parsed.ok = parsed.non_conformes === 0;
      return parsed;
    } catch (err) {
      console.error("Erreur lors de l'exécution du Schematron officiel :", err);
      return { evalue: false, erreur_moteur: String(err) };
    }
  }

  return {
    validate,
  };
})();
