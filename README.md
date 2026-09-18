# DM Surfaces — CODE1236 (démo one-page)

Site 100 % statique : `index.html`, `styles.css`, `main.js`, `frames/` (193 images WebP + fallback JPEG, < 12 Mo au total).

## Remplacer la vidéo et régénérer les images
1. Placez la nouvelle vidéo (`video.mp4`) à la racine, puis videz `frames/`.
2. `ffmpeg -i video.mp4 -vf "fps=24,scale=1280:-2,format=yuv420p" -c:v libwebp -quality 80 frames/f_%04d.webp`
3. `ffmpeg -i video.mp4 -vf "fps=24,scale=1280:-2,format=yuv420p" -q:v 16 frames/f_%04d.jpg` (fallback JPEG)
4. En tête de `main.js`, ajustez `FRAME_COUNT` (nombre d'images) et `SOLID_FRAME` (image « pièce face caméra », frontière rotation → métal liquide).

## Déployer sur Netlify
Glissez-déposez le dossier complet du projet sur https://app.netlify.com/drop — aucun build, aucune configuration.
Vérification locale : `python3 -m http.server 8000` puis http://localhost:8000.
