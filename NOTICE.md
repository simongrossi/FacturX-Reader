# Factur-X Reader — mentions légales

Required Notice: Copyright (c) 2026 Christophe Mehault (idée originale et version initiale)
Required Notice: Copyright (c) 2026 Simon Grossi (réécriture Rust / Tauri)

Ce logiciel est distribué sous licence **PolyForm Noncommercial 1.0.0** : voir
[LICENSE.md](LICENSE.md). Seul le texte anglais de la licence fait foi ; le résumé ci-dessous
n'a pas de valeur juridique.

## En résumé

- Le code source est consultable. Chacun peut l'utiliser, le modifier et le redistribuer pour
  un usage **non commercial** (personnel, recherche, enseignement, associations, organismes
  publics).
- Tout **usage commercial** par un tiers est interdit sans accord écrit des titulaires des
  droits.
- Toute copie ou version modifiée doit conserver la licence et les lignes `Required Notice:`
  ci-dessus.

## Droits des auteurs

La licence encadre ce que les **tiers** peuvent faire. Les titulaires des droits, Christophe
Mehault et Simon Grossi, ne sont pas limités par elle : ils restent libres d'utiliser le
logiciel à toutes fins, y compris commerciales, et d'accorder d'autres licences.

Pour un usage commercial : simon.grossi@gmail.com

## Composants tiers embarqués

La licence PolyForm Noncommercial ne couvre que le code de Factur-X Reader.

### Règles de validation EN 16931

- Fichiers : `src-tauri/schematron/EN16931-CII-validation-preprocessed.sch` et
  `EN16931-UBL-validation-preprocessed.sch`, embarqués dans l'application, plus deux factures
  d'exemple utilisées par les tests. © Union européenne, 2017-2026.
- Source : dépôt [ConnectingEurope/eInvoicing-EN16931](https://github.com/ConnectingEurope/eInvoicing-EN16931),
  étiquette `validation-1.3.16`. Les fichiers sont repris **sans modification** ; la correspondance
  exacte est dans [src-tauri/schematron/README.md](src-tauri/schematron/README.md).
- Licence : **EUPL 1.2**, texte complet dans
  [src-tauri/schematron/LICENSE-EUPL-1.2.txt](src-tauri/schematron/LICENSE-EUPL-1.2.txt) et dans
  l'application installée (menu **Aide → Licences des composants tiers**).
- Ces fichiers restent sous EUPL 1.2 : la restriction d'usage non commercial de Factur-X Reader ne
  s'y applique pas, et chacun peut les réutiliser aux conditions de l'EUPL.

### Règles et schémas XSD Factur-X, schémas du Cross Industry Invoice

- Fichiers : `src-tauri/schematron/factur-x/` (règles Schematron et listes de codes des profils
  MINIMUM, BASIC WL, BASIC et EXTENDED), `src-tauri/xsd/factur-x/` (un schéma par profil) et
  `src-tauri/xsd/cii-d22b/` (schéma UN/CEFACT complet du Cross Industry Invoice D22B), embarqués
  dans l'application.
  © FNFE-MPE | FeRD ; schémas CII © UN/CEFACT.
- Source : paquet officiel **Factur-X 1.09.2 / ZUGFeRD 2.5.2** du 4 août 2026, dossier
  `4. FACTUR-X_1.09.2_XSD_SCHEMATRON`, téléchargé sur [fnfe-mpe.org](https://fnfe-mpe.org/factur-x/).
  Repris **sans modification**.
- Licence : **Apache 2.0**, d'après l'avertissement de la spécification Factur-X (page 13) ; texte
  dans [src-tauri/xsd/LICENSE-APACHE-2.0.txt](src-tauri/xsd/LICENSE-APACHE-2.0.txt) et dans
  l'application installée (menu **Aide → Licences des composants tiers**).

### Règles françaises EXTENDED-CTC-FR et BR-FR

- Fichiers : `src-tauri/schematron/france/EXTENDED-CTC-FR-CII.sch`, `EXTENDED-CTC-FR-UBL.sch`,
  `BR-FR-Flux2-Schematron-CII.sch` et `BR-FR-Flux2-Schematron-UBL.sch`,
  embarqués dans l'application, plus trois factures d'exemple utilisées par les tests. Réalisés
  par Quentin Houard et Cyrille Sautereau pour le compte du FNFE-MPE, dérivés des règles
  EN 16931 de la Commission.
- Source : dépôt [fnfempe/France_RFE](https://github.com/fnfempe/France_RFE), étiquette
  `v1.4.0.04`. Repris **sans modification**.
- Licence : le dépôt est sous **Apache 2.0**
  ([src-tauri/schematron/france/LICENSE-APACHE-2.0.txt](src-tauri/schematron/france/LICENSE-APACHE-2.0.txt)) ;
  l'en-tête des fichiers mentionne l'EUPL, licence des règles dont ils dérivent
  ([src-tauri/schematron/LICENSE-EUPL-1.2.txt](src-tauri/schematron/LICENSE-EUPL-1.2.txt)).

### Schémas XSD UBL 2.1

- Fichiers : `src-tauri/xsd/ubl-2.1/`, schémas de la facture et de l'avoir et leurs modules
  communs, dans leur forme d'exécution (`xsdrt`), embarqués dans l'application. © OASIS Open
  2001-2013.
- Source : [OASIS UBL 2.1](http://docs.oasis-open.org/ubl/os-UBL-2.1/), archive `UBL-2.1.zip`.
  Repris **sans modification**.
- Conditions : copie et diffusion libres, sans modification, en conservant la mention OASIS,
  reproduite dans [src-tauri/xsd/NOTICE-OASIS-UBL.txt](src-tauri/xsd/NOTICE-OASIS-UBL.txt) et
  dans l'application installée.

### Bibliothèques

Toutes les bibliothèques embarquées sont sous licences libres permissives et gardent leur
licence : Tauri (MIT / Apache-2.0), PDF.js (Apache-2.0), SQLite (domaine public) via rusqlite
(MIT), lopdf (MIT), xee — moteur XPath qui évalue les règles de validation (MIT), uppsala —
validateur XSD (BSD-2-Clause), include_dir (MIT), et leurs dépendances.

L'application n'embarque plus aucun composant propriétaire : le moteur SaxonJS, utilisé un temps
pour exécuter le Schematron, a été remplacé par une évaluation directe des règles en Rust.


### Outils de comparaison (développement uniquement)

Le test `tests/reference/` utilise SaxonC-HE, libxml2 et l'implémentation ISO Schematron.
Ces outils ne sont pas embarqués dans l'application. Les sources téléchargées, leurs versions
épinglées et leurs licences sont détaillées dans [tests/reference/README.md](tests/reference/README.md).
Les fixtures BASIC, EXTENDED et D22B sont dérivées de l'exemple de la Commission européenne
`CII_example3.xml` (© Union européenne, EUPL 1.2). Le correctif du validateur `uppsala`
reste sous BSD-2-Clause et est repris au commit amont indiqué dans `Cargo.toml`.
