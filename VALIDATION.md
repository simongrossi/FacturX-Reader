# Validation P0 — 2 octobre 2026

Validation locale sous Windows, avec Rust 1.98, Node 26.7, Edge/WebView2 et Playwright 1.58.2.
Les commandes reproductibles sont dans README.md ; les scripts sont dans package.json.

## Vérifications réalisées

| Vérification | Résultat / portée |
|---|---|
| `npm run check:js` | Syntaxe des trois scripts de l'interface vérifiée |
| `npm run test:rust` | 9 tests unitaires réussis, dont parcours réel de 505 fichiers limité à 500 |
| Test Rust `samples.rs` | Factures locales analysées avec succès ; données réelles hors dépôt |
| `npm run test:ui` avec Edge | 5 scénarios réussis, commandes Tauri simulées et PDF.js réel |
| `npm run test:native` | Réussi sur les exécutable debug et release Windows, vraies commandes Rust, profil WebView2 jetable |
| `npm run build` | Exécutable Windows et paquets MSI/NSIS construits localement |

Le test natif ouvre une facture synthétique de deux pages, change le zoom à 150 %, défile,
attend la sauvegarde automatique puis ferme la fenêtre du processus de test et relance
l'application. Il vérifie la position, le zoom, la recherche, puis l'import d'une copie locale.
Après une autre fermeture et suppression du fichier d'origine connu par chemin, il vérifie
que le document manquant est signalé et que la copie déposée reste consultable. Il n'écrit
pas de pointage. Le profil temporaire et son port de débogage sont propres au test.

Les scénarios navigateur couvrent également l'accueil, les onglets et les récents, les deux
portées de recherche, le nettoyage préservant la session, le plafond de cache, les erreurs
de stockage, une session invalide et l'import/restauration de 500 documents. Les pannes de
quota sont simulées ; la restauration du PDF emploie un vrai fichier PDF synthétique.

## Corrections issues de P0

- Capturer la position avant de changer de vue, préserver les positions pendant la reprise.
- Attendre la fin du rendu multipage avant de restaurer le défilement ; mémoriser le zoom.
- Regrouper les rafraîchissements de l'interface et le nettoyage pendant les imports volumineux.
- Limiter les documents ouverts à 500 et les copies locales à 256 Mo ; signaler les copies
  non enregistrées sans interrompre la lecture courante.
- Nettoyer les copies sans référence dans la session ou les récents, proposer un effacement
  de l'historique conservant les copies utiles à la session.
- Signaler un stockage indisponible ou des métadonnées illisibles.
- Ajouter dépendance Playwright verrouillée, configuration, scripts npm et workflow CI.

## Vérifications restantes hors de cette machine

- Tests natifs macOS et Linux.
- Installation et désinstallation des MSI/NSIS produits ; le test natif lance directement
  l'exécutable. Les builds ne sont pas signés.
- Première exécution distante du workflow `checks.yml` après push.

Les fixtures synthétiques testent la lecture et le rendu ; elles ne constituent pas des
preuves de conformité PDF/A ou EN 16931. La validation normative reste au planning P3.

## Premier chantier P1 — libellés français

Les colonnes, dates, synthèses, unités, notes de calcul et messages sont accentués.
Les comparaisons des titres utilisées pour retrouver la date d'émission, l'échéance et
le montant à payer ont été adaptées, avec conservation des balises, codes et chemins XML.
Les traductions des modes de paiement ont été corrigées selon
[UNCL4461, OpenPeppol](https://docs.peppol.eu/poacc/billing/3.0/codelist/UNCL4461/).

Vérification : 10 tests unitaires Rust réussis, dont lecture des paiements UBL et CII
(codes 20, 42, 45, 48, 49, 58, 59 et 68) et conservation d'un code inconnu ; analyse des
factures locales réussie ; syntaxe JavaScript et cinq scénarios navigateur Edge réussis.
L'exécutable Windows release et les paquets MSI/NSIS ont été reconstruits. Le test natif
sur ce binaire confirme également le badge de date et la date d'émission dans la vue Données.
Les limites de validation macOS/Linux et d'installation mentionnées ci-dessus restent applicables.

## Premier lot P2 — lots de factures et suivi manuel

Validation du 2 octobre 2026 : syntaxe des quatre scripts d'interface vérifiée et huit
scénarios Playwright/Edge réussis. Les trois nouveaux scénarios couvrent :

- Tableau, filtres partagés avec la liste, recherche dans les lignes, masquage sans XML,
  reprise du tableau et statut enregistré ; totaux EUR/USD, addition exacte 0,1 + 0,2,
  avoir déjà négatif, montants absents et exclusion des sous-totaux de TVA UBL.
- Commentaires facture/ligne, statut Anomalie, pointage des 35 lignes du lot simulé,
  double lecture et reprise des défilements indépendants après rechargement.
- Suivi local illisible et quota d'écriture refusé, avertissements visibles et lecture
  toujours disponible ; commentaire non enregistré conservé pendant la session.

`npm run build` a produit l'exécutable release et les deux paquets MSI/NSIS.
`npm run test:native` sur cet exécutable est réussi : vraies commandes Rust et WebView2,
tableau CII avec HT 100,00 EUR / TVA 20,00 EUR / TTC 120,00 EUR, double lecture,
statut Vérifiée et commentaire repris après fermeture/relaunch, y compris dans une copie
du même XML déposée et conservée en IndexedDB. Le test natif conserve les assertions
précédentes de zoom, position, recherche et fichier manquant. Il n'écrit pas de pointage.

Les tests navigateur simulent le backend Tauri pour les lots UBL et le pointage complet ;
le test natif emploie une facture CII synthétique sans lignes. Les fixtures ne constituent
pas une validation normative ; les contrôles comptables locaux ont été ajoutés dans le lot suivant.
Les limites précédentes concernant l'installation et macOS/Linux restent applicables.

## Deuxième lot P2 — contrôles de cohérence et rapport JSON

Validation du 2 octobre 2026 : syntaxe des cinq scripts de l'interface vérifiée,
12 tests de calcul (`npm run test:checks`), 9 scénarios navigateur Edge et 10 tests unitaires
Rust réussis, ainsi que l'analyse des factures locales. La CI exécute désormais les tests
de calcul en plus des vérifications existantes.

Les tests de calcul couvrent UBL/CII, frais/remises globaux et de ligne, quantité de base,
unités incompatibles, plusieurs taux de TVA, base TVA incohérente, acompte et arrondi,
avoir positif/négatif, absence de lignes/ventilation, devises distinctes, taxe hors VAT,
catégorie ambiguë, division par zéro et valeurs non interprétables. Ils vérifient l'addition
exacte 0,1 + 0,2, la division 1/3, l'arrondi ±0,005, la tolérance de ligne de 0,02 et un
écart de 0,001 qui doit rester visible dans le rapport.

Le nouveau scénario navigateur vérifie l'affichage d'un TTC incohérent, les montants
attendu/constaté/écart, le chemin XML cliquable avec surlignage, l'alerte d'échéance passée
indépendante du paiement et le contenu du rapport JSON envoyé à la commande native.
Une écriture refusée est simulée : erreur visible et bouton d'export réactivé. Le panneau
des contrôles a été inspecté visuellement sur capture d'écran.

La compilation release Windows et les paquets MSI/NSIS sont réussis. Le test natif sur
ce nouvel exécutable est réussi : vraie facture CII synthétique extraite du PDF, contrôle
TTC 100 + 20 = 120 conforme et absence de lignes non vérifiable, avec conservation des
assertions précédentes de session, recherche, zoom, double lecture et suivi manuel.

La boîte native Enregistrer sous et l'écriture du rapport sont implémentées en Rust ;
le dialogue et l'enregistrement sur disque n'ont pas été automatisés dans le test natif.
Les tests navigateur simulent cette commande et vérifient son contenu et ses erreurs.
Le diagnostic emploie une politique locale d'arrondi et de tolérance explicitement affichée ;
il ne constitue pas une validation normative. Les catégories sans taux et certaines
variantes CII anciennes peuvent rester non vérifiables. Les limites précédentes relatives
aux installateurs et aux plateformes macOS/Linux restent applicables.
