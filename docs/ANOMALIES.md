# Centre d’anomalies et aide à la correction

Chantier du 4 octobre 2026, après l’intégration des [exports Excel et PDF](EXPORTS.md) dans `main` (PR #3, merge `e35e7cc`). Fonctionnalités non encore distribuées dans une version publiée.

## Parcours utilisateur

Dans **Données**, le **Centre d’anomalies** rassemble les points à examiner. Le bouton de la synthèse et **Fichier → Centre d’anomalies** permettent d’y accéder directement.

Chaque carte indique le niveau (écart ou alerte), la source, la règle lorsqu’elle existe, le message du contrôle, les valeurs trouvée et attendue si elles sont disponibles, l’écart éventuel et une action conseillée. La recherche porte aussi sur les valeurs, chemins et actions. Les filtres de gravité et de source se combinent. Ils sont conservés pour ce document pendant la session et lors de l’arrivée des résultats Schematron ; ils ne sont pas enregistrés entre les lancements.

- **Voir le champ dans le XML** ouvre l’onglet XML complet, efface son filtre de recherche pour rendre le champ visible et surligne l’occurrence exacte.
- **Voir le contrôle** ouvre le bloc d’origine lorsqu’aucun emplacement exact ne peut être établi. Un champ absent n’est pas présenté comme un champ existant.
- **Copier la demande de vérification** prépare un texte concernant une carte.
- **Copier la demande (N)** reprend toutes les anomalies correspondant aux filtres, y compris celles qui ne sont pas encore affichées à cause de la pagination. Le texte demande une vérification et une facture corrigée si nécessaire.

Ces actions copient du texte dans le presse-papiers. L’application n’envoie aucun courriel, ne modifie pas le XML et ne change pas les verdicts des moteurs. Les modèles sont destinés à être relus avant transmission.

## Sources et sens des résultats

| Source | Présentation |
|---|---|
| Cohérence et historique | Écarts de calcul, mentions, identifiants, échéances, alertes historiques et doublons parmi les documents ouverts |
| Règles EN 16931 natives | Règles `non_conforme` ; valeurs explicites fournies par le moteur pour les règles de présence et les égalités de montants |
| Schematron officiel | Assertions en échec ; `warning` est une alerte, les autres échecs un écart ; message d’origine conservé |
| BR-FR | Alertes distinctes, demandant de confirmer le périmètre français avant correction |
| Schéma XSD | Erreurs de structure/format, ligne et colonne si disponibles, avec indication XML d’origine ou affiché ; accès au bloc XSD, pas à une ligne approximative |
| Lecture | Avertissements de l’import, conservés tels qu’ils ont été émis |

Une même donnée peut être signalée par le calcul natif et par le Schematron. Les cartes ne sont pas fusionnées : la source et la règle restent traçables. Les verdicts par famille existants et le tableau multi-factures restent la référence de leur périmètre.

Les contrôles impossibles, les règles non évaluables, les données insuffisantes et le Schematron en cours apparaissent dans **Vérification à compléter**. Ils ne deviennent pas des erreurs de facture. Une liste vide n’est jamais affichée comme une vérification complète lorsque ces limites existent. Si le XSD tronque ses diagnostics, le centre indique le nombre total et le nombre détaillé.

## Valeurs et actions proposées

Les valeurs du contrôle sont prioritaires. Pour les règles natives de montants, `attendu` et `constate` sont ajoutés au résultat Rust sous forme de décimaux exacts, sans recalcul JavaScript. Les règles de présence indiquent « Valeur renseignée » et la valeur lue ou « Absent du XML ». Pour les anciens résultats, une égalité dont le détail suit le format natif « Attendu X, constaté Y. » reste exploitable.

À défaut, la valeur trouvée peut être lue dans une feuille XML correspondant exactement à l’emplacement. Une valeur de groupe, binaire ou tronquée n’est pas utilisée. Une valeur inconnue est affichée **Non fournie par ce contrôle**. Le schéma XSD attendu est nommé ; aucun montant ni format particulier n’est deviné à partir d’un message générique.

Les actions couvrent notamment les calculs/arrondis, les mentions absentes, les formats, les identifiants, les doublons, les échéances et le conteneur PDF. Les alertes d’IBAN demandent confirmation auprès d’un contact connu ; une échéance passée ne prouve pas un impayé. Pour une règle inconnue, l’aide demande de vérifier l’énoncé avec le fournisseur. Les libellés des règles de présence BR-01 à BR-15 reprennent l’implémentation native lorsqu’elle n’est pas disponible dans le résultat officiel.

## Emplacements XML et fonctionnement

`web/anomalies.js` normalise les résultats en `{ issues, incomplete }`. Les cartes utilisent exclusivement du texte DOM, y compris pour des messages contenant du HTML. L’affichage est limité initialement à 50 cartes ; **Afficher davantage** en ajoute 50. La copie filtrée et les exports reprennent la liste complète.

Les chemins natifs sont utilisés directement lorsqu’ils existent dans les lignes XML. Les chemins Schematron sont résolus seulement s’ils sont des suites d’éléments explicites, éventuellement préfixés et indexés. Les espaces de noms et indices sont vérifiés sur le XML affiché avant conversion vers le chemin natif. Aucun XPath arbitraire n’est exécuté. Un chemin ambigu ou non supporté renvoie au contrôle d’origine. Les emplacements ne sont pas extrapolés à partir de mots trouvés dans un message XSD.

L’actualisation des résultats conserve les filtres, la recherche et son focus. Le centre est une couche de présentation : les règles officielles, leurs compteurs et la validation XSD ne sont pas modifiés.

## Rapports, vérifications et limites

Le rapport JSON ajoute le champ `aide_correction` avec les cartes et les vérifications incomplètes. Le rapport PDF ajoute une section **Aide à la correction** contenant les sources, valeurs disponibles et actions conseillées. Les rapports capturent l’état au moment de l’export ; attendre la fin de l’évaluation pour un bilan définitif. [Documentation des exports](EXPORTS.md).

Vérifications automatisées : regroupement de six sources, écarts/alertes, combinaisons des filtres, absence de faux succès lors d’une évaluation incomplète, valeurs inconnues, copie filtrée et individuelle, aucun HTML exécuté, seconde occurrence d’une ligne XML préfixée, actualisation pendant la saisie et valeurs natives de présence/calcul. [Bilan de validation](../VALIDATION.md).

Limites : pas de traduction exhaustive des messages officiels (certains restent anglais), pas de correction automatique, pas de déduction complète de la valeur attendue pour toutes les assertions, pas de regroupement sémantique entre moteurs. Les chemins XSD renvoient au bloc de diagnostics. Le centre porte sur le document courant ; la [revue d’un lot](BATCH_REVIEW.md) rassemble ces points entre documents. Les essais manuels des nouvelles fonctions sur les trois systèmes restent à réaliser.
