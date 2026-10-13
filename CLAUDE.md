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
2. Incrémenter `VERSION` dans `sw.js` : prendre **le plus grand numéro déjà publié + 1**
   (voir « Retrouver une version » ci-dessous). Sans ça, l'app installée ne se met pas à jour.
3. Commit avec un message en français, puis `git push origin HEAD:main`.
   (Les tags git ne passent pas par le proxy de la session : on ne s'en sert pas.)
4. Ajouter une ligne dans `HISTORIQUE.md` (même commit).

## Retrouver une version
Le numéro de chaque version est dans `sw.js` de chaque commit. Pour lister « commit → version » :
```sh
git fetch --depth=1000 origin main
for c in $(git rev-list --reverse origin/main); do
  v=$(git show $c:sw.js 2>/dev/null | grep -o 'carnet-v[0-9]*' | head -1)
  [ -n "$v" ] && echo "$c $v $(git log -1 --format=%s $c)"
done
```
Si plusieurs commits ont le même numéro (commits de doc sans changement d'app), prendre le **dernier**.

## Règle « Rollback N »
Quand le propriétaire écrit **« Rollback N »** (ex. « Rollback 30 »), revenir à la version N, sans redemander :
1. Trouver le commit de la version N avec la commande ci-dessus. Si N n'existe pas, lister les
   versions disponibles et proposer la plus proche.
2. Restaurer les fichiers de l'app tels qu'en vN : `git checkout <commit> -- index.html sw.js manifest.webmanifest`
   ainsi que les icônes présentes dans ce commit. Supprimer les fichiers d'app qui n'existaient pas en vN
   (sauf `CLAUDE.md`, `HISTORIQUE.md`, `relais/`, `README.md`, qui restent à jour).
3. Mettre `VERSION` à **(plus grand numéro existant + 1)**, jamais N lui-même (sinon le cache
   de l'iPhone ne se rafraîchit pas). Le contenu est celui de vN, seul le numéro change.
4. Tester rapidement (page chargée sans erreur), commit « Rollback vers la version N », push,
   et ajouter la ligne correspondante dans `HISTORIQUE.md`.
5. Dire au propriétaire ce qu'il perd par rapport à la version d'avant, notamment :
   - avant v28 : plus de synchronisation entre appareils ;
   - avant v29 : plus de traduction par Claude (exemples, notes, variantes) ;
   - avant v10 : ancienne organisation des onglets.
   Ses mots ne sont jamais touchés : ils sont dans le téléphone et dans la base Cloudflare, pas dans le code.
6. Un rollback se défait par un autre rollback (« Rollback 31 » pour revenir à la version d'avant).

Le relais Cloudflare actuel reste compatible avec toutes les versions de l'app : un rollback de l'app
ne demande normalement pas de changer le relais.
