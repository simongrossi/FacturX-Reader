# Changelog

Format : [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/). Versions : [SemVer](https://semver.org/lang/fr/).
Tant que la version est en `0.y.z`, l'application est en développement initial : tout peut changer.

## [Non publié]

### Ajouté

- Contrôles de cohérence dans Données et PDF–données : lignes, quantités de base, frais/remises,
  TVA par catégorie et taux, HT/TTC, acomptes, arrondi et net à payer. Calcul rationnel exact
  sur les valeurs XML d'origine, avec états conforme/écart/non vérifiable/non applicable.
- Détail attendu/constaté/écart et chemins cliquables avec surlignage XML ; rapport JSON via
  la boîte native Enregistrer sous et erreur d'export visible. Échéance passée comme alerte
  indépendante, sans affirmer un impayé ni modifier le statut manuel de vérification.
- Onglet Toutes les factures : tableau des documents ouverts, montants XML HT/TVA/TTC,
  totaux décimaux exacts par devise et contributions négatives des avoirs. Données absentes,
  devise inconnue ou nature non déterminée exclues des contributions avec compteur visible.
- Filtres partagés entre tableau et liste : texte (fournisseur, numéro, montants, lignes et
  commentaires), statut de vérification et masquage des PDF sans XML.
- Statuts manuels À vérifier/Vérifiée/Anomalie, commentaires par facture et ligne, enregistrés
  localement par empreinte XML ; pointage de toutes les lignes en une commande.
- Vue PDF et données côte à côte, défilements séparés repris entre sessions avec le zoom PDF.
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

- Libellés et messages français accentués : colonnes Désignation/Quantité/Référence,
  dates d'émission et d'échéance, synthèse À payer, unités, notes de calcul et alertes.
  Comparaisons de titres utilisées par la synthèse et le badge de date adaptées.
- Modes de paiement traduits selon UNCL4461 : virement SEPA (58), prélèvement SEPA (59),
  carte (48), paiement en ligne (68), ainsi que les libellés des codes 42 et 45 ;
  prise en charge du prélèvement (49). Valeurs et chemins XML conservés.
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

- Le premier chantier P1 (libellés) inclut un contrôle de traduction des paiements dans
  les deux syntaxes UBL/CII et de conservation d'un code inconnu. Référentiel :
  [UNCL4461, OpenPeppol](https://docs.peppol.eu/poacc/billing/3.0/codelist/UNCL4461/).

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
