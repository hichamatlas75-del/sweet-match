/**
 * @file levels.js
 * @description Données JSON des 100 niveaux de "Sweet Match" (aucune logique métier).
 * Progression par chapitres de 10 niveaux avec introduction progressive des mécaniques
 * et tutoriels contextuels en français.
 */

export const CHAPTERS = [
  { id: 1, name: 'Prairie de la Barbe à Papa', range: [1, 10], color: '#ff5ea8' },
  { id: 2, name: 'Lagune de la Gelée Rose', range: [11, 20], color: '#b84dff' },
  { id: 3, name: 'Pics du Sorbet Glacé', range: [21, 30], color: '#24c8ff' },
  { id: 4, name: 'Forêt des Torsades Réglisse', range: [31, 40], color: '#39d98a' },
  { id: 5, name: 'Verger des Cerises Dorées', range: [41, 50], color: '#ff9f1c' },
  { id: 6, name: 'Usine du Chocolat Fondant', range: [51, 60], color: '#a855f7' },
  { id: 7, name: 'Citadelle du Caramel Scellé', range: [61, 70], color: '#f43f5e' },
  { id: 8, name: 'Observatoire des Portails', range: [71, 80], color: '#06b6d4' },
  { id: 9, name: 'Horlogerie Pétillante', range: [81, 90], color: '#eab308' },
  { id: 10, name: 'Palais Royal Céleste', range: [91, 100], color: '#ec4899' }
];

export const TUTORIALS = {
  1: {
    title: 'Bienvenue dans Sweet Match !',
    icon: '🍬',
    text: 'Échange deux bonbons adjacents pour aligner au moins 3 bonbons de la même couleur et de la même forme. Aligne 4 ou 5 bonbons pour créer de puissants bonbons spéciaux !'
  },
  11: {
    title: 'Nouvel objectif : La Gelée !',
    icon: '🍮',
    text: 'Certaines cases sont recouvertes de gelée sucrée translucide. Fais éclater des bonbons par-dessus pour nettoyer toute la gelée du plateau !'
  },
  21: {
    title: 'Attention au Givre !',
    icon: '🧊',
    text: 'Les glaçons givrés (1 à 3 couches) enferment les bonbons ! Éclate les bonbons ou utilise des rayons spéciaux pour briser la glace.'
  },
  31: {
    title: 'Blocs de Réglisse !',
    icon: '🌀',
    text: 'Les tourbillons de réglisse bloquent la chute des bonbons. Fais un match juste à côté d’eux (ou frappe-les avec un bonbon spécial) pour les détruire !'
  },
  41: {
    title: 'Livraison d’Ingrédients !',
    icon: '🍒',
    text: 'Les cerises et noisettes dorées ne peuvent pas être associées : élimine les bonbons situés en dessous d’elles pour les faire descendre jusqu’aux flèches de sortie tout en bas !'
  },
  51: {
    title: 'Alerte au Chocolat Fondant !',
    icon: '🍫',
    text: 'Le chocolat se propage d’une case à chaque tour si tu n’en détruis aucun ! Fais des matchs adjacents chaque tour pour l’endiguer et tout nettoyer.'
  },
  61: {
    title: 'Bonbons Enchaînés !',
    icon: '⛓️',
    text: 'Ces bonbons sont retenus par un ruban de sucre : ils ne peuvent ni bouger ni tomber. Inclus-les dans un match de leur couleur pour briser leurs chaînes !'
  },
  71: {
    title: 'Portails Dimensionnels !',
    icon: '🌀',
    text: 'Les portails violets et turquoise téléportent instantanément les bonbons qui tombent d’une zone du plateau vers une autre !'
  },
  81: {
    title: 'Bombes Pétillantes !',
    icon: '💣',
    text: 'Ces bonbons affichent un compte à rebours en coups ! Élimine-les avant que leur compteur n’atteigne zéro, sinon la partie est perdue !'
  },
  91: {
    title: 'Le Palais Royal Céleste !',
    icon: '👑',
    text: 'Les 10 derniers niveaux combinent tous les obstacles du royaume ! Combine tes bonbons spéciaux (Bombe + Rayé, Emballé + Emballé) pour triompher !'
  }
};

// Formes de grilles réutilisables (1 = actif, 0 = trou)
const GRID_FULL_9 = [
  [1,1,1,1,1,1,1,1,1],
  [1,1,1,1,1,1,1,1,1],
  [1,1,1,1,1,1,1,1,1],
  [1,1,1,1,1,1,1,1,1],
  [1,1,1,1,1,1,1,1,1],
  [1,1,1,1,1,1,1,1,1],
  [1,1,1,1,1,1,1,1,1],
  [1,1,1,1,1,1,1,1,1],
  [1,1,1,1,1,1,1,1,1]
];

const GRID_DIAMOND_9 = [
  [0,0,1,1,1,1,1,0,0],
  [0,1,1,1,1,1,1,1,0],
  [1,1,1,1,1,1,1,1,1],
  [1,1,1,1,1,1,1,1,1],
  [1,1,1,1,1,1,1,1,1],
  [1,1,1,1,1,1,1,1,1],
  [1,1,1,1,1,1,1,1,1],
  [0,1,1,1,1,1,1,1,0],
  [0,0,1,1,1,1,1,0,0]
];

const GRID_DONUT_9 = [
  [1,1,1,1,1,1,1,1,1],
  [1,1,1,1,1,1,1,1,1],
  [1,1,1,1,1,1,1,1,1],
  [1,1,1,0,0,0,1,1,1],
  [1,1,1,0,0,0,1,1,1],
  [1,1,1,0,0,0,1,1,1],
  [1,1,1,1,1,1,1,1,1],
  [1,1,1,1,1,1,1,1,1],
  [1,1,1,1,1,1,1,1,1]
];

const GRID_HOURGLASS_9 = [
  [1,1,1,1,1,1,1,1,1],
  [1,1,1,1,1,1,1,1,1],
  [0,1,1,1,1,1,1,1,0],
  [0,0,1,1,1,1,1,0,0],
  [0,0,1,1,1,1,1,0,0],
  [0,0,1,1,1,1,1,0,0],
  [0,1,1,1,1,1,1,1,0],
  [1,1,1,1,1,1,1,1,1],
  [1,1,1,1,1,1,1,1,1]
];

const GRID_BRIDGES_9 = [
  [1,1,1,0,1,0,1,1,1],
  [1,1,1,1,1,1,1,1,1],
  [1,1,1,1,1,1,1,1,1],
  [1,1,0,1,1,1,0,1,1],
  [1,1,0,1,1,1,0,1,1],
  [1,1,0,1,1,1,0,1,1],
  [1,1,1,1,1,1,1,1,1],
  [1,1,1,1,1,1,1,1,1],
  [1,1,1,0,1,0,1,1,1]
];

function cloneGrid(baseGrid) {
  return baseGrid.map(row => [...row]);
}

function buildLevelData(id) {
  const chapter = Math.ceil(id / 10);
  const posInChapter = ((id - 1) % 10) + 1;
  const tutorial = TUTORIALS[id] || null;

  // Choix du gabarit de grille selon le numéro de niveau
  let baseTemplate = GRID_FULL_9;
  if (posInChapter === 4 || posInChapter === 8) baseTemplate = GRID_DIAMOND_9;
  else if (posInChapter === 6) baseTemplate = GRID_DONUT_9;
  else if (posInChapter === 9) baseTemplate = GRID_HOURGLASS_9;
  else if (posInChapter === 10 && chapter >= 3) baseTemplate = GRID_BRIDGES_9;

  const layout = cloneGrid(baseTemplate);
  const presets = [];
  let portals = null;
  let timer = null;

  // Nombre de couleurs : 4 sur les tout premiers niveaux pour favoriser les cascades, puis 5 ou 6
  let numColors = 5;
  if (id <= 4) numColors = 4;
  else if (id % 3 === 0 || id >= 50) numColors = 6;

  // Nombre de coups de base
  let moves = 22 + (posInChapter % 3) * 3;
  const goals = [];

  // ==========================================================================
  // CHAPITRE 1 (1-10) : Score & Collecte de couleurs
  // ==========================================================================
  if (chapter === 1) {
    const targetScore = 1500 + id * 450;
    if (id <= 3) {
      goals.push({ type: 'score', target: targetScore });
    } else if (id % 2 === 0) {
      goals.push({ type: 'color', color: id % numColors, target: 18 + id * 2 });
    } else {
      goals.push({ type: 'color', color: 0, target: 15 + id });
      goals.push({ type: 'color', color: 2, target: 15 + id });
    }
    if (id === 10) {
      timer = 75; // Niveau 10 chronométré
      moves = 35;
    }
  }

  // ==========================================================================
  // CHAPITRE 2 (11-20) : Gelée (1 et 2 couches)
  // ==========================================================================
  else if (chapter === 2) {
    let jellyCount = 0;
    for (let r = 2; r <= 6; r++) {
      for (let c = 2; c <= 6; c++) {
        if (layout[r][c] === 1 && ((r + c + id) % 2 === 0 || posInChapter >= 7)) {
          const layers = (posInChapter >= 6 && r >= 3 && r <= 5 && c >= 3 && c <= 5) ? 2 : 1;
          layout[r][c] = layers === 2 ? 'J2' : 'J';
          jellyCount += layers;
        }
      }
    }
    goals.push({ type: 'jelly', target: jellyCount });
    moves = 24 + Math.floor(posInChapter / 2);
  }

  // ==========================================================================
  // CHAPITRE 3 (21-30) : Glace (1 à 3 couches) + Gelée ou Couleurs
  // ==========================================================================
  else if (chapter === 3) {
    let iceCount = 0;
    for (let r = 3; r <= 6; r++) {
      for (let c = 2; c <= 6; c++) {
        if (layout[r][c] === 1 && (r + c) % 2 === (id % 2)) {
          const iceLayers = posInChapter >= 8 ? 3 : (posInChapter >= 4 ? 2 : 1);
          layout[r][c] = `I${iceLayers}`;
          iceCount += iceLayers;
        }
      }
    }
    goals.push({ type: 'ice', target: iceCount });
    if (posInChapter >= 6) {
      goals.push({ type: 'color', color: 1, target: 25 });
    }
    moves = 26;
  }

  // ==========================================================================
  // CHAPITRE 4 (31-40) : Blocs de Réglisse + Glissement diagonal
  // ==========================================================================
  else if (chapter === 4) {
    let licCount = 0;
    for (let r = 2; r <= 6; r += 2) {
      for (let c = 1; c <= 7; c += 2) {
        if (layout[r][c] === 1) {
          layout[r][c] = 'L';
          licCount++;
        }
      }
    }
    goals.push({ type: 'licorice', target: licCount });
    if (posInChapter % 2 === 0) {
      goals.push({ type: 'score', target: 4500 + posInChapter * 400 });
    }
    moves = 25;
  }

  // ==========================================================================
  // CHAPITRE 5 (41-50) : Ingrédients (Cerises & Noisettes) à faire descendre
  // ==========================================================================
  else if (chapter === 5) {
    const ingTarget = Math.min(5, 2 + Math.floor(posInChapter / 3));
    goals.push({ type: 'ingredients', target: ingTarget });
    // Quelques obstacles en bas pour rendre la descente tactique
    for (let c = 2; c <= 6; c += 2) {
      if (layout[5][c] === 1) layout[5][c] = 'L';
    }
    moves = 26 + ingTarget * 2;
  }

  // ==========================================================================
  // CHAPITRE 6 (51-60) : Chocolat proliférant
  // ==========================================================================
  else if (chapter === 6) {
    let chocCount = 0;
    const coords = [
      { r: 4, c: 4 },
      { r: 3, c: 3 },
      { r: 3, c: 5 },
      { r: 5, c: 3 },
      { r: 5, c: 5 },
      { r: 4, c: 2 },
      { r: 4, c: 6 }
    ];
    const limit = Math.min(coords.length, 3 + Math.floor(posInChapter / 2));
    for (let i = 0; i < limit; i++) {
      const pt = coords[i];
      if (layout[pt.r][pt.c] === 1) {
        layout[pt.r][pt.c] = 'C';
        chocCount++;
      }
    }
    goals.push({ type: 'chocolate', target: chocCount });
    goals.push({ type: 'color', color: 0, target: 24 });
    moves = 26;
  }

  // ==========================================================================
  // CHAPITRE 7 (61-70) : Bonbons enchaînés (verrouillés) + Gelée
  // ==========================================================================
  else if (chapter === 7) {
    let lockCount = 0;
    let jellyCount = 0;
    for (let r = 2; r <= 6; r++) {
      for (let c = 2; c <= 6; c++) {
        if (layout[r][c] !== 1) continue;
        if (r === 4 || c === 4) {
          layout[r][c] = 'K';
          lockCount++;
        } else if ((r + c) % 2 === 0) {
          layout[r][c] = 'J';
          jellyCount++;
        }
      }
    }
    goals.push({ type: 'locked', target: lockCount });
    if (jellyCount > 0) goals.push({ type: 'jelly', target: jellyCount });
    moves = 28;
  }

  // ==========================================================================
  // CHAPITRE 8 (71-80) : Téléporteurs (Portails) + Ingrédients & Gelée
  // ==========================================================================
  else if (chapter === 8) {
    // Séparer le haut et le bas avec une rangée de trous en r=4 et relier par des portails !
    for (let c = 0; c < 9; c++) {
      layout[4][c] = 0;
    }
    portals = [];
    for (let c = 1; c <= 7; c++) {
      if (layout[3][c] !== 0 && layout[5][c] !== 0) {
        // Téléporteur croisé : le bas du haut (r=3, c) envoie vers le haut du bas (r=5, 8-c)
        portals.push({
          from: { r: 3, c },
          to: { r: 5, c: 8 - c }
        });
      }
    }
    if (posInChapter % 2 === 1) {
      goals.push({ type: 'ingredients', target: 3 });
    } else {
      let jCount = 0;
      for (let r = 6; r <= 7; r++) {
        for (let c = 2; c <= 6; c++) {
          if (layout[r][c] === 1) {
            layout[r][c] = 'J';
            jCount++;
          }
        }
      }
      goals.push({ type: 'jelly', target: jCount });
    }
    moves = 28;
  }

  // ==========================================================================
  // CHAPITRE 9 (81-90) : Bombes à retardement & Niveaux Chronométrés
  // ==========================================================================
  else if (chapter === 9) {
    const bombPositions = [
      { r: 3, c: 2 },
      { r: 3, c: 6 },
      { r: 5, c: 4 },
      { r: 6, c: 2 },
      { r: 6, c: 6 }
    ];
    const numBombs = Math.min(bombPositions.length, 2 + Math.floor(posInChapter / 3));
    const countdown = Math.max(9, 15 - Math.floor(posInChapter / 2));
    for (let i = 0; i < numBombs; i++) {
      const bp = bombPositions[i];
      if (layout[bp.r][bp.c] === 1) {
        layout[bp.r][bp.c] = `B${countdown}`;
      }
    }
    goals.push({ type: 'score', target: 6500 + posInChapter * 500 });
    goals.push({ type: 'color', color: 3, target: 30 });
    if (posInChapter === 5 || posInChapter === 10) {
      timer = 90;
    }
    moves = 26;
  }

  // ==========================================================================
  // CHAPITRE 10 (91-100) : Palais Royal (Combinaison de tous les obstacles)
  // ==========================================================================
  else {
    let jCount = 0;
    let iceCount = 0;
    for (let r = 2; r <= 6; r++) {
      for (let c = 2; c <= 6; c++) {
        if (layout[r][c] !== 1) continue;
        if (r === 4 && (c === 3 || c === 5)) {
          layout[r][c] = 'C';
        } else if ((r === 2 || r === 6) && c % 2 === 0) {
          layout[r][c] = 'I2';
          iceCount += 2;
        } else if ((r + c) % 2 === 0) {
          layout[r][c] = 'J2';
          jCount += 2;
        }
      }
    }
    if (jCount > 0) goals.push({ type: 'jelly', target: jCount });
    if (iceCount > 0) goals.push({ type: 'ice', target: iceCount });
    if (id === 100) {
      goals.push({ type: 'ingredients', target: 3 });
      // Cadeau de départ sur le niveau 100 : une Bombe Couleur au centre !
      presets.push({ r: 4, c: 4, special: 'color_bomb' });
      moves = 35;
    } else {
      moves = 30;
    }
  }

  const baseStar = 1500 + id * 220;
  const stars = [
    baseStar,
    Math.round(baseStar * 1.85),
    Math.round(baseStar * 2.9)
  ];

  return {
    id,
    chapter,
    name: `Niveau ${id}`,
    rows: 9,
    cols: 9,
    numColors,
    moves,
    timer,
    stars,
    goals,
    layout,
    presets,
    portals,
    tutorial
  };
}

export const LEVELS = Array.from({ length: 100 }, (_, idx) => buildLevelData(idx + 1));

export function getLevelById(id) {
  const num = Math.max(1, Math.min(100, Number(id) || 1));
  return LEVELS[num - 1];
}
