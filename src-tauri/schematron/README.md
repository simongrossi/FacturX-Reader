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
| `LICENSE-EUPL-1.2.txt` | `LICENSE.txt` |

Les deux fichiers `.sch` sont embarqués dans l'application et évalués par `src/schematron.rs`.
Ils restent sous EUPL 1.2 : la licence PolyForm Noncommercial de Factur-X Reader ne s'y applique pas.

## Mettre à jour les règles

Remplacer les deux fichiers `.sch` par ceux d'une nouvelle étiquette du dépôt officiel, mettre à
jour `RULES_VERSION` dans `src/schematron.rs` et ce fichier, puis lancer `cargo test` : les tests
vérifient que toutes les règles se compilent et que les exemples officiels passent.
