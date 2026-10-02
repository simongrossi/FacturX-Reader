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

L'application embarque deux composants qui ne sont pas sous la licence PolyForm Noncommercial
et gardent leur propre licence :

- **SaxonJS 2** (`web/schematron/SaxonJS2.rt.js`) — © Saxonica Ltd. Gratuit, non open source,
  redistribué sans modification sous la *SaxonJS Public License* v1.0 :
  [web/schematron/LICENSE-SAXONJS.txt](web/schematron/LICENSE-SAXONJS.txt). Rétro-ingénierie
  interdite.
- **Règles de validation EN 16931** (`web/schematron/*-validation.sef.json`) — © Union européenne,
  dépôt [ConnectingEurope/eInvoicing-EN16931](https://github.com/ConnectingEurope/eInvoicing-EN16931),
  version 1.3.16, sous licence **EUPL 1.2**. Les fichiers embarqués sont les feuilles XSLT
  officielles compilées au format SEF de SaxonJS, sans modification des règles :
  [web/schematron/NOTICE-EINVOICING.txt](web/schematron/NOTICE-EINVOICING.txt).

Les bibliothèques Rust et JavaScript (Tauri, PDF.js, SQLite, lopdf, etc.) restent sous leurs
licences respectives.
