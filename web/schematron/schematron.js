/* Schematron officiel EN 16931 : les règles de la Commission européenne sont évaluées par le
 * moteur de l'application (Rust), hors de la fenêtre. Ce module ne fait que l'appeler. */

const SchematronValidator = (() => {
  async function validate(xmlString, format, priority) {
    if (!xmlString || (format !== "CII" && format !== "UBL")) {
      return { evalue: false, non_conformes: 0, avertissements: 0, erreurs: [] };
    }
    try {
      // Bibliothèque désactivée : le résultat n'est ni repris ni gardé d'une session à l'autre.
      const library = settings.library !== "off";
      const res = await window.__TAURI__.core.invoke("validate_schematron", { xml: xmlString, format, priority: !!priority, library });
      // Une réponse sans verdict explicite n'est jamais un succès.
      if (!res || typeof res.evalue !== "boolean") return { evalue: false, erreur_moteur: "Réponse du moteur de validation inattendue" };
      return res;
    } catch (err) {
      return { evalue: false, erreur_moteur: String((err && err.message) || err) };
    }
  }

  return { validate };
})();
