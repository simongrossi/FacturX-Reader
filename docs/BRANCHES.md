# Branches — intégration du 4 octobre 2026

Tous les travaux de développement présents sur les branches ont été intégrés dans `main`.
Le dépôt local suit désormais cette branche. La documentation comparative ajoutée séparément
sur `main` (`b82f6be`) est conservée, ainsi que les nouveaux résultats de validation.

| Ancienne branche | État vérifié | Traitement |
|---|---|---|
| `codex/release-0.7.1` | Préparation de la version et essai macOS, CI verte | PR #1 fusionnée dans `main` (`f711d08`), branche supprimée |
| `codex/validator-reference-comparison` | Comparaisons, correctifs XSD et documentation ; tests navigateur, Rust/natifs Windows et références verts | PR #2 fusionnée dans `main` (`8fdf3ff`), branche supprimée |
| `codex/chantier-local` | Le commit `2adf01a` est déjà un ancêtre de `main` | Branche supprimée, repère `archive/chantier-local-2026-10-04` conservé |
| `sauvegarde/avant-regroupement` | Son arbre au commit `36f4036` est exactement identique à celui de `f522bc7`, déjà intégré dans `main` ; aucun fichier ne diffère | Branche supprimée, repère `archive/avant-regroupement-2026-10-04` conservé |

L’historique différent de la branche de sauvegarde provient du regroupement de ses quatre
commits en un seul commit sur `main`. Ses commits ne sont donc pas tous des ancêtres de `main`,
mais leur contenu complet y est présent. La comparaison des arbres est vide :

```bash
git diff archive/avant-regroupement-2026-10-04 f522bc7
```

Les repères d’archive sont des tags Git annotés, poussés sur GitHub ; ce sont des sauvegardes,
pas des développements restant à terminer. Pour consulter une archive, utiliser par exemple
`git show archive/avant-regroupement-2026-10-04`. Si une reprise devient nécessaire, créer une
nouvelle branche depuis le tag, sans déplacer celui-ci.

## Pour les prochains chantiers

Partir d’un `main` à jour, créer une branche `codex/<chantier>`, pousser une PR, puis attendre
les vérifications pertinentes. Après fusion, revenir sur `main`, synchroniser le dépôt local
et supprimer la branche de travail. Les tags de version et d’archive conservent les états
utiles sans multiplier les branches actives.

L’intégration des branches ne publie pas automatiquement de version de l’application.
Les notes de changements non publiés et les prérequis de livraison restent dans
[CHANGELOG.md](../CHANGELOG.md) et [ROADMAP.md](../ROADMAP.md).
