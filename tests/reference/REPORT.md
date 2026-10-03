# Comparaison des validateurs — 4 octobre 2026

**Résultat final : aucun écart sur le corpus exécuté.** 955 XML (48 documents de départ et
907 variantes), 1 208 comparaisons Schematron et 955 comparaisons XSD. Tous les documents de
départ sont valides XSD. Les 41 exemples France_RFE sont inclus.

Références : SaxonC-HE 12.9 et libxml2 2.9.13, sur macOS Apple Silicon.
Commande : `python3 tests/reference/compare.py --offline`, dans l'environnement Python décrit
par [README.md](README.md). Les versions, empreintes du moteur et listes de règles déclenchées
figurent dans [verified-summary.json](verified-summary.json). Les règles et schémas de
l'application sont ceux de la 0.7.1 en préparation ; les corrections ci-dessous sont non publiées.

## Schematron

Chaque comparaison inclut les identifiants, gravités, occurrences, chemins développés,
verdicts, compteurs et nombre de règles déclenchées. Toutes concordent. Les erreurs de référence
et les règles non évaluables ne sont pas comptées comme des accords.

| Jeu de règles | Comparaisons | Identifiants distincts en erreur | Écarts |
|---|---:|---:|---:|
| BR-CII | 367 | 11 | 0 |
| BR-UBL | 174 | 13 | 0 |
| CTC-CII | 70 | 16 | 0 |
| CTC-UBL | 70 | 23 | 0 |
| EN-CII | 252 | 12 | 0 |
| EN-UBL | 139 | 14 | 0 |
| FX-BASIC | 14 | 14 | 0 |
| FX-BASICWL | 26 | 11 | 0 |
| FX-EXTENDED | 84 | 19 | 0 |
| FX-MINIMUM | 12 | 8 | 0 |

Les variantes XSD à valeur non numérique ou à forme lexicale limite ne sont pas comparées en
Schematron : la référence peut s'arrêter avant de produire un SVRL. Elles restent présentes dans
le manifeste et les comparaisons XSD. Un arrêt inattendu de la référence sur les autres cas
fait échouer le test.

## XSD

522 documents valides et 433 invalides selon libxml2, avec le même verdict dans l'application.

| Schéma | Valides | Invalides | Écarts |
|---|---:|---:|---:|
| CrossIndustryInvoice_100pD22B.xsd | 66 | 54 | 0 |
| Factur-X_1.09.2_BASIC.xsd | 11 | 9 | 0 |
| Factur-X_1.09.2_BASICWL.xsd | 20 | 18 | 0 |
| Factur-X_1.09.2_EN16931.xsd | 187 | 153 | 0 |
| Factur-X_1.09.2_EXTENDED.xsd | 66 | 54 | 0 |
| Factur-X_1.09.2_MINIMUM.xsd | 8 | 10 | 0 |
| UBL-CreditNote-2.1.xsd | 10 | 9 | 0 |
| UBL-Invoice-2.1.xsd | 154 | 126 | 0 |

## Écarts trouvés et corrections

Le premier passage avec SaxonC portait sur 715 XML. Les 1 208 comparaisons Schematron étaient
déjà identiques, mais 15 variantes UBL avec montant non numérique étaient déclarées valides
par `uppsala` 0.10.1, contrairement à libxml2. Le bilan antérieur est conservé dans
[baseline-before-fix.json](baseline-before-fix.json).

Le validateur ne descendait pas jusqu'au type simple sous-jacent quand `simpleContent` dérivait
d'un type complexe, comme `cbc:TaxInclusiveAmountType` → `udt:AmountType` → `ccts:AmountType` →
`xs:decimal`. La [correction amont #44](https://github.com/kushaldas/uppsala/pull/44) est intégrée
via le commit `5d115adf0a1a830d71ec514fe184b5affeee6077` dans Cargo, sans modification des XSD
embarqués. Elle doit être remplacée par une version crates.io lorsqu'elle sera publiée.

Un test Rust vérifie les montants, quantités, pourcentages et dates invalides UBL, les enfants
interdits dans un contenu simple, les attributs hérités obligatoires et le document valide.
La tolérance du faux positif sur `12.` a aussi été resserrée pour ne pas masquer `++12.` ou
`--12.`, qui sont invalides. Le dernier corpus ajoute 240 cas XSD sur les décimaux et les enfants
XML ; ils concordent tous avec libxml2. La suite Rust passe : 63 tests unitaires, 3 tests longs
ignorés ; les 9 tests XSD ont été rejoués après le resserrement. Le test `samples.rs` n'exerce
aucune facture réelle sur ce poste, car `samples/` est absent.

## Portée et limites

- Le corpus vérifie les huit schémas et les dix jeux de règles. Il déclenche des erreurs dans
  chacun, mais n'exerce pas individuellement toutes leurs assertions ni tous les types XSD.
- MINIMUM et BASIC sont couverts par des fixtures ; ils n'ont pas encore d'exemples officiels
  représentatifs ni de factures réelles dans ce corpus.
- L'accord porte sur les règles embarquées. Le profil EXTENDED de France_RFE contient des
  corrections fix-FR04 supplémentaires, décrites dans [README.md](README.md), à examiner
  séparément d'une comparaison de moteurs.
- L'essai SaxonJS 2.7 a échoué avec `XPTY0004` sur une expression EXTENDED que SaxonC exécute.
  SaxonC est la référence retenue ; aucun échec de SaxonJS n'a été interprété comme un accord.
- Le périmètre juridique BR-FR (B2C, exceptions et calendrier) et la conformité PDF/A-3 complète
  restent hors de cette comparaison.
- Le job `reference` est ajouté au workflow `Checks`. Ce bilan rapporte l'exécution locale ;
  il ne présume pas du résultat de la prochaine CI.
