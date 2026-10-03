# Schémas XSD embarqués

Repris sans modification du paquet officiel **Factur-X 1.09.2 / ZUGFeRD 2.5.2** du 4 août 2026
(FNFE-MPE et FeRD, [fnfe-mpe.org](https://fnfe-mpe.org/factur-x/)), dossier
`4. FACTUR-X_1.09.2_XSD_SCHEMATRON` :

| Ici | Dans le paquet |
|---|---|
| `factur-x/minimum/` | `0. Factur-X_1.09.2_MINIMUM/*.xsd` |
| `factur-x/basicwl/` | `1. Factur-X_1.09.2_BASICWL/*.xsd` |
| `factur-x/basic/` | `2. Factur-X_1.09.2_BASIC/*.xsd` |
| `factur-x/en16931/` | `3. Factur-X_1.09.2_EN16931/*.xsd` |
| `factur-x/extended/` | `4. Factur-X_1.09.2_EXTENDED/*.xsd` |
| `cii-d22b/` | `5. CII D22B XSD/*.xsd` |

Ils sont embarqués dans l'application et appliqués par `src/xsd.rs`, qui choisit le schéma
d'après le profil annoncé par la facture. Licence Apache 2.0 (`LICENSE-APACHE-2.0.txt`), d'après
l'avertissement de la spécification Factur-X.

## Mettre à jour

Remplacer les fichiers par ceux d'une nouvelle version du paquet, mettre à jour les noms de
fichiers et les libellés dans `src/xsd.rs`, puis lancer `cargo test` : les tests vérifient que
tous les schémas se chargent.

Les schémas UBL 2.1 d'OASIS ne sont pas embarqués.
