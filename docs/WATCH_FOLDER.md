# Dossier surveillé

Fonction disponible à partir de la 0.8.0.

Dans **Paramètres → Dossier surveillé**, choisissez explicitement un dossier. La surveillance ne fonctionne que pendant que l’application est ouverte ; elle n’installe aucun service système et ne crée aucune association de fichiers. Le choix initial prend un relevé des `.pdf`, `.xml` et `.zip` déjà présents, y compris dans les sous-dossiers non cachés, et ne les importe pas. Pour importer ces fichiers existants, utilisez **Ouvrir un dossier**. Les liens symboliques sont ignorés pour éviter les cycles.

L’application relit le dossier toutes les quatre secondes. Un nouveau fichier ou un fichier modifié doit apparaître avec la même taille et la même date de modification sur deux relevés consécutifs avant d’être importé. Les chemins déjà ouverts dans la session ne sont pas ouverts une seconde fois. Après une tentative d’import, le chemin et son empreinte légère (taille et date de modification) sont mémorisés localement ; un fichier modifié peut être réexaminé s’il n’est plus ouvert dans la session. Les nouveautés apparues pendant la fermeture de l’application sont examinées au prochain lancement si la surveillance était active.

La progression est affichée dans les paramètres. **Annuler l’import** termine le fichier en cours, interrompt les suivants et met la surveillance en pause ; **Reprendre** la relance. Une erreur sur une facture est visible dans sa fiche et n’arrête pas les suivantes. Une archive ambiguë conserve la demande de choix explicite du XML et du PDF. La session reste limitée à 500 documents ; au-delà, la surveillance se met en pause. Un dossier contenant plus de 500 fichiers candidats doit être divisé en sous-dossiers pour être surveillé complètement.

Le relevé de taille et de date réduit le risque de lire un fichier encore copié mais ne garantit pas qu’il soit complet : une copie peut rester momentanément inchangée. Si l’import échoue, corrigez ou remplacez le fichier pour changer son empreinte, puis reprenez la surveillance. Aucun fichier original n’est déplacé, modifié ou envoyé sur le réseau.
