# Échéancier indicatif des factures ouvertes

Chantier du 4 octobre 2026, après la [revue d’un lot](BATCH_REVIEW.md). Fonctionnalité disponible à partir de la 0.8.0.

## Utilisation

Dans **Tableau**, le bloc **Échéancier des factures** présente le montant facturé par devise et les exceptions. **Voir les échéances et les factures** affiche les factures par date et devise, les doublons probables à arbitrer et les avoirs non affectés par fournisseur et devise. Les filtres **Situation** et **Devise** s’appliquent au détail et au CSV. Le filtre du tableau ne réduit pas l’échéancier.

## Calcul et limites

- Un même XML compte une fois, même s’il est ouvert dans plusieurs conteneurs. Les doublons probables signalés dans la session ou par la bibliothèque restent visibles à part et sont exclus des totaux d’échéance.
- Le total des factures utilise **À payer**. Les avoirs utilisent le **TTC** signé en négatif et ont leurs propres sous-totaux. Les devises restent séparées. Les montants absents restent indisponibles. Les sommes sont faites en centimes entiers après arrondi de chaque montant.
- Les dates sont comparées au jour local. Une date absente ou impossible est rangée dans **Sans échéance**. Le règlement reste inconnu, quelle que soit la date.
- Le CSV utilise UTF-8 avec BOM et le séparateur `;`. Il indique les pièces à arbitrer, les totaux d’échéance et les totaux d’avoirs séparément. Les montants restent indicatifs tant que les règlements et affectations ne sont pas confirmés par la comptabilité.

`web/schedule.js` contient le modèle, le rendu et l’export. Il ne change ni le XML, ni le moteur de validation, ni les statuts de suivi manuel. Le scénario navigateur dédié vérifie les échéances passée/du jour/future, deux devises, un avoir non affecté, une date invalide, un montant absent, un fichier illisible, l’indépendance du filtre du tableau, l’export CSV et la navigation. Voir [VALIDATION.md](../VALIDATION.md) pour les résultats.
