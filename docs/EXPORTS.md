# Exports Excel et rapports PDF

Chantier du 4 octobre 2026, PR #3 fusionnée dans `main` (`e35e7cc`), CI complète verte. Fonctionnalités distribuées dans la [préversion 0.7.1](https://github.com/simongrossi/FacturX-Reader/releases/tag/v0.7.1).

## Utilisation

- **Données → Exporter Excel** : lignes visibles, dans l’ordre du tri, après recherche et filtre de pointage. Colonnes affichées, pointage et devise séparée.
- **Tableau des factures → Exporter Excel** : factures visibles après tous les filtres, dans l’ordre du tri. Deux feuilles : **Factures** et **Totaux par devise**. Les avoirs sont déduits des totaux ; les montants des factures gardent leur valeur d’origine.
- **Données → Contrôles → Rapport PDF** : synthèse, verdicts et périmètre, contrôles de cohérence, règles natives EN 16931, XSD, Schematron et règles françaises, conteneur PDF, statut manuel et commentaires de facture et de lignes.
- Les trois actions sont également disponibles dans **Fichier**. CSV et rapport JSON restent disponibles.

Un export reflète les données au moment du clic. Une validation encore en cours n’est pas attendue : le rapport indique l’état disponible. Réexporter lorsque la validation est terminée. Le suivi est manuel et ne confirme pas le paiement.

## Format et précision

Les XLSX contiennent des montants numériques utilisables dans Excel. Les numéros, références et autres textes sont des chaînes : leurs zéros initiaux sont conservés et un texte commençant par `=` n’est pas une formule. Les valeurs dépassant 15 chiffres significatifs restent textuelles pour éviter une perte de précision par Excel. En-têtes colorés, première ligne figée, filtre automatique et largeurs bornées sont appliqués aux feuilles.

Les totaux par devise reprennent le calcul existant du tableau, en centimes : ils sont une synthèse de travail, pas une écriture comptable. Aucune addition entre devises n’est faite.

Le PDF est en A4, avec une police Noto Sans embarquée, retour automatique à la ligne, pages numérotées et empreinte XML lorsqu’elle est disponible. Les diagnostics officiels gardent leur message d’origine, parfois anglais. Le rapport précise les contrôles non réalisés et ne constitue pas une certification de conformité PDF/A ou de la facture.

## Fonctionnement local et limites

`web/exports.js` produit les fichiers en mémoire, avec ExcelJS 4.4.0 et jsPDF 4.2.1. La commande Rust `save_binary` propose une boîte d’enregistrement et écrit uniquement le fichier choisi. Annuler ne produit pas de message de succès ; une erreur est affichée et rend le bouton à nouveau utilisable. Extensions autorisées : `.xlsx`, `.pdf` ; export plafonné à 100 Mo. La génération utilise de la mémoire avant ce contrôle de taille.

Bibliothèques, police et licences sont distribuées dans `web/exports/` : aucun téléchargement à l’exécution. `scripts/check-export-vendors.cjs`, appelé par `npm run check:js`, vérifie leurs SHA-256 et la correspondance des distributions JS avec les versions de `package-lock.json`. Pour une mise à jour, recopier la distribution officielle et sa licence, actualiser les empreintes puis relancer les tests. Les distributions embarquées sont sans modification.

L’audit npm d’ExcelJS signale une vulnérabilité de son `uuid` transitif dans les fonctions v3/v5/v6 avec tampon fourni. ExcelJS utilise v4 pour les identifiants de mise en forme conditionnelle ; ce chemin vulnérable n’est pas appelé par nos exports. Ce signal devra être revérifié lors d’une mise à jour.

## Vérification et suites

Voir [VALIDATION.md](../VALIDATION.md#exports-excel-et-pdf--chantier-du-4-octobre-2026) pour les preuves locales et CI. Le scénario Playwright relit les XLSX et extrait toutes les pages du PDF, avec un rapport long et des caractères accentués. Une vérification visuelle de neuf pages a été réalisée.

Le chantier suivant ajoute l’aide à la correction aux rapports JSON/PDF : voir [Centre d’anomalies](ANOMALIES.md).

Restent à développer séparément : rapport consolidé multi-factures, test natif des nouvelles boîtes d’enregistrement. L’usage dans Excel/LibreOffice et Aperçu demande encore un essai manuel des fichiers produits.
