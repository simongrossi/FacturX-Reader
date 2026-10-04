# Corpus de régression comptable

Ce dossier contient cinq factures XML **synthétiques**, sans données client réelles, et un
manifeste `expected.json`. Les exemples fixent les données lues par le moteur avant le chantier
de précomptabilisation. Ils ne constituent ni un jeu de factures réelles anonymisées ni une
certification de conformité Factur-X/EN 16931.

| Fichier | Cas protégé |
|---|---|
| `cii-minimum.xml` | CII MINIMUM sans lignes, montants et devise EUR |
| `cii-usd.xml` | CII avec ligne, taxe à 20 % et devise USD |
| `ubl-credit.xml` | Avoir UBL, montants déclarés positifs, indicateur d'avoir |
| `ubl-multi-tax.xml` | Achat UBL, deux taux, remise, frais, acompte et net à payer |
| `ubl-rounding.xml` | Petit montant, TVA à 5,5 % et arrondi du net à payer |

`expected.json` porte les valeurs attendues : format, numéro, avoir, devise, HT, TVA, TTC,
net à payer, nombre de lignes et taux de TVA. Le test Rust vérifie également que les XML sont
acceptés par le XSD, que les montants ont une provenance et que la ventilation TVA dispose
d'entrées traçables. Il fabrique à l'exécution un ZIP et un PDF avec `cii-usd.xml` pour vérifier
que l'enveloppe ne change pas les données lues. Il modifie aussi le net à payer d'un achat pour
vérifier qu'une incohérence reste visible dans les contrôles.

Commande :

```bash
cargo test --manifest-path src-tauri/Cargo.toml --test accounting_corpus
```

Pour ajouter un cas, placer un XML synthétique ici et déclarer son résultat dans
`expected.json`. Préférer des identifiants fictifs sans lien avec une entreprise ou une
personne. Les PDF/ZIP sont générés pendant le test, afin qu'une seule source XML fasse foi.
Ce corpus protège la lecture ; il n'affirme pas qu'une écriture comptable est correcte ni que
les formats d'import EBP/Sage sont couverts.
