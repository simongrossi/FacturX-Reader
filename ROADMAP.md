# Roadmap

Mise à jour : 2 octobre 2026, après la version 0.5.0.
Voir [CHANGELOG.md](CHANGELOG.md) pour le détail des versions, [README.md](README.md) pour
l'utilisation et [VALIDATION.md](VALIDATION.md) pour le bilan de vérification P0.

## Où on en est

| Priorité | Thème | État |
|---|---|---|
| P0 | Valider l'existant | Presque terminé : reste macOS, Linux et l'installation des paquets |
| P1 | Confort et fiabilité du moteur | Aux deux tiers : reste la provenance des valeurs, le parseur PDF, « Ouvrir avec », l'export Excel |
| P2 | Exploiter des lots de factures | Presque terminé : reste la recherche dans le PDF, le dossier surveillé, l'échéancier |
| P3 | Conformité et distribution | Commencé : règles métier EN 16931 natives ; reste XSD, Schematron officiel, PDF/A, signature |
| P4 | API, MCP et connecteurs | Pas commencé |

Versions publiées (pré-versions, builds non signés) :

| Version | Contenu principal |
|---|---|
| 0.2.0 | Contrôles de cohérence en décimaux exacts, export CSV des lignes, doublons, recherche, accueil, onglets, reprise de session |
| 0.3.0 | Tableau multi-factures, filtres d'anomalies, menu clic droit sur les tableaux |
| 0.4.0 | Libellés accentués, suivi de vérification, vue PDF et données, rapport JSON, barre de menus, onglets fixes |
| 0.5.0 | Bibliothèque locale (alerte IBAN, doublons, prix), règles métier EN 16931, impression, protection des pointages et du suivi, en-tête compact |

## Prochaines étapes proposées

1. **Signature des builds** (P3) : des installeurs sont désormais distribués sur GitHub. Demande
   un certificat de signature Windows et un compte développeur Apple.
2. **Fin de la fiabilité P1** : provenance des valeurs, puis « Ouvrir avec » et instance unique.
3. **Confort P1** : « Ouvrir avec », instance unique, export Excel natif.

## P0 — Valider l'existant

- [x] Application native Windows recompilée et vérifiée : reprise PDF, persistance réelle.
- [x] Stockage plein (panne simulée), copie manquante et session de 500 documents testés.
- [x] Copies locales limitées à 256 Mo, nettoyage automatique et manuel, effacement de l'historique.
- [x] Capture de position corrigée pendant le rendu et la restauration ; imports volumineux groupés.
- [x] Tests navigateur reproductibles, Playwright verrouillé, scripts npm et workflow CI.
  CI verte sur `main` depuis la correction de la reprise de session (0.3.0).
- [x] Test natif Windows sur le vrai exécutable : tableau, contrôles, vue côte à côte, suivi (0.4.0).
- [ ] Vérification native macOS et Linux sur les machines correspondantes.
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
- [ ] Export Excel natif (.xlsx).
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

### Prévu

- [ ] Mentions adaptées au profil (MINIMUM, BASIC WL, BASIC, EN 16931, EXTENDED) et contrôle
  des taux de TVA légaux.
- [ ] Règle de ligne : décider du traitement des émetteurs dont le prix unitaire et les frais de
  ligne ne redonnent pas le total (plusieurs écarts par facture sur certains fournisseurs).
- [ ] Recherche dans les lignes de toutes les factures et filtres dans la liste latérale
  (fournisseur, numéro, montant, statut), masquage des PDF sans XML.
- [ ] Recherche dans le texte du PDF et surlignage ; décider séparément du besoin d'OCR.
- [ ] Rapport de contrôle lisible (PDF ou HTML) et rapport consolidé sur plusieurs factures.
- [x] Impression de la vue affichée (données, contrôles, tableau, XML, PDF).
- [ ] Renommage et classement des fichiers depuis les métadonnées (`Fournisseur_Date_N°.pdf`),
  avec confirmation avant toute écriture.
- [ ] Échéancier de décaissements à partir des échéances du tableau.
- [ ] Dossier surveillé, progression et annulation des imports, analyse lourde hors du fil principal.

### Bibliothèque locale et ce qui en dépend

- [x] Bibliothèque locale persistante (SQLite) de toutes les factures vues : recherche par
  fournisseur, numéro, date, montant, référence ou désignation d'article, entre les sessions.
- [x] Alerte de changement d'IBAN par fournisseur (anti-fraude au virement).
- [x] Doublons sur l'historique, au-delà des documents ouverts.
- [x] Historique des prix unitaires par article et par fournisseur, variation signalée.
- [x] Bibliothèque : filtres par période, montants et fournisseur. Reste : recherche dans les
  commentaires, graphique de prix, validation explicite d'un nouvel IBAN, sauvegarde/export de la base.
- [ ] Grille de prix négociés importée et alerte de dépassement.

## P3 — Conformité et distribution

- [ ] **Signature Windows, notarisation macOS**, puis mise à jour automatique Tauri. À traiter en
  premier : des installeurs non signés sont déjà distribués.
- [x] Règles métier EN 16931 évaluées nativement : BR, BR-CO, BR-DEC et règles par catégorie de
  TVA, reliées aux données concernées. Hors Schematron officiel.
- [ ] Compléter les règles natives : listes de codes (pays, devises, unités, types de facture),
  remises et frais de ligne, règles nationales françaises (CIUS).
- [x] Validation officielle par Schematron EN 16931 (CEN / Commission européenne v1.3.16)
  exécutée 100 % localement dans la WebView via SaxonJS (SEF). Reste : validation schéma XSD.
- [x] Validation du conteneur PDF/A-3, métadonnées XMP, pièces jointes déclarées (/AF) et
  cohérence avec le profil XML annoncé.
- [x] Verdicts séparés : lecture réussie, calculs cohérents, règles EN 16931 respectées, Schematron
  officiel respecté, conteneur PDF/A-3 valide, avec mention de ce qui n'est pas contrôlé (schéma XSD).
- [ ] Comparaison PDF vs XML : montants clés recherchés dans le texte du PDF, écart mis en
  évidence (PDF texte uniquement). Puis synchronisation au clic XML ↔ PDF.
- [ ] Signature électronique du PDF : détecter sa présence, puis vérifier l'intégrité.
- [ ] Conversion CII ↔ UBL.
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
- Les règles EN 16931 sont une implémentation native, pas le Schematron officiel ; ni le schéma
  XSD ni le conteneur PDF/A-3 ne sont contrôlés. Aucun appel réseau ne vérifie l'existence
  d'un SIREN ni le titulaire d'un IBAN.
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
