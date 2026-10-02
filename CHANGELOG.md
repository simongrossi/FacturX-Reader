# Changelog

Format : [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/). Versions : [SemVer](https://semver.org/lang/fr/).
Tant que la version est en `0.y.z`, l'application est en développement initial : tout peut changer.

## [Non publié]

## [0.2.0] - 2026-10-02

### Ajouté

- **Contrôles de cohérence** dans l'onglet Données, calculés en décimaux exacts (aucun
  flottant) : quantité × prix unitaire = total de ligne, somme des lignes, total HT, TVA par
  taux, total TVA, total TTC, net à payer. Chaque contrôle affiche l'attendu, le constaté,
  l'écart et renvoie à l'élément XML. États : conforme, écart, alerte, info, non vérifiable.
- Mentions essentielles (numéro, date, type, devise, vendeur, acheteur) et clés de contrôle
  du SIREN/SIRET, du n° de TVA français et de l'IBAN.
- Dates clés : échéance dépassée ou à venir (hors avoirs et factures soldées), gain
  d'escompte quand le XML le décrit.
- Doublons parmi les documents ouverts : XML identique, ou même vendeur et même numéro.
- Pastille « N écarts » dans la liste des fichiers.
- **Export CSV** des lignes affichées (recherche, filtre de pointage et tri appliqués) et
  copie dans le presse-papiers pour un tableur. Montants en décimale française, devise dans
  sa colonne, protection contre l'injection de formules.
- Recherche rapide (`Ctrl+F`) : texte ou regex, document sélectionné par défaut ou tous
  les documents ouverts. Navigation précédent/suivant et surlignage jaune de l'élément
  trouvé dans XML complet. Recherche des données XML uniquement, hors contenus binaires.
- Exécution des regex dans un worker avec interruption des recherches trop longues.
- Accueil avec ouverture, paramètres, douze documents récents et reprise de session.
- Onglets par document et Accueil permanent ; fermeture par croix, clic central ou `Ctrl+W`,
  navigation `Ctrl+Tab` / `Ctrl+Maj+Tab`.
- Reprise automatique de session, désactivable dans les paramètres : documents, sélection,
  vue, zoom et position ; copie locale des imports sans chemin et signalement des fichiers manquants.
- Scénario de test navigateur couvrant reprise, accueil, onglets, récents, fichier manquant
  et les deux portées de recherche, avec backend Tauri simulé.
- Gestion des copies locales : plafond de 256 Mo, nettoyage automatique des copies
  inutilisées, boutons de nettoyage et d'effacement de l'historique dans les paramètres.
- Limite de 500 documents ouverts ; rafraîchissements groupés pour les imports volumineux.
- Scripts npm pour les tests JavaScript, navigateur, Rust et natifs Windows ; configuration
  Playwright et workflow CI. Facture de test synthétique avec deux pages PDF.

### Corrigé

- Rendu de la vue Données lors du changement de document ; protection contre certains rendus
  asynchrones devenus obsolètes après navigation.
- Position sauvegardée préservée pendant le rendu et la restauration, reprise du défilement
  après changement de vue et zoom individuel. Session invalide et stockage indisponible signalés.

### Documentation et vérification

- Roadmap reprenant les décisions, priorités, limites, pistes API/MCP et précautions normatives.
- Syntaxe JavaScript, neuf tests unitaires Rust et test des factures locales réussis.
  Cinq scénarios navigateur Edge réussis, dont restauration de 500 documents et pannes
  de stockage simulées. Exécutable natif Windows testé avec le vrai moteur et profil WebView2
  jetable, fermeture de fenêtre et relance, PDF multipage, zoom/position, copie locale et fichier manquant.
  Vérifications natives macOS/Linux et installation des paquets restantes.
  Aucune nouvelle version distribuée à ce stade.

## [0.1.0] - 2026-10-02

Première version alpha de l'application de bureau **Tauri 2 + Rust** (Windows, macOS, Linux),
réécriture du prototype Python. L'ancienne
version Python (serveur local + navigateur, exécutable PyInstaller) est retirée.

### Ajouté

- Fenêtre native : plus de serveur HTTP ni de navigateur.
- Moteur d'analyse porté en Rust, avec tests unitaires et test sur les factures de `samples/`.
- **Ouverture de dossiers** : bouton « Ouvrir un dossier » (`Ctrl+Maj+O`), glisser-déposer
  d'un dossier, dossiers acceptés en ligne de commande. `Ctrl+O` ajoute des fichiers.
- **Paramètres** (`Ctrl+,`) : thème, densité des tableaux, onglet affiché en premier, zoom du
  PDF par défaut, emplacement des pointages.
- Thème **Système** (suit le réglage clair/sombre de l'OS).
- Boîte « Enregistrer sous » native pour le PDF.
- Workflow GitHub construisant les installeurs des trois systèmes à chaque tag.

### Modifié

- **Thème clair par défaut** ; palette claire revue, sélecteur de thème déplacé dans les
  Paramètres.
- Les pointages sont enregistrés dans le dossier de données de l'application (un
  `pointages.json` à côté de l'exécutable reste prioritaire : mode portable). Le format du
  fichier est inchangé.
- XML brut : les préfixes d'espaces de noms d'origine (`cbc:`, `ram:`…) sont conservés.

### Corrigé

- La ligne « Type de facture » manquait dans l'en-tête des factures UBL.
- CII : pour la désignation, la devise et le taux de TVA, l'élément principal était ignoré au
  profit de sa variante de repli, même quand il était présent.
