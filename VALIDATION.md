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
| `npm run test:native` | Vrai exécutable Windows et vraies commandes Rust, profil WebView2 jetable |
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
