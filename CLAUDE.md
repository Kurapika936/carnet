# Word Up — consignes pour Claude

Application perso d'apprentissage de l'anglais (traduction FR⇄EN, carnet de mots, révision en
liste et en flashcards), installée sur l'iPhone et le PC du propriétaire. Toujours répondre en français.

## Fichiers
- `index.html` : toute l'app (HTML, CSS, JS dans un seul fichier).
- `sw.js` : cache hors ligne. `const VERSION = "carnet-vN"` = **numéro de version de l'app**.
- `manifest.webmanifest`, `wordup-*.png` : nom et icônes de l'app installée.
- `relais/worker.js` : copie du code du relais Cloudflare (Worker `carnet-deepl`).
  Le relais réel est sur Cloudflare : Claude ne peut pas le déployer, le propriétaire recolle le code.
- `HISTORIQUE.md` : ce que chaque version a apporté.
- Hébergement : GitHub Pages, branche `main`, https://kurapika936.github.io/carnet/

## Publier une nouvelle version
1. Modifier, puis tester dans un navigateur headless (Playwright) avant de pousser.
2. Incrémenter `VERSION` dans `sw.js` : prendre **le plus grand numéro existant + 1**
   (`git tag --sort=-version:refname | head -1`). Sans ça, l'app installée ne se met pas à jour.
3. Commit avec un message en français, puis tag `vN` sur ce commit, puis
   `git push origin HEAD:main && git push origin vN`.
4. Ajouter une ligne dans `HISTORIQUE.md`.

## Règle « Rollback N »
Quand le propriétaire écrit **« Rollback N »** (ex. « Rollback 30 »), revenir à la version N, sans redemander :
1. `git fetch --tags origin` puis vérifier que le tag `vN` existe. S'il n'existe pas, lister les
   versions disponibles (`git tag --sort=version:refname`) et proposer la plus proche.
2. Restaurer les fichiers de l'app tels qu'en vN : `git checkout vN -- index.html sw.js manifest.webmanifest`
   ainsi que les icônes présentes dans vN. Supprimer les fichiers d'app qui n'existaient pas en vN
   (sauf `CLAUDE.md`, `HISTORIQUE.md`, `relais/`, `README.md`, qui restent à jour).
3. Mettre `VERSION` à **(plus grand numéro existant + 1)**, jamais N lui-même (sinon le cache
   de l'iPhone ne se rafraîchit pas). Le contenu est celui de vN, seul le numéro change.
4. Commit « Rollback vers la version N », tag du nouveau numéro, push du commit et du tag.
5. Dire au propriétaire ce qu'il perd par rapport à la version d'avant, notamment :
   - avant v28 : plus de synchronisation entre appareils ;
   - avant v29 : plus de traduction par Claude (exemples, notes, variantes) ;
   - avant v10 : ancienne organisation des onglets.
   Ses mots ne sont jamais touchés : ils sont dans le téléphone et dans la base Cloudflare, pas dans le code.
6. Un rollback se défait par un autre rollback (« Rollback 31 » pour revenir à la version d'avant).

Le relais Cloudflare actuel reste compatible avec toutes les versions de l'app : un rollback de l'app
ne demande normalement pas de changer le relais.
