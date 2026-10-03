# Règles de validation EN 16931

Fichiers repris sans modification du dépôt officiel de la Commission européenne
[ConnectingEurope/eInvoicing-EN16931](https://github.com/ConnectingEurope/eInvoicing-EN16931),
étiquette `validation-1.3.16`, sous licence **EUPL 1.2** (`LICENSE-EUPL-1.2.txt`).
© Union européenne, 2017-2026.

| Fichier ici | Fichier d'origine |
|---|---|
| `EN16931-CII-validation-preprocessed.sch` | `cii/schematron/preprocessed/EN16931-CII-validation-preprocessed.sch` |
| `EN16931-UBL-validation-preprocessed.sch` | `ubl/schematron/preprocessed/EN16931-UBL-validation-preprocessed.sch` |
| `exemples/CII_example3.xml` | `cii/examples/CII_example3.xml` (utilisé par les tests) |
| `exemples/ubl-tc434-example3.xml` | `ubl/examples/ubl-tc434-example3.xml` (utilisé par les tests) |
| `tests-officiels/` | `test/` : suite de tests officielle, un fichier par règle (utilisée par les tests) |
| `LICENSE-EUPL-1.2.txt` | `LICENSE.txt` |

Les deux fichiers `.sch` sont embarqués dans l'application et évalués par `src/schematron.rs`.
La suite `tests-officiels/` sert seulement aux tests : chaque cas indique, pour une règle, si
elle doit être respectée (`success`), enfreinte (`error`) ou signalée en avertissement
(`warning`) ; `testfiles/` contient des factures complètes qui ne doivent enfreindre aucune
règle bloquante. Elle est presque entièrement UBL : la Commission n'y fournit que deux cas CII.
Ils restent sous EUPL 1.2 : la licence PolyForm Shield de Factur-X Reader ne s'y applique pas.

## Règles Factur-X

`factur-x/` : règles Schematron (`FACTUR-X_*.sch`) et listes de codes (`*_codedb.xml`) des profils
MINIMUM, BASIC WL, BASIC et EXTENDED, reprises sans modification du paquet officiel
**Factur-X 1.09.2 / ZUGFeRD 2.5.2** du 4 août 2026 (FNFE-MPE et FeRD), dossier
`4. FACTUR-X_1.09.2_XSD_SCHEMATRON`. Licence Apache 2.0, d'après l'avertissement de la
spécification ; texte dans `../xsd/LICENSE-APACHE-2.0.txt`.

Elles sont appliquées aux factures CII qui annoncent l'un de ces profils. Au chargement,
`src/schematron.rs` traite un `report` comme une assertion inversée et écrit dans chaque test de
liste de codes la liste que la règle va chercher dans le fichier `codedb`. Pour une nouvelle
version : remplacer les huit fichiers, mettre à jour `FX_VERSION`, lancer `cargo test`.

## Règles françaises EXTENDED-CTC-FR

`france/` : règles Schematron du profil français EXTENDED-CTC-FR, en CII et en UBL, et trois
factures d'exemple (`exemples/`), reprises sans modification du dépôt
[fnfempe/France_RFE](https://github.com/fnfempe/France_RFE), étiquette `v1.4.0.04` :
`FNFE_RFE_INVOICE/{CII,UBL}/EXTENDED-CTC-FR/schematron/` et `FNFE_RFE_INVOICE/Z.example/TEST/`.
Dépôt sous Apache 2.0 (`france/LICENSE-APACHE-2.0.txt`).

Elles sont appliquées aux factures qui annoncent ce profil. `src/schematron.rs` place devant
chaque test les variables `let` de la règle qu'il emploie. Pour une nouvelle version : remplacer
les fichiers, mettre à jour `CTC_FR_VERSION`, lancer `cargo test`.

`BR-FR-Flux2-Schematron-CII.sch` et `-UBL.sch` (même dépôt, `{CII,UBL}/EN16931/schematron/`) :
les règles BR-FR de la réforme, en mode bloquant. Elles s'ajoutent au jeu de règles du profil
pour une facture au profil EXTENDED-CTC-FR ou dont vendeur et acheteur sont en France. Elles
définissent des fonctions `xsl:function` et des variables globales, que le moteur XPath ne
connaît pas : `src/schematron.rs` les écrit dans chaque expression qui les emploie.

## Mettre à jour les règles

Remplacer les deux fichiers `.sch` et le dossier `tests-officiels/` par ceux d'une nouvelle
étiquette du dépôt officiel, mettre à jour `RULES_VERSION` dans `src/schematron.rs` et ce
fichier, puis lancer `cargo test` : les tests vérifient que toutes les règles se compilent, que
les exemples officiels passent et que chaque cas de la suite officielle donne le résultat attendu.
