# Provenance des valeurs

Chantier de la 0.8.0, présent dans `main` après la préversion 0.7.1.

Dans **Données**, les cartes Date d’émission, Échéance, Total HT, Total TVA, Total TTC et À payer proposent **Voir la provenance** lorsque le moteur dispose d’un chemin source. Chaque carte indique la valeur et le champ XML qui l’a fournie ; **Voir dans le XML** ouvre l’occurrence. Pour les montants, la valeur citée est le texte numérique du XML, avant normalisation de son affichage. Les dates sont des valeurs extraites et peuvent être reformattées (par exemple une date CII `20261004` affichée `2026-10-04`) : le lien XML montre la forme source.

La synthèse des montants n’invente pas les totaux absents. Le HT utilise le montant HT déclaré, ou le total des lignes déclaré si le HT manque. La TVA utilise son total déclaré ; à défaut, elle est calculée seulement si chaque ventilation par taux a un montant de TVA. Dans ce cas, la carte donne la somme, chaque montant utilisé et son chemin. Si une donnée nécessaire manque, aucune provenance de résultat n’est fabriquée.

Pour les contrôles de total HT, TTC et net à payer, la carte affiche aussi la formule, la valeur attendue et les données utilisées. Les remises, frais, acomptes et arrondis absents sont explicitement indiqués comme comptés pour zéro, conformément au contrôle actuel. La valeur attendue reste distincte de la valeur déclarée dans le XML : une divergence demeure une anomalie, jamais une correction silencieuse.

Une anomalie de calcul sur ces totaux propose **Voir la provenance des montants** et ouvre la carte correspondante.

Le détail de chaque ligne présente aussi **Calcul et provenance de la ligne**. Il donne la quantité, le prix unitaire déclaré, la quantité de base (ou sa valeur implicite de 1), chaque frais ou remise, le total de ligne déclaré et, s’ils existent, le taux et le montant de TVA déclarés. Chaque valeur lue peut ouvrir son champ XML. Lorsque quantité, prix, quantité de base et total sont exploitables, il montre le produit arrondi au centime, le résultat avec frais/remises, la valeur attendue retenue par le contrôle et sa tolérance. Les deux conventions d’émetteur, avec ou sans ajustements de ligne dans le total, restent acceptées dans cette tolérance. Un montant manquant ou une quantité de base nulle est signalé sans produire de calcul fictif.

Une anomalie portant sur une ligne précise contient la même provenance, rattachée par l’index de la ligne dans le document plutôt que par son numéro affiché, qui peut être absent ou répété. Les anomalies de TVA par taux conservent leur lien vers le contrôle et le XML ; leur formule n’a pas encore de panneau de provenance dédié. La provenance ne prouve ni le paiement, ni la conformité de la facture : elle permet de vérifier l’origine des valeurs et le raisonnement des contrôles.
