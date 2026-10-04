# Provenance des valeurs

Chantier de la 0.8.0, présent dans `main` après la préversion 0.7.1.

Dans **Données**, les cartes Date d’émission, Échéance, Total HT, Total TVA, Total TTC et À payer proposent **Voir la provenance** lorsque le moteur dispose d’un chemin source. Chaque carte indique la valeur et le champ XML qui l’a fournie ; **Voir dans le XML** ouvre l’occurrence. Pour les montants, la valeur citée est le texte numérique du XML, avant normalisation de son affichage. Les dates sont des valeurs extraites et peuvent être reformattées (par exemple une date CII `20261004` affichée `2026-10-04`) : le lien XML montre la forme source.

La synthèse des montants n’invente pas les totaux absents. Le HT utilise le montant HT déclaré, ou le total des lignes déclaré si le HT manque. La TVA utilise son total déclaré ; à défaut, elle est calculée seulement si chaque ventilation par taux a un montant de TVA. Dans ce cas, la carte donne la somme, chaque montant utilisé et son chemin. Si une donnée nécessaire manque, aucune provenance de résultat n’est fabriquée.

Pour les contrôles de total HT, TTC et net à payer, la carte affiche aussi la formule, la valeur attendue et les données utilisées. Les remises, frais, acomptes et arrondis absents sont explicitement indiqués comme comptés pour zéro, conformément au contrôle actuel. La valeur attendue reste distincte de la valeur déclarée dans le XML : une divergence demeure une anomalie, jamais une correction silencieuse.

Une anomalie de calcul sur ces totaux propose **Voir la provenance des montants** et ouvre la carte correspondante. Les anomalies de ligne ou de TVA par taux conservent leur lien direct vers le contrôle et le champ XML ; ce premier chantier ne détaille pas encore toutes leurs formules dans une carte dédiée. La provenance ne prouve ni le paiement, ni la conformité de la facture : elle permet de vérifier l’origine des valeurs et le raisonnement des contrôles.
