# 🍬 Sweet Match — L'Aventure Sucrée

Jeu de réflexion **Match-3** complet, 100 % original, développé en **HTML5 + CSS3 + JavaScript Vanilla (Modules ES)** sans aucune dépendance ni outil de build.

## ✨ Fonctionnalités
- **Moteur pur (`js/engine.js`)** : Zéro DOM, générateur pseudo-aléatoire à graine (déterministe et reproductible), piloté par une file d'événements ordonnée.
- **100 Niveaux (`js/levels.js`)** : Répartis en 10 chapitres sur une carte sinueuse SVG avec introduction progressive des obstacles et tutoriels contextuels.
- **Bonbons Spéciaux & Combinaisons (`js/specials.js`)** : Rayés (H/V), Emballés (double explosion 3×3), Bombes Couleur, Nova Sucrée (6+), et toutes les combinaisons (Rayé+Rayé, Rayé+Emballé, Emballé+Emballé, Bombe+Normal/Rayé/Emballé/Nova/Bombe).
- **Obstacles variés** : Gelée (1–2 couches), Glace (1–3 couches), Blocs de Réglisse, Chocolat proliférant, Bonbons enchaînés, Ingrédients (cerises/noisettes), Portails téléporteurs, Bombes à retardement.
- **Audio & Juice (`js/audio.js`, `js/renderer.js`)** : Sons WebAudio 100 % synthétisés, particules, ondes de choc, lasers, squash & stretch, mode daltonien (formes + symboles), navigation clavier et PWA jouable hors-ligne.

## 🚀 Lancer en local
```bash
# Exécuter la suite de 26 tests unitaires (Node.js)
npm test

# Servir le jeu localement
npx serve .
```
