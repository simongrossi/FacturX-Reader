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
La préversion [0.7.1](https://github.com/simongrossi/FacturX-Reader/releases/tag/v0.7.1) a été publiée depuis le tag `v0.7.1` (`a9b2641`).
Les notes de changements non publiés et les prérequis de livraison restent dans
[CHANGELOG.md](../CHANGELOG.md) et [ROADMAP.md](../ROADMAP.md).

## Chantier exports et suite

La PR #3 (exports Excel/PDF) est fusionnée dans `main` par `e35e7cc`. Les trois jobs
`browser`, `rust` et `reference` étaient verts sur son commit de développement `8fef64f`.
La CI complète de `main` sur `e35e7cc` est également verte
([Checks](https://github.com/simongrossi/FacturX-Reader/actions/runs/37192860140)).
Le changement de licence de `main` (`456b054`) et la documentation complémentaire ont été
conservés avant fusion. La branche `codex/excel-control-pdf` a été supprimée.

Le centre d’anomalies a ensuite été fusionné dans `main` par la PR #4 (`a97ba1d`), puis la
revue d’un lot par la PR #5 (`7e33cfa`). Les branches `codex/anomaly-center` et
`codex/batch-review-report` ont été supprimées. Les contrôles navigateur, Rust/natif Windows et
références de la PR #5 étaient verts avant fusion. Aucun développement des anciennes branches
ne reste en attente d’intégration. [Exports](EXPORTS.md), [centre d’anomalies](ANOMALIES.md),
[revue d’un lot](BATCH_REVIEW.md).

L’échéancier a été fusionné ensuite dans `main` par la
[PR #6](https://github.com/simongrossi/FacturX-Reader/pull/6) (`b129daf`) ; la branche
`codex/payment-schedule` a été supprimée. Ce développement est destiné à la 0.8.0 et n’est
pas présent dans les installateurs 0.7.1. [Calcul et limites](SCHEDULE.md).

La provenance des valeurs a été fusionnée dans `main` par la
[PR #7](https://github.com/simongrossi/FacturX-Reader/pull/7) (`d603926`) après validation
des jobs navigateur, références et Rust/natif Windows. La branche `codex/value-provenance`
a été supprimée. Ce chantier rejoint la 0.8.0 en préparation et n’est pas dans la 0.7.1.
[Fonctionnement et limites](PROVENANCE.md).
