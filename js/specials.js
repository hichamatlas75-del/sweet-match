/**
 * @file specials.js
 * @description Définition et résolution des bonbons spéciaux et de leurs combinaisons pour Sweet Match.
 * Pur JavaScript (zéro DOM).
 */

export const SPECIAL_TYPES = {
  NONE: null,
  STRIPED_H: 'striped_h',   // Rayé horizontal : efface toute sa ligne
  STRIPED_V: 'striped_v',   // Rayé vertical : efface toute sa colonne
  WRAPPED: 'wrapped',       // Emballé : explose en 3x3, puis une 2e fois en 3x3
  COLOR_BOMB: 'color_bomb', // Bombe couleur : efface tous les bonbons d'une couleur
  NOVA: 'nova',             // Nova sucrée (Match de 6+) : explose en 5x5 + croix ligne/colonne
  INGREDIENT: 'ingredient'  // Ingrédient (cerise / noisette) à faire descendre
};

export const SPECIAL_SCORES = {
  CREATE: {
    [SPECIAL_TYPES.STRIPED_H]: 120,
    [SPECIAL_TYPES.STRIPED_V]: 120,
    [SPECIAL_TYPES.WRAPPED]: 200,
    [SPECIAL_TYPES.COLOR_BOMB]: 400,
    [SPECIAL_TYPES.NOVA]: 600
  },
  ACTIVATE: {
    [SPECIAL_TYPES.STRIPED_H]: 180,
    [SPECIAL_TYPES.STRIPED_V]: 180,
    [SPECIAL_TYPES.WRAPPED]: 300,
    [SPECIAL_TYPES.COLOR_BOMB]: 600,
    [SPECIAL_TYPES.NOVA]: 900,
    COMBO_BONUS: 500
  }
};

/**
 * Détermine quel bonbon spécial doit être créé à partir d'un groupe de match.
 * Règles :
 * - 6+ bonbons (ou ligne de 6+) -> NOVA ('nova')
 * - 5 bonbons alignés en ligne droite -> COLOR_BOMB ('color_bomb')
 * - Forme en L, T ou Croix (au moins une ligne H >= 3 ET une ligne V >= 3) -> WRAPPED ('wrapped')
 * - 4 bonbons alignés -> STRIPED_H ou STRIPED_V (si match horizontal -> rayé V ou H selon convention,
 *   ici le prompt dit : "efface une ligne ou une colonne selon le sens du match" -> H pour horizontal, V pour vertical)
 *
 * @param {Object} matchGroup - { positions: [{r, c}], color, hasHorizontal, hasVertical, maxLineLength, orientation }
 * @returns {string|null} Type de spécial ou null
 */
export function determineSpecialToCreate(matchGroup) {
  const count = matchGroup.positions.length;
  if (count < 4) return SPECIAL_TYPES.NONE;

  if (matchGroup.maxLineLength >= 6 || count >= 6 && (!matchGroup.hasHorizontal || !matchGroup.hasVertical)) {
    return SPECIAL_TYPES.NOVA;
  }
  if (matchGroup.maxLineLength === 5) {
    return SPECIAL_TYPES.COLOR_BOMB;
  }
  if (matchGroup.hasHorizontal && matchGroup.hasVertical) {
    // Si 6+ au total en L/T très grand (ex: 4+3=6), on peut aussi créer NOVA si count >= 7, mais L/T standard (5 ou 6 cases) = WRAPPED
    if (count >= 7) return SPECIAL_TYPES.NOVA;
    return SPECIAL_TYPES.WRAPPED;
  }
  if (count === 4 || matchGroup.maxLineLength === 4) {
    return matchGroup.orientation === 'H' ? SPECIAL_TYPES.STRIPED_H : SPECIAL_TYPES.STRIPED_V;
  }
  return SPECIAL_TYPES.NONE;
}

/**
 * Vérifie si deux bonbons échangés forment une combinaison de spéciaux.
 * Note : Bombe Couleur + bonbon normal est aussi géré comme une interaction spéciale !
 * Note : Les ingrédients ne sont pas des bonbons spéciaux combinables.
 */
export function isSpecialCombination(candyA, candyB) {
  if (!candyA || !candyB) return false;
  if (candyA.locked > 0 || candyB.locked > 0) return false;
  if (candyA.special === SPECIAL_TYPES.INGREDIENT || candyB.special === SPECIAL_TYPES.INGREDIENT) return false;

  const spA = candyA.special;
  const spB = candyB.special;

  // Bombe couleur + n'importe quel bonbon (normal ou spécial)
  if (spA === SPECIAL_TYPES.COLOR_BOMB || spB === SPECIAL_TYPES.COLOR_BOMB) {
    return true;
  }
  // Nova + n'importe quel spécial
  if (spA && spB) {
    return true;
  }
  return false;
}

export function isStriped(special) {
  return special === SPECIAL_TYPES.STRIPED_H || special === SPECIAL_TYPES.STRIPED_V;
}

/**
 * Calcule les cellules ciblées par l'activation d'un seul bonbon spécial.
 * @param {Object} board - État de la grille
 * @param {number} r - Ligne du spécial
 * @param {number} c - Colonne du spécial
 * @param {Object} candy - Le bonbon spécial
 * @param {number|null} targetColor - Couleur cible (pour COLOR_BOMB)
 * @returns {Object} { positions: Array<{r, c}>, secondaryExplosion: boolean, effectType: string }
 */
export function getSpecialTargets(board, r, c, candy, targetColor = null) {
  const positions = [];
  const rows = board.rows;
  const cols = board.cols;

  const addPos = (pr, pc) => {
    if (pr >= 0 && pr < rows && pc >= 0 && pc < cols) {
      const cell = board.grid[pr][pc];
      if (cell && cell.active) {
        positions.push({ r: pr, c: pc });
      }
    }
  };

  switch (candy.special) {
    case SPECIAL_TYPES.STRIPED_H:
      for (let col = 0; col < cols; col++) addPos(r, col);
      return { positions, secondaryExplosion: false, effectType: 'line_h' };

    case SPECIAL_TYPES.STRIPED_V:
      for (let row = 0; row < rows; row++) addPos(row, c);
      return { positions, secondaryExplosion: false, effectType: 'line_v' };

    case SPECIAL_TYPES.WRAPPED:
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          addPos(r + dr, c + dc);
        }
      }
      return { positions, secondaryExplosion: true, radius: 1, effectType: 'blast_3x3' };

    case SPECIAL_TYPES.NOVA:
      // 5x5 + croix complète
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          addPos(r + dr, c + dc);
        }
      }
      for (let col = 0; col < cols; col++) addPos(r, col);
      for (let row = 0; row < rows; row++) addPos(row, c);
      return { positions, secondaryExplosion: false, effectType: 'nova_blast' };

    case SPECIAL_TYPES.COLOR_BOMB: {
      // Si pas de couleur fournie (ex: touché par un autre spécial), choisit la couleur la plus fréquente
      let colorToClear = targetColor !== null ? targetColor : findMostFrequentColor(board);
      addPos(r, c);
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const cell = board.grid[row][col];
          if (cell && cell.active && cell.candy && cell.candy.color === colorToClear && cell.candy.special !== SPECIAL_TYPES.INGREDIENT) {
            addPos(row, col);
          }
        }
      }
      return { positions, secondaryExplosion: false, effectType: 'color_ray', targetColor: colorToClear };
    }

    default:
      return { positions, secondaryExplosion: false, effectType: 'none' };
  }
}

/**
 * Trouve la couleur la plus fréquente sur le plateau (utile quand une bombe couleur est déclenchée en chaîne).
 */
export function findMostFrequentColor(board) {
  const counts = new Map();
  for (let r = 0; r < board.rows; r++) {
    for (let c = 0; c < board.cols; c++) {
      const cell = board.grid[r][c];
      if (cell && cell.active && cell.candy && cell.candy.color >= 0 && cell.candy.special !== SPECIAL_TYPES.INGREDIENT) {
        counts.set(cell.candy.color, (counts.get(cell.candy.color) || 0) + 1);
      }
    }
  }
  let bestColor = 0;
  let maxCount = -1;
  for (const [color, count] of counts.entries()) {
    if (count > maxCount) {
      maxCount = count;
      bestColor = color;
    }
  }
  return bestColor;
}

/**
 * Résout une combinaison entre deux bonbons (dont au moins un spécial ou deux spéciaux).
 * Retourne un descripteur d'action que engine.js exécutera proprement avec la file d'événements.
 *
 * @param {Object} board
 * @param {Object} posA - {r, c}
 * @param {Object} posB - {r, c}
 * @param {Function} rng - Fonction aléatoire [0, 1)
 */
export function describeSpecialCombo(board, posA, posB, rng) {
  const cellA = board.grid[posA.r][posA.c];
  const cellB = board.grid[posB.r][posB.c];
  const candyA = cellA.candy;
  const candyB = cellB.candy;
  const spA = candyA.special;
  const spB = candyB.special;

  const rows = board.rows;
  const cols = board.cols;
  const pivot = posB; // Point d'impact principal (case d'arrivée du swap)

  const addValid = (list, r, c) => {
    if (r >= 0 && r < rows && c >= 0 && c < cols) {
      const cell = board.grid[r][c];
      if (cell && cell.active) list.push({ r, c });
    }
  };

  // 1. BOMBE + BOMBE : efface tout le plateau
  if (spA === SPECIAL_TYPES.COLOR_BOMB && spB === SPECIAL_TYPES.COLOR_BOMB) {
    const all = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        addValid(all, r, c);
      }
    }
    return {
      comboType: 'BOMB_BOMB',
      passes: [all],
      transformBefore: null
    };
  }

  // 2. BOMBE + (NORMAL ou SPÉCIAL)
  if (spA === SPECIAL_TYPES.COLOR_BOMB || spB === SPECIAL_TYPES.COLOR_BOMB) {
    const otherCandy = spA === SPECIAL_TYPES.COLOR_BOMB ? candyB : candyA;
    const otherSpecial = otherCandy.special;
    const targetColor = otherCandy.color >= 0 ? otherCandy.color : findMostFrequentColor(board);

    // 2a. Bombe + Rayé : tous les bonbons de cette couleur deviennent rayés et s'activent
    if (isStriped(otherSpecial)) {
      const transforms = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const cell = board.grid[r][c];
          if (cell && cell.active && cell.candy && cell.candy.color === targetColor && cell.candy.special !== SPECIAL_TYPES.INGREDIENT) {
            const newStripe = rng() < 0.5 ? SPECIAL_TYPES.STRIPED_H : SPECIAL_TYPES.STRIPED_V;
            transforms.push({ r, c, special: newStripe });
          }
        }
      }
      return {
        comboType: 'BOMB_STRIPED',
        targetColor,
        transformBefore: transforms,
        consumePositions: [posA, posB],
        passes: [] // Les bonbons transformés seront activés par engine.js
      };
    }

    // 2b. Bombe + Emballé : deux passes d'explosions ou transformation en emballés sur la couleur ciblée
    if (otherSpecial === SPECIAL_TYPES.WRAPPED) {
      const pass1 = [posA, posB];
      const transforms = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const cell = board.grid[r][c];
          if (cell && cell.active && cell.candy && cell.candy.color === targetColor && cell.candy.special !== SPECIAL_TYPES.INGREDIENT) {
            transforms.push({ r, c, special: SPECIAL_TYPES.WRAPPED });
          }
        }
      }
      return {
        comboType: 'BOMB_WRAPPED',
        targetColor,
        transformBefore: transforms,
        consumePositions: pass1,
        passes: []
      };
    }

    // 2c. Bombe + Nova : transforme tous les bonbons de cette couleur en Nova ou efface tout
    if (otherSpecial === SPECIAL_TYPES.NOVA) {
      const transforms = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const cell = board.grid[r][c];
          if (cell && cell.active && cell.candy && cell.candy.color === targetColor && cell.candy.special !== SPECIAL_TYPES.INGREDIENT) {
            transforms.push({ r, c, special: SPECIAL_TYPES.NOVA });
          }
        }
      }
      return {
        comboType: 'BOMB_NOVA',
        targetColor,
        transformBefore: transforms,
        consumePositions: [posA, posB],
        passes: []
      };
    }

    // 2d. Bombe + Bonbon normal : efface tous les bonbons de cette couleur
    const targets = [posA, posB];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cell = board.grid[r][c];
        if (cell && cell.active && cell.candy && cell.candy.color === targetColor && cell.candy.special !== SPECIAL_TYPES.INGREDIENT) {
          targets.push({ r, c });
        }
      }
    }
    return {
      comboType: 'BOMB_NORMAL',
      targetColor,
      passes: [targets],
      transformBefore: null
    };
  }

  // 3. RAYÉ + RAYÉ : efface la ligne ET la colonne du point d'impact
  if (isStriped(spA) && isStriped(spB)) {
    const targets = [posA, posB];
    for (let c = 0; c < cols; c++) addValid(targets, pivot.r, c);
    for (let r = 0; r < rows; r++) addValid(targets, r, pivot.c);
    return {
      comboType: 'STRIPED_STRIPED',
      passes: [targets],
      transformBefore: null
    };
  }

  // 4. RAYÉ + EMBALLÉ : efface 3 lignes et 3 colonnes en croix géante
  if ((isStriped(spA) && spB === SPECIAL_TYPES.WRAPPED) || (spA === SPECIAL_TYPES.WRAPPED && isStriped(spB))) {
    const targets = [posA, posB];
    for (let dr = -1; dr <= 1; dr++) {
      for (let c = 0; c < cols; c++) addValid(targets, pivot.r + dr, c);
    }
    for (let dc = -1; dc <= 1; dc++) {
      for (let r = 0; r < rows; r++) addValid(targets, r, pivot.c + dc);
    }
    return {
      comboType: 'STRIPED_WRAPPED',
      passes: [targets],
      transformBefore: null
    };
  }

  // 5. EMBALLÉ + EMBALLÉ : grosse explosion 5x5, puis une seconde explosion 5x5 après chute
  if (spA === SPECIAL_TYPES.WRAPPED && spB === SPECIAL_TYPES.WRAPPED) {
    const pass1 = [posA, posB];
    for (let dr = -2; dr <= 2; dr++) {
      for (let dc = -2; dc <= 2; dc++) {
        addValid(pass1, pivot.r + dr, pivot.c + dc);
      }
    }
    return {
      comboType: 'WRAPPED_WRAPPED',
      passes: [pass1],
      secondBlast: { r: pivot.r, c: pivot.c, radius: 2 },
      transformBefore: null
    };
  }

  // 6. NOVA + autre spécial (Rayé, Emballé, Nova) : méga explosion 7x7 + 3 lignes/colonnes
  if (spA === SPECIAL_TYPES.NOVA || spB === SPECIAL_TYPES.NOVA) {
    const targets = [posA, posB];
    for (let dr = -3; dr <= 3; dr++) {
      for (let dc = -3; dc <= 3; dc++) {
        addValid(targets, pivot.r + dr, pivot.c + dc);
      }
    }
    for (let d = -1; d <= 1; d++) {
      for (let c = 0; c < cols; c++) addValid(targets, pivot.r + d, c);
      for (let r = 0; r < rows; r++) addValid(targets, r, pivot.c + d);
    }
    return {
      comboType: 'NOVA_COMBO',
      passes: [targets],
      transformBefore: null
    };
  }

  return null;
}
