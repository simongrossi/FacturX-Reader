# Roadmap

Mise à jour : 4 octobre 2026, préparation de la version 0.7.1 et échéancier indicatif en développement.
Voir [CHANGELOG.md](CHANGELOG.md) pour le détail des versions, [README.md](README.md) pour
l'utilisation, [VALIDATION.md](VALIDATION.md) pour le bilan de vérification P0 et
[COMPARATIF.md](COMPARATIF.md) pour le bilan face aux autres outils.

## Où on en est

| Priorité | Thème | État |
|---|---|---|
| P0 | Valider l'existant | Presque terminé : essai macOS positif ; reste la vérification exhaustive, Linux et l’installation des paquets |
| P1 | Confort et fiabilité du moteur | Aux trois quarts : reste la provenance des valeurs, « Ouvrir avec », les tests anonymisés |
| P2 | Exploiter des lots de factures | Presque terminé : revue du lot et échéancier développés ; restent la recherche dans le PDF et le dossier surveillé |
| P3 | Conformité et distribution | Bien avancé : Schematron officiel (suite de tests officielle verte, résultat gardé entre sessions) et déclarations du conteneur ; reste PDF/A réel, règles nationales, signature des builds |
| P4 | API, MCP et connecteurs | Pas commencé |

Versions publiées (pré-versions, builds non signés) :

| Version | Contenu principal |
|---|---|
| 0.2.0 | Contrôles de cohérence en décimaux exacts, export CSV des lignes, doublons, recherche, accueil, onglets, reprise de session |
| 0.3.0 | Tableau multi-factures, filtres d'anomalies, menu clic droit sur les tableaux |
| 0.4.0 | Libellés accentués, suivi de vérification, vue PDF et données, rapport JSON, barre de menus, onglets fixes |
| 0.5.0 | Bibliothèque locale (alerte IBAN, doublons, prix), règles métier EN 16931, impression, protection des pointages et du suivi, en-tête compact |
| 0.6.0 | Schematron officiel EN 16931 évalué en Rust, déclarations du conteneur PDF, verdicts séparés, filtres métier |
| 0.7.0 | Schéma XSD (CII par profil Factur-X, UBL 2.1), Schematron des profils Factur-X, règles françaises EXTENDED-CTC-FR et BR-FR, validation du XML d'origine, contrôles de structure PDF/A-3, Schematron plus rapide |

### Exports enrichis (intégrés, non publiés)

- [x] Export XLSX des lignes affichées et du tableau filtré, avec totaux par devise.
- [x] Rapport de contrôle PDF avec diagnostics, limites et suivi manuel.
- Intégrés dans `main` par la PR #3 (`e35e7cc`) ; [documentation](docs/EXPORTS.md).
- Tests : relecture des XLSX, types numériques et références, texte non interprété comme formule,
  précision supérieure à Excel, accents PDF, rapports longs, pagination et filtre vide.

### Centre d’anomalies (non publié)

- [x] Anomalies regroupées, recherche et filtres, valeurs disponibles, aides à la correction.
- [x] Accès à l’occurrence XML exacte ou au contrôle d’origine, demande de vérification à copier.
- [x] Contrôles incomplets séparés, actualisation Schematron, aide intégrée aux rapports JSON/PDF.
- [Fonctionnement et limites](docs/ANOMALIES.md).

### Revue d’un lot (non publiée)

- [x] Progression de la lecture et des validations Schematron jusqu’au dernier document.
- [x] Points à examiner regroupés pour toutes les factures, erreurs de lecture et contrôles incomplets compris.
- [x] Rapport PDF consolidé de toute la session, indépendamment des filtres, avec avoirs déduits par devise.
- [Fonctionnement et limites](docs/BATCH_REVIEW.md).

### Échéancier indicatif (non publié)

- [x] Regroupement des factures par échéance et devise, avec situation recalculée au jour de l’affichage.
- [x] Avoirs déduits du solde global, sans les affecter à une date absente ; montants inconnus signalés.
- [x] Filtres situation/devise, accès à la facture et export CSV des lignes filtrées et totaux par groupe.
- [Calcul et limites](docs/SCHEDULE.md).

## Prochaines étapes proposées

État au 4 octobre 2026 : la 0.7.0 est publiée en pré-version. L’utilisateur confirme le bon
fonctionnement général sous macOS ; quelques détails de présentation restent à améliorer.
La revue de code postérieure à la 0.7.0 est intégrée dans la préparation de la 0.7.1.

**Comparaison des validateurs terminée localement** (P3) : 955 XML, accord avec SaxonC-HE pour les profils
Factur-X et les règles françaises, et avec libxml2 pour les huit schémas XSD. Le problème
des montants UBL non numériques a été corrigé. Test reproductible et job CI ajoutés ;
[bilan et limites](tests/reference/REPORT.md). Reste à examiner séparément la variante
EXTENDED fix-FR04 de France_RFE et à remplacer le correctif `uppsala` épinglé par une version publiée.

Travaux fusionnés dans `main` : [préparation 0.7.1 (#1)](https://github.com/simongrossi/FacturX-Reader/pull/1),
[comparaison et correctifs (#2)](https://github.com/simongrossi/FacturX-Reader/pull/2)
et [exports Excel/PDF (#3)](https://github.com/simongrossi/FacturX-Reader/pull/3), puis
[centre d’anomalies (#4)](https://github.com/simongrossi/FacturX-Reader/pull/4) et
[revue d’un lot (#5)](https://github.com/simongrossi/FacturX-Reader/pull/5).
Ces PR sont intégrées ; la revue d’un lot est dans `main` depuis `7e33cfa`. Les anciennes branches sont
archivées ou déjà intégrées ; voir [l’inventaire](docs/BRANCHES.md). La prochaine livraison
reste à publier après le contrôle de `main`.

1. **Publier une 0.7.1** avec la revue de code, après les vérifications de cette version.
2. **Compléter la validation des plateformes** (P0) : essai macOS général fait ; restent les
   vérifications détaillées (menus, raccourcis, glisser-déposer, impression, persistance),
   Linux et l’installation documentée des paquets publiés.
3. **Suite de la revue de code** : ne plus refuser un PDF entier pour une pièce jointe secondaire trop
   volumineuse ; poursuivre le découpage de `app.js` et de `facturx.rs`.
4. **Signature des builds** (P3) : dépend d'un certificat Windows et d'un compte développeur
   Apple, à lancer en parallèle.
5. **Affiner le périmètre des règles BR-FR** (B2C, opérations hors obligation, calendrier).
6. **Fin de P1** : provenance des valeurs, « Ouvrir avec » et instance unique.
7. **Bibliothèque `facturx-core`** (P4) : le moteur est assez complet pour être extrait ; à
   décider d'abord, la licence sous laquelle le publier.

Non prioritaires : une validation PDF/A-3 complète (métier de veraPDF), la conversion CII ↔ UBL
(gros chantier, peu utile à un lecteur) et la création de factures (hors périmètre).

### Revue de code du 3 octobre 2026

Revue faite sur le code seul, sans lire la documentation. Les six points ont été vérifiés dans
le code, puis traités ; ils ne figurent pas dans la 0.7.0.

| # | Constat | État | Reste à faire |
|---|---|---|---|
| 1 | Contrôles non unifiés entre la fiche, le tableau et le rapport JSON | Fait : `web/controls.js` calcule les verdicts pour les trois ; colonnes et filtres Schematron, XSD, règles françaises, conteneur ; rapport JSON complet | — |
| 2 | Filtres de la bibliothèque appliqués après la limite de 1000 résultats | Fait : filtres dans SQLite, nombre exact, pagination ; testé sur 1002 factures | Essai sur des milliers de factures réelles |
| 3 | Imports volumineux ou ambigus | Fait : plafonds après décompression (32 Mo pour le XML, 2000 entrées par archive), choix explicite du XML et du PDF dans une archive ambiguë | Un PDF dont une pièce jointe secondaire dépasse le plafond est refusé en entier |
| 4 | Facture déposée impossible à rouvrir depuis la bibliothèque | Fait : « Retrouver le fichier », avec vérification de l'empreinte du XML ; aucun original copié | — |
| 5 | Faire ressortir ce qui demande une action | Fait : synthèse et centre d’anomalies avec aides, valeurs disponibles et accès aux champs | Enrichir les aides et traduire davantage de messages officiels |
| 6 | Tests entre l'interface et le moteur réel | Fait : test natif lancé par la CI, bloquant, avec bibliothèque filtrée, rapport complet, réassociation et plafond de décompression | Scénario natif pour l'archive ambiguë (couvert par les tests Rust et navigateur) |

Découpage du code : `web/controls.js`, `web/imports.js` et `src/facturx/imports.rs` sont sortis
de `app.js` et de `facturx.rs`. Le reste est à faire au fil des chantiers.

### Écarts avec le comparatif

| Ligne du comparatif | Aujourd'hui | Pour cocher la case | Effort | Priorité |
|---|---|---|---|---|
| Schematron officiel EN 16931 | ✅ hors ligne, EN 16931, profils Factur-X, EXTENDED-CTC-FR et BR-FR | Fait sur le corpus documenté (SaxonC-HE) ; couverture exhaustive des règles non revendiquée | — | — |
| Validation XSD | ✅ hors ligne, CII par profil Factur-X et UBL 2.1 | Fait sur 955 XML (libxml2) ; tous les types et contraintes ne sont pas exercés | — | — |
| Validation PDF/A-3 du fichier | Partielle : déclarations et sept points de structure | Décision sur une validation complète (espaces colorimétriques, transparence, flux…) | Élevé | 4 |
| Conversion CII ↔ UBL, ZUGFeRD 1 → 2 | — | Table de correspondance complète des deux syntaxes | Élevé | Plus tard |
| Création de factures | — | Hors périmètre du lecteur | — | Non retenu |

### Bilan face à la concurrence (4 octobre 2026)

Détail dans [COMPARATIF.md](COMPARATIF.md). Parmi les outils dont la page publique a été
consultée, aucun autre ne valide sans réseau, n'applique les règles françaises, ni ne traite un
lot avec historique et suivi. Ce qui en ressort pour le plan :

| Sujet | Décision proposée |
|---|---|
| Licence | Fait : passage à PolyForm Shield 1.0.0, utilisable par tous y compris en entreprise, produit concurrent interdit ; `CONTRIBUTING.md` pour les contributions |
| Comparaison PDF ↔ XML (P3) | À remonter : aucun outil consulté ne la fait, et c'est le risque propre au format hybride |
| Renommage et classement, rapport lisible (P2) | Confirmés : Treesoft et 7-PDF les proposent |
| ZUGFeRD 1.x | Nouveau : un PDF ZUGFeRD 1.x est annoncé « sans XML de facture ». Le dire clairement, puis le lire si le besoin se présente |
| Âge des règles embarquées | Nouveau : afficher version et date, avertir quand elles sont anciennes |
| Chiffres mesurés | Nouveau : poids, démarrage et mémoire, à mesurer avant de les annoncer |
| Order-X, règles XRechnung, ligne de commande | Notés, plus tard ; les deux derniers vont avec l'ouverture hors de France et `facturx-core` |

## P0 — Valider l'existant

- [x] Application native Windows recompilée et vérifiée : reprise PDF, persistance réelle.
- [x] Stockage plein (panne simulée), copie manquante et session de 500 documents testés.
- [x] Copies locales limitées à 256 Mo, nettoyage automatique et manuel, effacement de l'historique.
- [x] Capture de position corrigée pendant le rendu et la restauration ; imports volumineux groupés.
- [x] Tests navigateur reproductibles, Playwright verrouillé, scripts npm et workflow CI.
  CI verte sur `main` depuis la correction de la reprise de session (0.3.0).
- [x] Test natif Windows sur le vrai exécutable : tableau, contrôles, vue côte à côte, suivi (0.4.0).
- [x] Test natif Windows sur la machine d'intégration : lancé par la CI à chaque push, bloquant.
- [x] Essai manuel général macOS : fonctionnement confirmé par l’utilisateur le 4 octobre 2026.
- [ ] Vérification native détaillée macOS et Linux sur les machines correspondantes.
- [ ] Installation et lancement réels des installeurs produits (`.exe`, `.msi`, `.dmg`, paquets Linux).

## P1 — Confort et fiabilité du moteur

### Confort et exploitation

- [x] Recherche rapide (`Ctrl+F`) : texte ou regex, document sélectionné ou tous les documents
  ouverts, navigation et surlignage dans XML complet.
- [x] Accueil, onglets par document, reprise de session, douze documents récents.
- [x] Libellés accentués dans `tables.rs` et le moteur ; modes de paiement UNCL 4461 (0.4.0).
- [x] Export CSV des lignes visibles ou pointées ; copie dans le presse-papiers (0.2.0).
- [x] Barre de menus Fichier / Édition / Affichage / Aide (0.4.0).
- [x] Onglets Accueil et Tableau fixes quand les onglets de documents défilent (0.4.0).
- [x] En-tête compact, recherche repliable, message fermable (0.5.0).
- [x] Menu clic droit : copie de cellule, ligne, colonne ou tableau en TSV, CSV, JSON ou Markdown
  (0.3.0) ; actions sur les onglets et la liste des fichiers (0.4.0).
- [x] Export Excel natif (.xlsx), lignes et tableau filtrés (non publié).
- [ ] Associations de fichiers, « Ouvrir avec » et instance unique.
- [ ] Dossiers dans les récents.

### Socle de fiabilité

- [x] Doublons exacts (empreinte XML) et probables (vendeur + numéro) parmi les documents
  ouverts (0.2.0). Reste : comparer aussi le montant, et l'historique entre sessions (bibliothèque).
- [ ] Calculs monétaires décimaux partout. Fait pour les contrôles (0.2.0) ; l'affichage du P.U.
  et de la TVA de ligne reconstitués reste en `f64`.
- [ ] Provenance des valeurs : distinguer ce qui est extrait du XML de ce qui est reconstitué,
  avec formule, valeur d'origine et chemin consultables.
- [x] Extraction PDF avec un vrai parseur, au-delà des expressions régulières : structures
  complexes, pièces jointes multiples, choix du XML pertinent (`lopdf`, repli de secours).
- [x] Protection des pointages et du suivi : sauvegarde quotidienne, restauration, export/import,
  erreur visible si un fichier est illisible ; une corruption n'est plus traitée comme un
  historique vide. Suivi de vérification déplacé dans `suivi.json`.
- [ ] Jeu de tests anonymisé et versionnable pour la CI : profils sans lignes, avoirs, remises,
  frais, acomptes, plusieurs taux de TVA, arrondis, devises, PDF/ZIP et variantes UBL/CII.
- [ ] Mise à jour de PDF.js (3.11 embarqué) et déclaration explicite du worker.
- [x] VALIDATION.md remis à jour pour la 0.5.0 : vérifié, non vérifié, limites.

## P2 — Exploiter des lots de factures

### Fait

- [x] Contrôles arithmétiques : lignes, remises et frais globaux, TVA par taux, HT/TTC, acomptes,
  arrondis, net à payer (0.2.0).
- [x] Mentions essentielles ; clés de contrôle SIREN/SIRET, n° de TVA français, IBAN (0.2.0).
- [x] Dates clés : échéance dépassée ou à venir, gain d'escompte décrit dans le XML (0.2.0).
- [x] États de contrôle : conforme, écart, alerte, info, non vérifiable ; une règle sans objet
  n'est pas émise (0.2.0).
- [x] Tableau multi-factures : totaux par devise, avoirs déduits, tri, filtre, export CSV (0.3.0).
- [x] Filtres d'anomalies : écart, alerte, échue, sans TVA, émise un week-end, doublon, avoirs,
  non lues (0.3.0) ; filtre par statut de vérification (0.4.0).
- [x] Filtres métier : période (dates début / fin), montants (min / max) et fournisseur dans le
  tableau multi-factures et la bibliothèque locale.
- [x] Vue PDF et données côte à côte, défilements indépendants (0.4.0).
- [x] Statuts « À vérifier », « Vérifiée », « Anomalie », commentaires par facture et par ligne,
  pointage de la facture entière ; distinct d'un paiement confirmé (0.4.0).
- [x] Rapport de contrôle exportable en JSON : règle, attendu, constaté, écart, chemin XML (0.4.0).
- [x] Revue du lot : progression, anomalies transversales et rapport PDF consolidé de tous les documents ouverts (non publiée).
- [x] Échéancier indicatif des factures ouvertes (non publié).

### Prévu

- [ ] Mentions adaptées au profil (MINIMUM, BASIC WL, BASIC, EN 16931, EXTENDED) et contrôle
  des taux de TVA légaux.
- [ ] Règle de ligne : décider du traitement des émetteurs dont le prix unitaire et les frais de
  ligne ne redonnent pas le total (plusieurs écarts par facture sur certains fournisseurs).
- [ ] Recherche dans les lignes de toutes les factures et filtres dans la liste latérale
  (fournisseur, numéro, montant, statut), masquage des PDF sans XML.
- [ ] Recherche dans le texte du PDF et surlignage ; décider séparément du besoin d'OCR.
- [x] Verdicts communs à la fiche, au tableau et au rapport JSON ; synthèse de ce qui demande
  une action en tête de la fiche ; colonnes et filtres Schematron, XSD, règles françaises.
- [x] Imports bornés après décompression ; choix explicite dans une archive ambiguë.
- [x] Rapport de contrôle PDF et rapport consolidé sur plusieurs factures.
- [x] Impression de la vue affichée (données, contrôles, tableau, XML, PDF).
- [ ] Renommage et classement des fichiers depuis les métadonnées (`Fournisseur_Date_N°.pdf`),
  avec confirmation avant toute écriture.
- [x] Échéancier indicatif à partir des échéances du tableau, sans déduire le paiement effectif.
- [ ] Dossier surveillé, progression et annulation des imports, analyse lourde hors du fil principal.

### Bibliothèque locale et ce qui en dépend

- [x] Bibliothèque locale persistante (SQLite) de toutes les factures vues : recherche par
  fournisseur, numéro, date, montant, référence ou désignation d'article, entre les sessions.
- [x] Alerte de changement d'IBAN par fournisseur (anti-fraude au virement).
- [x] Doublons sur l'historique, au-delà des documents ouverts.
- [x] Historique des prix unitaires par article et par fournisseur, variation signalée.
- [x] Bibliothèque : filtres par période, montants et fournisseur, appliqués dans la base avant
  la pagination ; « Retrouver le fichier » avec vérification de l'empreinte. Reste : recherche
  dans les commentaires, graphique de prix, validation explicite d'un nouvel IBAN, sauvegarde/export de la base.
- [ ] Grille de prix négociés importée et alerte de dépassement.

## P3 — Conformité et distribution

- [ ] **Signature Windows, notarisation macOS**, puis mise à jour automatique Tauri. À traiter en
  premier : des installeurs non signés sont déjà distribués.
- [x] Règles métier EN 16931 évaluées nativement : BR, BR-CO, BR-DEC et règles par catégorie de
  TVA, reliées aux données concernées. Hors Schematron officiel.
- [ ] Compléter les règles natives : listes de codes (pays, devises, unités, types de facture),
  remises et frais de ligne, règles nationales françaises (CIUS).
- [x] Schematron officiel EN 16931 (Commission européenne, v1.3.16) : règles embarquées sans
  modification et évaluées en Rust (moteur XPath `xee`), hors de l'interface, sur CII et UBL.
  Comparé à SaxonJS sur 583 documents. Aucun composant propriétaire, aucun `eval` dans la fenêtre.
- [x] Conteneur PDF : déclarations lues (PDF/A-3 annoncé, pièce jointe déclarée, relation, profil
  annoncé comparé au XML). Ce n'est pas une validation ISO 19005-3.
- [x] Verdicts séparés : lecture, calculs, règles EN 16931, Schematron officiel, conteneur, avec
  la mention de ce qui n'est pas contrôlé.
- [x] Résultat Schematron gardé dans la bibliothèque, par empreinte du XML, et repris d'une
  session à l'autre (mêmes règles, même version de l'application).
- [x] Schematron plus rapide : contextes trouvés en un seul parcours, assertions indépendantes
  du nœud évaluées une fois, recherches `//nom` réécrites en `/descendant::nom`. Huit à onze fois
  plus rapide sur 19 factures réelles (3,1 s → 0,4 s pour les plus grosses), résultats identiques
  vérifiés par test.
- [x] Suite de tests officielle de la Commission embarquée et exécutée par `cargo test`, donc
  par la CI : 1169 cas, tous au résultat attendu.
- [x] Schematron des profils Factur-X (MINIMUM, BASIC WL, BASIC, EXTENDED) : règles officielles
  Factur-X 1.09.2 embarquées, choisies d'après le profil annoncé. Le moteur a appris les
  constats `report` et les listes de codes externes.
- [x] Règles du profil français EXTENDED-CTC-FR (FNFE-MPE, dépôt France_RFE 1.4.0.04), CII et
  UBL ; le moteur exécute les variables `let`.
- [x] Règles BR-FR de la réforme française : fonctions `xsl:function` et variables globales
  écrites dans les expressions ; évaluées, avec leur propre verdict, pour le profil
  EXTENDED-CTC-FR et les factures dont vendeur et acheteur sont en France.
- [ ] Règles BR-FR : affiner le périmètre (B2C, opérations hors obligation, calendrier).
- [x] Schematron et schéma XSD sur le XML d'origine plutôt que sur sa version réindentée, avec
  repli signalé si le moteur ne lit pas l'original.
- [x] Validation du schéma XSD des factures CII : schémas officiels des cinq profils Factur-X
  1.09.2 et CII D22B embarqués, choisis d'après le profil annoncé, validateur `uppsala` en Rust
  pur, à l'analyse de la facture.
- [x] Schéma XSD des factures et avoirs UBL : schémas OASIS UBL 2.1 embarqués.
- [x] Comparaison reproductible à SaxonC-HE des règles Factur-X et françaises (CII/UBL),
  erreurs et occurrences identiques sur le corpus documenté.
- [x] Schéma XSD : comparaison à libxml2 sur 955 XML ; types simples hérités UBL corrigés.
- [x] Conteneur PDF, contrôles réels partiels : chiffrement, profil de sortie, polices
  incorporées, identifiant, scripts, métadonnées Factur-X, relation et type de la pièce jointe.
- [ ] Validation PDF/A-3 complète du fichier (type veraPDF).
- [ ] Comparaison PDF vs XML : montants clés recherchés dans le texte du PDF, écart mis en
  évidence (PDF texte uniquement). Puis synchronisation au clic XML ↔ PDF.
- [ ] Signature électronique du PDF : détecter sa présence, puis vérifier l'intégrité.
- [ ] Conversion CII ↔ UBL.
- [ ] ZUGFeRD 1.x (`CrossIndustryDocument`) : message explicite au lieu de « sans XML de
  facture », puis lecture si des fichiers réels se présentent.
- [ ] Version et date des règles embarquées affichées ; avertissement quand elles sont anciennes.
- [ ] Mesurer le temps de démarrage et la mémoire, et publier les chiffres.
- [ ] Order-X et règles nationales XRechnung : à décider avec l'ouverture hors de France.
- [ ] Distribution portable Windows en ZIP ; le mode portable des pointages existe déjà.
- [ ] Interface en anglais.

## P4 — API, MCP et architecture réutilisable

Préalable : extraire `facturx-core`, sans dépendance Tauri, réutilisable par l'application,
les tests, un outil en ligne de commande et un serveur MCP. Fiabiliser le moteur avant
l'exposition à des assistants ou l'import automatique à grande échelle.

### Connecteurs natifs

- [ ] Menu **Sources**, interface Rust commune pour lister et télécharger des factures.
- [ ] Connexions optionnelles et désactivées par défaut ; application utilisable hors ligne.
- [ ] Identifiants et jetons dans le trousseau système ; permissions/CSP limitées par connecteur.
- [ ] Appels réseau déclenchés explicitement et import local avec provenance.
- [ ] Annuaire SIREN/SIRET (entreprise active, procédure en cours, code APE) : premier appel
  réseau de l'application, donc optionnel et désactivé par défaut.
- [ ] Choisir un premier connecteur selon l'usage réel et vérifier les conditions d'accès avant codage.

| Candidat | Besoin / point à vérifier avant développement |
|---|---|
| Boîte mail IMAP | Pièces jointes, filtres expéditeur/dossier, authentification prise en charge |
| Pennylane | Centralisation comptable, droits et accès à l'API de la société |
| Plateforme agréée | Cibler la plateforme réellement retenue et ses contrats d'API |
| Chorus Pro | Factures du secteur public, accès PISTE et authentification à vérifier |
| Portails fournisseurs | Connecteur au cas par cas lorsqu'une API est disponible |
| SFTP, WebDAV, S3 | Dépôt distant d'un ERP, proche du dossier surveillé |

### Deux usages MCP distincts

- [ ] **Serveur MCP** : binaire `facturx-mcp`, transport stdio, première version en lecture seule,
  dossiers autorisés et limites de taille. Outils envisagés : analyser une facture, lister les
  lignes, vérifier les totaux, lire les pointages ; réponses structurées issues du moteur commun.
- [ ] **Client MCP** : récupérer des factures auprès de serveurs tiers ; à développer seulement
  si le besoin et les serveurs disponibles le justifient, avec gestion des autorisations.

Le serveur est le premier usage MCP proposé. Son ordre par rapport au premier connecteur natif
reste guidé par l'usage réel. Un serveur local ne garantit pas que les données restent sur
la machine : les résultats transmis à l'assistant peuvent partir chez son fournisseur.

### Hors périmètre du lecteur, à ce stade

Évoqués pendant les échanges, non retenus tant qu'un besoin réel ne les justifie pas :
rapprochement avec les bons de livraison, traducteur vers les formats d'ERP (SAP, Oracle,
Dynamics) et formats bancaires, workflow de bon à payer avec notifications, suivi budgétaire
par projet. Ces deux derniers supposent plusieurs utilisateurs et un serveur : un autre produit.

## Limites connues

- La recherche porte sur les données XML, pas sur le texte du PDF ni les contenus binaires.
- Le Schematron officiel est exécuté et le schéma XSD contrôlé, mais ni la conformité PDF/A-3
  complète du fichier, ni les règles nationales autres que françaises ne sont contrôlées. Aucun appel réseau ne vérifie
  l'existence d'un SIREN ni le titulaire d'un IBAN.
- Le tableau porte sur les documents ouverts (500 au maximum). La bibliothèque ne connaît que les
  factures ouvertes au moins une fois sur ce poste : la première facture d'un fournisseur ne
  déclenche aucune alerte d'IBAN.
- Les copies locales des fichiers déposés ne suivent pas les modifications du fichier d'origine.
- Les builds ne sont pas signés.

## Références et précautions de spécification

Le texte technique fourni pendant les échanges est une piste de travail, pas une spécification
normative validée. En particulier :

- BASIC WL signifie **Without Lines** ; adapter l'affichage et les contrôles aux profils.
- Ne pas limiter la conception à CII D16B : les versions récentes utilisent D22B.
- La page FNFE-MPE consultée pendant les échanges annonce Factur-X 1.09.2 / ZUGFeRD 2.5.2,
  publié le 4 août 2026. Revérifier la version et télécharger ses artefacts lors de l'implémentation.
- Vérifier dans les spécifications officielles les références ISO, AFRelationship, identifiants
  et schemeID, métadonnées et règles nationales ; ne pas reprendre les affirmations du texte
  joint sans validation. La génération de factures a été évoquée dans ce texte, mais n'est
  pas un chantier décidé pour ce lecteur.

Sources : [FNFE-MPE](https://fnfe-mpe.org/factur-x/factur-x_en/),
[implémentation Factur-X](https://fnfe-mpe.org/factur-x/implementer-factur-x/),
[MD-Workshop](https://github.com/simongrossi/MD-Workshop).
La capture SmoothCSV fournie sert de référence pour l'accueil.
