# Roadmap

Mise à jour : 2 octobre 2026. Synthèse des échanges et ordre de développement proposé.
Les éléments cochés existent dans le code local ; ils ne constituent pas une version publiée.
Voir CHANGELOG.md pour les changements et README.md pour l'utilisation.
Le bilan de vérification P0 est dans [VALIDATION.md](VALIDATION.md).

## Développé localement — validé sous Windows

- [x] Recherche rapide (`Ctrl+F`) : texte, numéros, regex sans distinction de casse.
- [x] Portée explicite : **document sélectionné** par défaut, ou **tous les documents ouverts**.
- [x] Résultats sur les champs, valeurs, attributs et chemins XML ; un résultat par élément.
- [x] Navigation précédent/suivant, `Entrée` / `Maj+Entrée`, ouverture de la bonne facture
  dans XML complet et surlignage jaune de la ligne. `Échap` efface la recherche.
- [x] Regex exécutées dans un worker, erreurs expliquées, interruption après deux secondes.
- [x] Accueil inspiré de SmoothCSV : ouvrir, ouvrir un dossier, paramètres, douze documents récents.
- [x] Onglet Accueil permanent et un onglet par document, inspirés de MD-Workshop.
- [x] Fermeture individuelle (croix, clic central, `Ctrl+W`), navigation `Ctrl+Tab` / `Ctrl+Maj+Tab`.
- [x] Reprise automatique de session par défaut, option de démarrage sur l'accueil et reprise manuelle.
- [x] Conservation des documents, document actif, vue, position et zoom ; les pointages restent séparés.
- [x] Relecture des fichiers connus par chemin ; copie locale IndexedDB des imports sans chemin.
- [x] Signalement des fichiers indisponibles sans bloquer les autres documents.

Limites : recherche dans les données XML uniquement, pas dans le texte du PDF ni les contenus
binaires. Le jaune couvre l'élément XML, pas chaque occurrence du terme. Les récents portent
sur les documents, pas encore les dossiers. Les copies locales ne suivent pas les modifications
du fichier original. La session n'est pas une bibliothèque indexée de toutes les factures.

Vérification P0 : neuf tests unitaires Rust et test sur les factures locales réussis ; cinq
scénarios navigateur Edge (dont PDF multipage, quota, cache manquant et session de 500 documents).
Test Windows natif sur les builds debug et release, avec le vrai moteur Rust et un profil WebView2 jetable : fermeture de la
fenêtre et relance, reprise du PDF de deux pages, zoom/position, copie IndexedDB,
fichier manquant et recherche. Les quotas navigateur sont simulés dans les tests de panne.
Les vérifications macOS/Linux et l'installation des paquets restent à faire sur ces systèmes.

## P0 — Terminer et valider les changements actuels

- [x] Recompiler et vérifier l'application native Windows, reprise PDF et persistance réelle.
- [x] Tester stockage plein (panne simulée), copie manquante et session de 500 documents.
- [x] Limiter les copies locales à 256 Mo, supprimer les copies inutilisées, proposer
  nettoyage et effacement de l'historique dans les paramètres. Préserver la session et les pointages.
- [x] Corriger la capture de position pendant le rendu/restauration et regrouper les mises
  à jour de l'interface et le nettoyage lors des imports volumineux.
- [x] Tests navigateur reproductibles dans le projet, dépendance Playwright verrouillée,
  scripts npm et workflow CI ajoutés (exécution distante à constater au prochain push).
- [ ] Vérification native macOS/Linux sur machines correspondantes ; installation et lancement
  des installeurs Windows produits, hors du test de l'exécutable.

## P1 — Gains immédiats et fiabilité du moteur

### Confort et exploitation

- [x] Libellés français accentués dans `tables.rs`, le moteur et l'interface : Désignation,
  Quantité, Date d'échéance, Référence, À payer, unités, messages et infobulles.
  Comparaisons des titres de synthèse et badge de date adaptées ; tests concernés vérifiés.
- [x] Traductions des modes de paiement corrigées selon UNCL4461 : notamment 58 virement SEPA,
  59 prélèvement SEPA, 48 carte et 68 paiement en ligne ; codes source conservés.
- [ ] Export CSV / Excel des lignes visibles ou pointées ; copie de tableaux dans le presse-papiers.
- [ ] Associations de fichiers, « Ouvrir avec » et instance unique.
- [ ] Compléter les récents avec les dossiers.

### Socle de fiabilité, avant les contrôles et connecteurs

- [ ] Calculs monétaires décimaux à la place des `f64`, avec règles d'arrondi explicites.
- [ ] Distinguer les valeurs extraites du XML des valeurs reconstituées : provenance, formule,
  valeur d'origine et chemin XML consultables. Ne pas présenter un calcul comme une donnée source.
- [ ] Extraction PDF avec un vrai parseur, au-delà des expressions régulières actuelles :
  structures PDF complexes, pièces jointes multiples, sélection du XML pertinent.
- [ ] Protection des pointages : sauvegarde, restauration, export/import, erreur visible si le
  fichier est illisible ; ne pas traiter une corruption comme un historique vide.
- [ ] Détection des doublons exacts (empreinte XML, déjà disponible), puis des doublons possibles
  (fournisseur, numéro, montant), sans fusion automatique de documents simplement ressemblants.
- [ ] Jeu de tests anonymisé et versionnable pour la CI : profils sans lignes, avoirs, remises,
  frais, acomptes, plusieurs taux de TVA, arrondis, devises, PDF/ZIP et variantes UBL/CII.
- [ ] Mise à jour de PDF.js (3.11 embarqué actuellement) et déclaration explicite du worker.
- [ ] Auditer les autres correspondances de codes héritées du moteur Python (TVA, unités,
  types de documents) avec leurs référentiels officiels ; certaines traductions sont à revoir.

## P2 — Traitement quotidien de lots de factures

- [x] Tableau multi-factures : fournisseur, numéro, date, HT, TVA, TTC, échéance et état de vérification.
  Totaux séparés par devise ; prise en compte explicite des avoirs.
- [x] Recherche transversale dans les lignes et filtre de la liste des fichiers (fournisseur,
  numéro, montant), masquage optionnel des PDF sans XML.
- [ ] Recherche dans le texte du PDF et surlignage à l'emplacement trouvé : extension distincte
  de la recherche XML actuelle ; décider séparément du besoin d'OCR pour les scans.
- [x] Vue PDF et données côte à côte, défilements indépendants et zoom du PDF conservés.
- [x] Statuts « À vérifier », « Vérifiée », « Anomalie », commentaires par facture et par ligne,
  pointage de la facture entière. Distinguer vérification et paiement confirmé.
  Suivi local lié à l'empreinte XML ; commande de pointage de toutes les lignes.
  Premier lot P2 : ces quatre chantiers sont réalisés. Deuxième lot : contrôles et rapport
  JSON réalisés ci-dessous. Recherche PDF, bibliothèque et dossier surveillé restent à développer.
- [x] Contrôles arithmétiques locaux : lignes, remises/frais globaux, TVA par catégorie/taux, HT/TTC,
  acomptes, arrondis, net à payer et avoirs ; échéance dépassée comme alerte distincte,
  sans déduire automatiquement qu'une facture est impayée.
- [x] Résultats de contrôle : conforme au contrôle, écart détecté, non vérifiable, non applicable.
  L'absence de lignes détaillées n'est pas automatiquement une erreur.
- [x] Rapport de contrôle JSON exportable par « Enregistrer sous » : règle, attendu, constaté,
  écart, chemins XML, devise, empreinte et politique de calcul. Clic sur un chemin : XML surligné.
  Calculs rationnels exacts sur les feuilles XML, arrondi local à deux décimales (demi-unité
  éloignée de zéro) et tolérance de 0,02 sur les lignes. Données absentes/ambiguës ou devises
  incompatibles : non vérifiable. Les variantes CII anciennes ou catégories sans taux peuvent
  rester non vérifiables ; ce lot n'implémente pas les règles normatives XSD/Schematron.
- [ ] Impression / export PDF de la vue Données.
- [ ] Bibliothèque locale persistante : recherche fournisseur, référence article, période,
  montant et commentaires entre les sessions, au-delà des seuls documents ouverts.
- [ ] Dossier surveillé, progression/annulation des imports et analyse lourde hors du fil principal.

## P3 — Validation normative et distribution

- [ ] Validation XML XSD puis Schematron, selon le profil et la version ; versions des jeux
  de règles traçables et erreurs reliées aux données concernées.
- [ ] Validation du conteneur PDF/A, métadonnées XMP, association et cohérence avec le XML.
- [ ] Présenter séparément : lecture réussie, contrôles arithmétiques, validation XML et validation
  du conteneur. Un fichier lisible n'est pas nécessairement un Factur-X conforme.
- [ ] Signature Windows, notarisation macOS, puis mise à jour automatique Tauri.
  **Faire remonter la signature en priorité dès la distribution à d'autres utilisateurs.**
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
