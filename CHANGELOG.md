# Changelog

Format : [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/). Versions : [SemVer](https://semver.org/lang/fr/).
Tant que la version est en `0.y.z`, l'application est en développement initial : tout peut changer.

## [Non publié]

### Ajouté

- **Schematron gardé d'une session à l'autre** : le résultat est enregistré dans la bibliothèque,
  par empreinte du XML, et repris à la réouverture au lieu d'être recalculé. Il n'est repris que
  pour les mêmes règles et la même version de l'application ; « Vider la bibliothèque » l'efface.
  Bibliothèque désactivée : rien n'est gardé.
- **Liste des documents ouverts** : le chevron de la barre d'onglets ou `Ctrl+E` ouvre une liste
  filtrable au clavier. La molette fait défiler les onglets.

- **Suite de tests officielle** de la Commission (1169 cas) exécutée à chaque `cargo test` :
  chaque règle donne le résultat attendu.
- **Règles françaises EXTENDED-CTC-FR** : une facture CII ou UBL au profil de la réforme
  française est évaluée avec les règles de ce profil publiées par le FNFE-MPE (dépôt France_RFE,
  version 1.4.0.04, Apache 2.0), embarquées sans modification. Le moteur a appris les variables
  `let` des règles. Les règles BR-FR de la réforme ne sont pas encore exécutées.
- **Schematron des profils Factur-X** : une facture CII annoncée MINIMUM, BASIC WL, BASIC ou
  EXTENDED est évaluée avec les règles officielles Factur-X 1.09.2 de son profil, embarquées sans
  modification, au lieu des règles EN 16931 de la Commission, qui y signalaient des erreurs sans
  objet. Le bloc nomme le jeu de règles appliqué.
- **Conteneur PDF, contrôles de structure** : au-delà des déclarations, sept exigences de PDF/A-3
  et de Factur-X sont vérifiées dans le fichier : absence de chiffrement, profil de sortie,
  polices incorporées, identifiant, absence de script, métadonnées Factur-X, relation et type de
  la pièce jointe. Contrôle partiel, annoncé comme tel ; le verdict du conteneur en tient compte.
- **Schéma XSD** : la structure du XML est contrôlée contre le schéma officiel. Factures et
  avoirs UBL : schémas OASIS UBL 2.1. Factures CII : schéma du profil
  annoncé par la facture — MINIMUM, BASIC WL, BASIC, EN 16931 ou EXTENDED, schémas officiels
  Factur-X 1.09.2 — et, pour tout autre CII, contre le schéma UN/CEFACT complet D22B. Schémas
  embarqués sans modification, appliqués par le validateur open source `uppsala`. Verdict dédié,
  bloc listant chaque erreur avec sa ligne, détail dans le rapport JSON.

### Corrigé

- Conteneur PDF : la version de PDF/A et le profil Factur-X n'étaient pas lus quand les
  métadonnées XMP les écrivent en attributs à guillemets simples (`pdfaid:part='3'`). Ces
  fichiers étaient signalés à tort comme « PDF/A-3 attendu ».
- Schematron : une règle de la forme « A et B » dont la seconde moitié ne pouvait pas être
  calculée était classée « non évaluable » même quand la première était déjà fausse ; elle est
  maintenant signalée comme enfreinte, comme le font les moteurs de référence (cas `BR-CO-15`
  avec deux totaux de TVA dans la même devise).

### Modifié

- **Validation du XML d'origine** : le Schematron et le schéma XSD portent sur le XML tel qu'il
  figure dans le fichier, et non plus sur la version réindentée affichée par l'application, où
  les pièces jointes binaires sont abrégées. Si l'original est illisible par le moteur, la
  version réindentée est évaluée à sa place et le bloc le signale.
- **Schematron plus rapide** : les contextes des règles sont trouvés en un seul parcours du
  document, les assertions qui ne dépendent pas de la ligne ne sont évaluées qu'une fois, et les
  recherches dans tout le document sont réécrites sous une forme que le moteur XPath parcourt
  vingt fois plus vite. Huit à onze fois plus rapide sur des factures réelles : 0,4 s au lieu de
  3,1 s pour les plus grosses. Résultats identiques à l'évaluation d'origine sur 302 factures
  réelles et variantes.
- **Accueil** : cinq documents récents, « Plus… » pour la liste complète, croix pour en retirer un.
- Compilation de développement allégée : dépendances sans informations de débogage et
  bibliothèque liée une seule fois (cibles mobiles de Tauri abandonnées).

## [0.6.0] - 2026-10-02

### Ajouté

- **Schematron officiel EN 16931** : les règles publiées par la Commission européenne
  (`eInvoicing-EN16931` v1.3.16, licence EUPL 1.2), 806 pour CII et 979 pour UBL, sont embarquées
  sans modification et évaluées par le moteur de l'application, en Rust, avec le moteur XPath
  open source `xee`. Verdict dédié et bloc listant chaque règle non respectée ou avertissement,
  avec son identifiant, son texte et son emplacement. Validation en arrière-plan, sur plusieurs
  fils, résultat mis en cache pour la session.
- **Conteneur PDF** : extraction par un vrai parseur PDF (`lopdf`), avec repli sur l'ancienne
  méthode. Lecture des déclarations du fichier : PDF/A-3 annoncé dans les métadonnées XMP, pièce
  jointe XML déclarée dans le catalogue (`/AF`, `/EmbeddedFiles`), relation, profil annoncé
  comparé à celui du XML. Ce sont des déclarations lues, pas une validation ISO 19005-3.
- **Filtres métier** dans le tableau multi-factures et la bibliothèque : période, plage de
  montants TTC, fournisseur, avec remise à zéro.

### Modifié

- **Verdicts séparés** : lecture, calculs, règles EN 16931, Schematron officiel et conteneur PDF
  ont chacun leur verdict dans l'onglet Données, le tableau et le rapport JSON. Une mention
  rappelle ce qui n'est pas contrôlé : schéma XSD, conformité PDF/A-3 réelle du fichier, règles
  nationales. Aucun verdict ne vaut certification.
- Chaque contrôle porte sa famille (`calcul`, `mention`, `date`, `historique`, `conteneur`) ; la
  pastille rouge de la liste ne compte plus que les écarts de calcul.

### Corrigé

- Schematron : un XML sans rapport avec une facture (autre racine ou autre espace de noms) était
  déclaré « respecté », aucune règle ne s'y appliquant. Il est maintenant « non évalué ».
- Conteneur : le verdict affirmait un conteneur « valide » dès qu'une version de PDF/A était
  déclarée, y compris PDF/A-1. Il exige PDF/A-3 et parle de déclaration. Les valeurs absentes du
  fichier (niveau de conformité, relation de la pièce jointe) ne sont plus remplacées par une
  valeur par défaut.
- Menu **Aide → Licences des composants tiers** : le texte de l'EUPL et la notice des règles
  officielles sont consultables dans l'application.
- Le verdict Schematron ne se mettait pas à jour à la fin de la validation du document affiché.

## [0.5.0] - 2026-10-02

### Ajouté

- **Règles métier EN 16931** évaluées par le moteur sur chaque facture UBL ou CII : mentions
  obligatoires (BR-01 à BR-16), lignes (BR-21 à BR-27), remises, frais, ventilation de TVA et
  paiement (BR-31 à BR-61), calculs (BR-CO), décimales (BR-DEC) et règles par catégorie de TVA
  (BR-S, BR-Z, BR-E, BR-AE, BR-IC, BR-G, BR-O). Bloc dédié dans l'onglet Données, pastille dans
  la liste, filtre et export dans le tableau, détail dans le rapport JSON. Implémentation
  native, hors Schematron officiel ; XSD, listes de codes, CIUS et PDF/A-3 non couverts.
- **Bibliothèque locale** (SQLite) : chaque facture analysée est enregistrée et retrouvable entre
  les sessions dans l'onglet Bibliothèque, avec recherche jusque dans les lignes et réouverture
  depuis l'emplacement d'origine. Désactivable dans les Paramètres.
- Constats tirés de l'historique, ajoutés aux contrôles : **IBAN différent des factures
  précédentes du fournisseur**, **doublon probable** dans la bibliothèque, **prix unitaire
  modifié**. Historique des prix d'un article dans le détail d'une ligne.
- **Protection des pointages et du suivi** : sauvegarde quotidienne avant la première
  modification (sept conservées), restauration depuis les Paramètres, export et import fusionné
  dans un seul fichier.
- **Impression** de la vue affichée (`Ctrl+P`, menu Fichier) : données, contrôles, tableau, XML
  ou PDF, sans l'habillage de l'application.
- README : logo, badges, captures d'écran sur factures fictives, comparatif avec d'autres outils.

### Modifié

- **En-tête compact** : dès qu'un document est ouvert, le bandeau avec le logo et les boutons
  d'ouverture disparaît ; le logo passe dans la barre de menus, la recherche et les paramètres
  deviennent deux icônes à droite des onglets. La barre de recherche est repliée par défaut
  (loupe, `Ctrl+F`, `Échap` pour fermer).
- Le bandeau de message se ferme avec sa croix.
- Le suivi de vérification est enregistré dans `suivi.json`, à côté de `pointages.json`, et non
  plus dans le stockage de la WebView. Les suivis existants sont repris au premier lancement.

### Corrigé

- Un fichier de pointages illisible ou vide était traité comme un historique vide, puis écrasé
  au pointage suivant. Il est désormais signalé au démarrage et jamais écrasé.
- Les erreurs d'enregistrement d'un pointage n'étaient pas affichées.

## [0.4.0] - 2026-10-02

### Ajouté

- **Barre de menus** Fichier, Édition, Affichage, Aide, avec les raccourcis clavier.
- Clic droit sur un onglet ou un fichier de la liste : ouvrir, fermer, fermer les autres,
  fermer les documents en erreur, copier le nom ou le chemin.
- **Suivi de vérification** : statut manuel À vérifier / Vérifiée / Anomalie, commentaires par
  facture et par ligne, enregistrés localement par empreinte du XML ; pointage de toutes les
  lignes en une commande. Le statut apparaît dans le tableau, avec son filtre et son export.
- **Vue « PDF et données »** côte à côte, défilements séparés repris entre sessions.
- **Rapport de contrôle JSON** : synthèse, contrôles du moteur et suivi de vérification.
- Le tableau des factures est rouvert à la reprise de session s'il était affiché.

### Modifié

- **Libellés français accentués** dans tout le moteur : Désignation, Quantité, Date d'émission,
  Date d'échéance, À payer, messages et notes de calcul.
- Modes de paiement traduits selon UNCL 4461 : virement SEPA (58), prélèvement SEPA (59),
  carte (48), paiement en ligne (68), prélèvement (49), codes 42 et 45. Les codes et chemins XML
  sont conservés.
- Les onglets **Accueil** et **Tableau** restent fixes à gauche quand les onglets de
  documents défilent ; l'onglet sélectionné n'est plus masqué derrière eux.

## [0.3.0] - 2026-10-02

### Ajouté

- **Tableau multi-factures** (onglet « Tableau ») : une ligne par document ouvert avec vendeur,
  numéro, type, dates, HT, TVA, TTC, à payer, devise et état des contrôles. Tri par colonne,
  filtre texte, totaux par devise avec avoirs déduits, clic pour ouvrir la facture.
- Filtres d'anomalies : écart de calcul, alerte, échéance dépassée, sans TVA, émise un
  week-end, doublon, avoirs, documents non lus.
- Export CSV et copie du tableau affiché, avec le détail des contrôles en écart ou en alerte.
- **Menu contextuel** (clic droit) sur les cellules de tous les tableaux : copier la cellule,
  la ligne (avec ou sans en-têtes), la colonne ou le tableau ; copie en CSV, JSON ou Markdown ;
  copier le chemin XML, voir dans le XML, rechercher la valeur.

### Corrigé

- Session : l'état est enregistré à la fin d'une reprise ; un document ajouté pendant la
  reprise n'était pas conservé. Le scénario navigateur correspondant échouait sous Chromium.

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
