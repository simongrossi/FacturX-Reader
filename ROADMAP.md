# Roadmap

Pistes d'évolution, de la plus proche à la plus lointaine. Rien ici n'est encore développé.

## 1. Confort d'ouverture

- **Associations de fichiers et « Ouvrir avec »** : déclarer l'application pour les `.xml` /
  `.pdf` de factures, et réutiliser la fenêtre déjà ouverte (instance unique) au lieu d'en
  lancer une seconde.
- **Fichiers et dossiers récents** dans l'écran d'accueil.
- **Dossier surveillé** : choisir un dossier (boîte de dépôt, export de l'ERP, téléchargements)
  et y charger automatiquement les nouvelles factures.
- **Filtre de la liste de fichiers** (fournisseur, n° de facture, montant) quand un dossier
  entier est ouvert, et masquage optionnel des PDF sans XML.
- Mémoriser la session (fichiers ouverts, onglet, position) entre deux lancements.

## 2. Exploitation des données

- **Export des lignes** en CSV / Excel (lignes visibles ou pointées), copie d'un tableau dans
  le presse-papiers.
- **Vue multi-factures** : un tableau des factures ouvertes (fournisseur, date, HT, TVA, TTC,
  échéance) avec totaux et recherche transversale dans toutes les lignes.
- **Contrôles de cohérence** : somme des lignes = total HT, TVA recalculée par taux, HT + TVA =
  TTC, échéance dépassée — avec un indicateur par facture.
- **Validation EN 16931** : schéma XSD puis règles métier (Schematron), avec la liste des
  règles en erreur.
- **Pointages enrichis** : commentaire par ligne, export / import des pointages, pointage de
  la facture entière (« vérifiée »).
- Impression / export PDF de l'onglet Données.

## 3. Qualité et distribution

- **Libellés accentués** : les titres hérités du premier moteur sont sans accents
  (« Designation », « Quantite », « Date d'echance ») ; les corriger dans `tables.rs` et le
  moteur.
- **Mise à jour de PDF.js** (3.11 actuellement) et déclaration explicite du worker.
- **Signature des builds** (certificat Windows, notarisation macOS) et **mise à jour
  automatique** via le plugin updater de Tauri.
- Version **portable** Windows (zip sans installeur).
- Analyse des gros fichiers hors du fil principal, avec barre de progression pour les dossiers.
- Jeu de factures de test **anonymisées** versionnable, pour que les tests tournent aussi en CI
  (aujourd'hui `samples/` est local uniquement).
- Interface en anglais.

## 4. Connecteurs : récupérer les factures à la source

Objectif : un menu **Sources** où l'on configure des connexions, et d'où l'on importe des
factures sans passer par des fichiers téléchargés à la main.

### Principe

- Chaque connecteur implémente la même interface côté Rust : *lister* les factures disponibles
  (période, fournisseur, statut) et *télécharger* une facture (PDF Factur-X ou XML). Le moteur
  d'analyse existant fait le reste.
- Les identifiants (clés API, jetons OAuth) sont stockés dans le **trousseau du système**
  (Gestionnaire d'identifications Windows, Trousseau macOS, Secret Service Linux), jamais dans
  un fichier de configuration.
- L'application reste utilisable hors ligne : les connecteurs sont optionnels, désactivés par
  défaut, et chaque appel réseau est déclenché explicitement par l'utilisateur. La CSP et les
  permissions Tauri devront être ouvertes connecteur par connecteur.
- Les factures importées sont mises en cache localement, avec leur source d'origine.

### Connecteurs candidats

| Source | Intérêt | Remarques |
|---|---|---|
| **Boîte mail (IMAP)** | les factures arrivent souvent en pièce jointe | filtre par expéditeur / dossier ; le plus générique |
| **Pennylane** | factures fournisseurs déjà centralisées | API publique, jeton par société |
| **Plateforme agréée (PA, ex-PDP)** | canal officiel de la réforme de la facturation électronique | une API par plateforme : à cibler selon celle retenue |
| **Chorus Pro** | factures du secteur public | API PISTE, authentification OAuth + compte technique |
| **Portails fournisseurs** (opérateurs, transporteurs…) | factures récurrentes | au cas par cas, seulement s'il existe une API |
| **Dossier distant** (SFTP, WebDAV, S3) | dépôts automatisés d'un ERP | proche du « dossier surveillé » |

À faire avant de coder : choisir le premier connecteur selon l'usage réel (probablement IMAP
ou Pennylane), et vérifier pour chacun les conditions d'accès à l'API.

### MCP (Model Context Protocol)

Deux usages distincts, à ne pas confondre :

1. **Factur-X Reader comme serveur MCP** — exposer le moteur à un assistant IA (Claude, etc.)
   sous forme d'outils : `analyser_facture(chemin)`, `lister_lignes`, `verifier_totaux`,
   `lire_pointages`. Un binaire `facturx-mcp` en ligne de commande (transport stdio)
   réutiliserait directement `facturx.rs`, sans interface graphique. C'est le plus simple à
   réaliser et le plus utile à court terme : l'assistant lit les factures locales sans que les
   fichiers quittent la machine autrement que par ce que l'utilisateur lui demande.
2. **Factur-X Reader comme client MCP** — se brancher sur des serveurs MCP existants (comptabilité,
   messagerie, stockage) pour y récupérer des factures. Plus souple que des connecteurs écrits
   à la main, mais dépend des serveurs disponibles et demande une interface de gestion des
   connexions et des autorisations.

Ordre proposé : serveur MCP d'abord (étape 1), puis le premier connecteur natif, et le client
MCP seulement si le besoin se confirme.

### Préalable technique

Extraire le moteur dans une **crate séparée** (`facturx-core`, sans dépendance à Tauri) : elle
servirait à l'application, au binaire MCP et à un éventuel outil en ligne de commande, et se
compilerait beaucoup plus vite pour les tests.
