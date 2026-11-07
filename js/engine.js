/**
 * @file engine.js
 * @description Moteur PUR (zéro DOM) de "Sweet Match".
 * Gère l'état du plateau, le générateur aléatoire à graine (PRNG Mulberry32),
 * la détection des matchs (3+, 4, 5, 6+, formes L, T, Croix), les bonbons spéciaux,
 * la gravité (avec glissement en diagonale et téléporteurs), les obstacles,
 * la propagation du chocolat, les ingrédients, et le calcul du score.
 *
 * ============================================================================
 * FORMULE DU SCORE (Documentée)
 * ============================================================================
 * - Base : 60 points par bonbon éclaté (`BASE_CANDY_SCORE = 60`).
 * - Bonus de taille de match (pour un match de N bonbons, N >= 3) :
 *     Score_Match = (N * 60 + (N - 3) * 60) * Multiplicateur_Cascade
 *     Ex. Match de 3 = 180 pts ; Match de 4 = 300 pts ; Match de 5 = 420 pts.
 * - Multiplicateur de cascade (niveau k >= 1, où k=1 est le 1er match du coup) :
 *     Multiplicateur_Cascade = 1 + 0.5 * (k - 1)   (ex: x1.0, x1.5, x2.0, x2.5...)
 * - Points fixes de création de spécial :
 *     Rayé : +120 | Emballé : +200 | Bombe Couleur : +400 | Nova (6+) : +600
 * - Points d'activation de spécial :
 *     Rayé : +180 | Emballé : +300 | Bombe Couleur : +600 | Nova : +900
 *     Combinaison de 2 spéciaux : +500 bonus + 60 pts par case nettoyée * Multiplicateur
 * - Obstacles détruits :
 *     Glace : +80 | Gelée : +100 | Réglisse : +100 | Chocolat : +150 | Chaîne : +80
 *     Ingrédient collecté : +1000
 * - Bonus de fin de niveau ("Sucre à gogo") :
 *     Chaque coup restant = +2500 pts (transformé en bonbon rayé qui explose).
 * ============================================================================
 */

import {
  SPECIAL_TYPES,
  SPECIAL_SCORES,
  determineSpecialToCreate,
  isSpecialCombination,
  getSpecialTargets,
  describeSpecialCombo
} from './specials.js';

export const BASE_CANDY_SCORE = 60;

export const OBSTACLE_TYPES = {
  NONE: null,
  LICORICE: 'licorice',   // Réglisse : bloque le bonbon, détruit par match adjacent ou spécial
  CHOCOLATE: 'chocolate'  // Chocolat : bloque la case, se propage si non détruit ce tour, détruit par match adjacent ou spécial
};

export const CASCADE_MESSAGES = [
  null,
  'Sucré !',        // Cascade >= 2
  'Délicieux !',    // Cascade >= 3
  'Divin !',        // Cascade >= 4
  'Sensationnel !'  // Cascade >= 5
];

/**
 * Générateur pseudo-aléatoire déterministe (Mulberry32).
 * @param {number} seed - Graine entière
 * @returns {Function} Fonction retournant un flottant dans [0, 1)
 */
export function createPRNG(seed = 12345) {
  let a = seed >>> 0;
  return function rng() {
    let t = (a += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let nextCandyUid = 1;
export function resetCandyUidCounter(val = 1) {
  nextCandyUid = val;
}

/**
 * Crée un objet bonbon.
 */
export function createCandy(color, special = SPECIAL_TYPES.NONE, extra = {}) {
  return {
    id: nextCandyUid++,
    color, // 0 à numColors-1 (ou -1 pour Bombe Couleur / Ingrédient)
    special,
    locked: extra.locked || 0,           // 1 = bonbon enchaîné
    bombTimer: extra.bombTimer || null,  // Compte à rebours en coups (null si normal)
    ingredientType: extra.ingredientType || null, // 'cherry' | 'hazelnut'
    secondBlastPending: extra.secondBlastPending || false // Pour la 2e explosion de l'emballé
  };
}

/**
 * Crée une cellule de la grille.
 */
export function createCell(r, c, config = {}) {
  return {
    r,
    c,
    active: config.active !== undefined ? config.active : true, // false = trou dans la grille
    jelly: config.jelly || 0,             // 0, 1 ou 2 couches de gelée au sol
    ice: config.ice || 0,                 // 0 à 3 couches de glace par-dessus
    obstacle: config.obstacle || OBSTACLE_TYPES.NONE, // 'licorice' | 'chocolate' | null
    portalTo: config.portalTo || null,    // { r, c } si sortie de téléporteur vers une entrée
    portalFrom: config.portalFrom || null,// { r, c } si entrée de téléporteur
    isExit: Boolean(config.isExit),       // Sortie d'ingrédients en bas
    candy: config.candy || null
  };
}

/**
 * Classe principale du moteur de jeu (100 % sans DOM).
 */
export class GameEngine {
  /**
   * @param {Object} levelConfig - Configuration du niveau (voir levels.js)
   * @param {number} [seed] - Graine aléatoire (par défaut dérivée de l'ID du niveau)
   */
  constructor(levelConfig, seed = null) {
    this.level = JSON.parse(JSON.stringify(levelConfig));
    this.seed = seed !== null ? seed : (levelConfig.seed || (levelConfig.id || 1) * 98765 + 4321);
    this.rng = createPRNG(this.seed);

    this.rows = this.level.rows || 9;
    this.cols = this.level.cols || 9;
    this.numColors = this.level.numColors || 6;
    this.movesLeft = this.level.moves || 25;
    this.maxMoves = this.movesLeft;
    this.timeLeft = this.level.timer || null; // En secondes pour les niveaux chronométrés
    this.score = 0;
    this.starThresholds = this.level.stars || [1500, 3500, 6000];
    this.status = 'PLAYING'; // 'PLAYING' | 'WON' | 'LOST'

    // Suivi des objectifs
    this.goals = (this.level.goals || [{ type: 'score', target: 1500 }]).map(g => ({
      ...g,
      current: 0
    }));

    // Gestion des ingrédients à faire apparaître
    this.ingredientsToSpawn = 0;
    this.ingredientsOnBoard = 0;
    for (const g of this.goals) {
      if (g.type === 'ingredients') {
        this.ingredientsToSpawn = g.target;
      }
    }

    this.board = {
      rows: this.rows,
      cols: this.cols,
      grid: []
    };

    this._initBoard();
    this._syncInitialGoalCounts();
  }

  /**
   * Initialise la grille selon le layout du niveau, sans aucun match initial,
   * et avec au moins un coup valide garanti.
   */
  _initBoard() {
    const layout = this.level.layout || null;
    this.board.grid = [];

    for (let r = 0; r < this.rows; r++) {
      const row = [];
      for (let c = 0; c < this.cols; c++) {
        const cellCode = layout && layout[r] && layout[r][c] !== undefined ? layout[r][c] : 1;
        row.push(this._createCellFromCode(r, c, cellCode));
      }
      this.board.grid.push(row);
    }

    // Configuration des portails (téléporteurs)
    if (Array.isArray(this.level.portals)) {
      for (const p of this.level.portals) {
        const fromCell = this.getCell(p.from.r, p.from.c);
        const toCell = this.getCell(p.to.r, p.to.c);
        if (fromCell && toCell) {
          fromCell.portalTo = { r: p.to.r, c: p.to.c };
          toCell.portalFrom = { r: p.from.r, c: p.from.c };
        }
      }
    }

    // Sorties d'ingrédients (par défaut : la case active la plus basse de chaque colonne)
    if (Array.isArray(this.level.exits) && this.level.exits.length > 0) {
      for (const ex of this.level.exits) {
        const cell = this.getCell(ex.r, ex.c);
        if (cell) cell.isExit = true;
      }
    } else {
      for (let c = 0; c < this.cols; c++) {
        for (let r = this.rows - 1; r >= 0; r--) {
          if (this.board.grid[r][c].active) {
            this.board.grid[r][c].isExit = true;
            break;
          }
        }
      }
    }

    // Remplissage initial sans match
    this._fillInitialCandies();

    // Placement des obstacles / spéciaux explicites du niveau
    if (Array.isArray(this.level.presets)) {
      for (const preset of this.level.presets) {
        const cell = this.getCell(preset.r, preset.c);
        if (!cell || !cell.active) continue;
        if (preset.jelly !== undefined) cell.jelly = preset.jelly;
        if (preset.ice !== undefined) cell.ice = preset.ice;
        if (preset.obstacle) {
          cell.obstacle = preset.obstacle;
          if (preset.obstacle === OBSTACLE_TYPES.CHOCOLATE || preset.obstacle === OBSTACLE_TYPES.LICORICE) {
            cell.candy = null;
          }
        }
        if (preset.locked && cell.candy) cell.candy.locked = preset.locked;
        if (preset.bombTimer && cell.candy) cell.candy.bombTimer = preset.bombTimer;
        if (preset.special && cell.candy) {
          cell.candy.special = preset.special;
          if (preset.special === SPECIAL_TYPES.COLOR_BOMB) cell.candy.color = -1;
        }
      }
    }

    // Si on a des ingrédients à faire tomber, en placer 1 en haut au départ
    if (this.ingredientsToSpawn > 0) {
      this._spawnIngredientAtTop();
    }

    // S'assurer qu'il n'y a aucun match initial et au moins un coup possible
    let safety = 0;
    while ((this.findMatches().length > 0 || this.findValidMoves().length === 0) && safety < 50) {
      this._fillInitialCandies(true);
      safety++;
    }
    if (this.findValidMoves().length === 0) {
      this._forceCreateValidMove();
    }
  }

  /**
   * Interprète un code de layout compact :
   * 0 = trou (inactif)
   * 1 = case normale
   * 'J' ou 2 = gelée (1 couche), 'J2' = gelée 2 couches
   * 'I1','I2','I3' = glace 1 à 3 couches
   * 'L' = réglisse
   * 'C' = chocolat
   * 'K' = bonbon enchaîné (locked)
   * 'B10' = bombe à retardement (10 coups)
   */
  _createCellFromCode(r, c, code) {
    if (code === 0 || code === '0' || code === '.') {
      return createCell(r, c, { active: false });
    }
    const cell = createCell(r, c, { active: true });
    if (code === 'J' || code === 2) cell.jelly = 1;
    else if (code === 'J2') cell.jelly = 2;
    else if (code === 'I1') cell.ice = 1;
    else if (code === 'I2') cell.ice = 2;
    else if (code === 'I3') cell.ice = 3;
    else if (code === 'L') cell.obstacle = OBSTACLE_TYPES.LICORICE;
    else if (code === 'C') cell.obstacle = OBSTACLE_TYPES.CHOCOLATE;
    else if (code === 'K') cell._presetLock = 1;
    else if (typeof code === 'string' && code.startsWith('B')) {
      cell._presetBomb = parseInt(code.slice(1), 10) || 10;
    }
    return cell;
  }

  _fillInitialCandies(onlyUnlockedNormal = false) {
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const cell = this.board.grid[r][c];
        if (!cell.active || cell.obstacle) {
          cell.candy = null;
          continue;
        }
        if (onlyUnlockedNormal && cell.candy && (cell.candy.special === SPECIAL_TYPES.INGREDIENT)) {
          continue;
        }

        // Choisir une couleur qui ne crée pas de match de 3 avec (c-1, c-2) ni (r-1, r-2)
        const forbidden = new Set();
        if (c >= 2) {
          const c1 = this.board.grid[r][c - 1].candy;
          const c2 = this.board.grid[r][c - 2].candy;
          if (c1 && c2 && c1.color === c2.color && c1.color >= 0) {
            forbidden.add(c1.color);
          }
        }
        if (r >= 2) {
          const r1 = this.board.grid[r - 1][c].candy;
          const r2 = this.board.grid[r - 2][c].candy;
          if (r1 && r2 && r1.color === r2.color && r1.color >= 0) {
            forbidden.add(r1.color);
          }
        }

        const available = [];
        for (let col = 0; col < this.numColors; col++) {
          if (!forbidden.has(col)) available.push(col);
        }
        const chosenColor = available.length > 0
          ? available[Math.floor(this.rng() * available.length)]
          : Math.floor(this.rng() * this.numColors);

        const locked = cell._presetLock || (cell.candy ? cell.candy.locked : 0);
        const bombTimer = cell._presetBomb || (cell.candy ? cell.candy.bombTimer : null);
        cell.candy = createCandy(chosenColor, SPECIAL_TYPES.NONE, { locked, bombTimer });
      }
    }
  }

  /**
   * Force la création d'au moins un coup valide (pattern V : deux bonbons côte à côte et un 3e décalé)
   * sans créer de match immédiat.
   */
  _forceCreateValidMove() {
    for (let r = 0; r < this.rows - 1; r++) {
      for (let c = 0; c < this.cols - 2; c++) {
        const cell0 = this.board.grid[r][c];
        const cell1 = this.board.grid[r][c + 1];
        const cell2 = this.board.grid[r][c + 2];
        const cellSwap = this.board.grid[r + 1][c + 2];
        if (
          this._isSwappableCell(cell0) &&
          this._isSwappableCell(cell1) &&
          this._isSwappableCell(cell2) &&
          this._isSwappableCell(cellSwap)
        ) {
          const targetColor = cell0.candy.color >= 0 ? cell0.candy.color : 0;
          const altColor = (targetColor + 1) % this.numColors;
          cell0.candy.color = targetColor;
          cell1.candy.color = targetColor;
          cell2.candy.color = altColor;
          cellSwap.candy.color = targetColor;
          // Éviter qu'un match vertical/horizontal accidentel ait été créé
          if (this.findMatches().length === 0 && this.findValidMoves().length > 0) {
            return;
          }
        }
      }
    }
  }

  _spawnIngredientAtTop() {
    const candidateCols = [];
    for (let c = 0; c < this.cols; c++) {
      for (let r = 0; r < Math.min(2, this.rows); r++) {
        const cell = this.board.grid[r][c];
        if (cell.active && !cell.obstacle && !cell.isExit && cell.candy && !cell.candy.special && !cell.candy.locked) {
          candidateCols.push({ r, c });
          break;
        }
      }
    }
    if (candidateCols.length > 0) {
      const pick = candidateCols[Math.floor(this.rng() * candidateCols.length)];
      const ingType = this.rng() < 0.5 ? 'cherry' : 'hazelnut';
      this.board.grid[pick.r][pick.c].candy = createCandy(-1, SPECIAL_TYPES.INGREDIENT, { ingredientType: ingType });
      this.ingredientsToSpawn--;
      this.ingredientsOnBoard++;
      return pick;
    }
    return null;
  }

  _syncInitialGoalCounts() {
    for (const g of this.goals) {
      if (g.type === 'jelly') {
        let totalJelly = 0;
        for (let r = 0; r < this.rows; r++) {
          for (let c = 0; c < this.cols; c++) {
            totalJelly += this.board.grid[r][c].jelly;
          }
        }
        if (!g.target || g.target !== totalJelly) {
          g.target = Math.max(1, totalJelly);
        }
      } else if (g.type === 'chocolate') {
        let totalChoc = 0;
        for (let r = 0; r < this.rows; r++) {
          for (let c = 0; c < this.cols; c++) {
            if (this.board.grid[r][c].obstacle === OBSTACLE_TYPES.CHOCOLATE) totalChoc++;
          }
        }
        if (!g.target) g.target = Math.max(1, totalChoc);
      }
    }
  }

  getCell(r, c) {
    if (r < 0 || r >= this.rows || c < 0 || c >= this.cols) return null;
    return this.board.grid[r][c];
  }

  /**
   * Retourne une copie sérialisable de l'état courant du plateau.
   */
  getStateSnapshot() {
    return {
      rows: this.rows,
      cols: this.cols,
      score: this.score,
      movesLeft: this.movesLeft,
      timeLeft: this.timeLeft,
      status: this.status,
      goals: JSON.parse(JSON.stringify(this.goals)),
      grid: JSON.parse(JSON.stringify(this.board.grid))
    };
  }

  _isSwappableCell(cell) {
    if (!cell || !cell.active || cell.obstacle || cell.ice > 0) return false;
    if (!cell.candy || cell.candy.locked > 0) return false;
    return true;
  }

  /**
   * Vérifie si deux positions sont adjacentes orthogonalement.
   */
  areAdjacent(posA, posB) {
    const dr = Math.abs(posA.r - posB.r);
    const dc = Math.abs(posA.c - posB.c);
    return (dr === 1 && dc === 0) || (dr === 0 && dc === 1);
  }

  /**
   * Détecte tous les matchs (3+ alignés) et les regroupe en composantes connexes
   * (pour détecter les formes L, T, Croix, lignes de 4, 5, 6+).
   * @returns {Array<Object>} Liste des groupes de match :
   *   { positions: [{r,c}], color, hasHorizontal, hasVertical, maxLineLength, orientation }
   */
  findMatches() {
    const horizSegments = [];
    const vertSegments = [];

    const canMatchCandy = (cell) => {
      if (!cell || !cell.active || cell.obstacle) return false;
      const candy = cell.candy;
      if (!candy || candy.color < 0 || candy.special === SPECIAL_TYPES.INGREDIENT || candy.special === SPECIAL_TYPES.COLOR_BOMB) {
        return false;
      }
      return true;
    };

    // Segments horizontaux >= 3
    for (let r = 0; r < this.rows; r++) {
      let c = 0;
      while (c < this.cols) {
        const startCell = this.board.grid[r][c];
        if (!canMatchCandy(startCell)) {
          c++;
          continue;
        }
        const color = startCell.candy.color;
        let endC = c + 1;
        while (endC < this.cols && canMatchCandy(this.board.grid[r][endC]) && this.board.grid[r][endC].candy.color === color) {
          endC++;
        }
        const length = endC - c;
        if (length >= 3) {
          const cells = [];
          for (let k = c; k < endC; k++) cells.push({ r, c: k });
          horizSegments.push({ color, orientation: 'H', length, cells });
        }
        c = endC;
      }
    }

    // Segments verticaux >= 3
    for (let c = 0; c < this.cols; c++) {
      let r = 0;
      while (r < this.rows) {
        const startCell = this.board.grid[r][c];
        if (!canMatchCandy(startCell)) {
          r++;
          continue;
        }
        const color = startCell.candy.color;
        let endR = r + 1;
        while (endR < this.rows && canMatchCandy(this.board.grid[endR][c]) && this.board.grid[endR][c].candy.color === color) {
          endR++;
        }
        const length = endR - r;
        if (length >= 3) {
          const cells = [];
          for (let k = r; k < endR; k++) cells.push({ r: k, c });
          vertSegments.push({ color, orientation: 'V', length, cells });
        }
        r = endR;
      }
    }

    const allSegments = [...horizSegments, ...vertSegments];
    if (allSegments.length === 0) return [];

    // Regrouper les segments de même couleur qui partagent au moins une case (L, T, Croix)
    const visited = new Array(allSegments.length).fill(false);
    const groups = [];

    const shareCell = (segA, segB) => {
      if (segA.color !== segB.color) return false;
      for (const a of segA.cells) {
        for (const b of segB.cells) {
          if (a.r === b.r && a.c === b.c) return true;
        }
      }
      return false;
    };

    for (let i = 0; i < allSegments.length; i++) {
      if (visited[i]) continue;
      visited[i] = true;
      const queue = [allSegments[i]];
      const compSegments = [allSegments[i]];

      while (queue.length > 0) {
        const cur = queue.shift();
        for (let j = 0; j < allSegments.length; j++) {
          if (!visited[j] && shareCell(cur, allSegments[j])) {
            visited[j] = true;
            queue.push(allSegments[j]);
            compSegments.push(allSegments[j]);
          }
        }
      }

      const posMap = new Map();
      let hasHorizontal = false;
      let hasVertical = false;
      let maxLineLength = 0;
      let orientation = compSegments[0].orientation;

      for (const seg of compSegments) {
        if (seg.orientation === 'H') hasHorizontal = true;
        if (seg.orientation === 'V') hasVertical = true;
        if (seg.length > maxLineLength) {
          maxLineLength = seg.length;
          orientation = seg.orientation;
        }
        for (const p of seg.cells) {
          posMap.set(`${p.r},${p.c}`, p);
        }
      }

      groups.push({
        color: compSegments[0].color,
        positions: Array.from(posMap.values()),
        hasHorizontal,
        hasVertical,
        maxLineLength,
        orientation
      });
    }

    return groups;
  }

  /**
   * Trouve tous les coups valides possibles sur le plateau actuel.
   * @returns {Array<{from: {r,c}, to: {r,c}, scoreHint: number}>}
   */
  findValidMoves() {
    const validMoves = [];
    const dirs = [
      { dr: 0, dc: 1 },
      { dr: 1, dc: 0 }
    ];

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const cellA = this.board.grid[r][c];
        if (!this._isSwappableCell(cellA)) continue;

        for (const d of dirs) {
          const nr = r + d.dr;
          const nc = c + d.dc;
          const cellB = this.getCell(nr, nc);
          if (!this._isSwappableCell(cellB)) continue;

          // 1. Combinaison de spéciaux (toujours valide sauf ingrédient)
          if (isSpecialCombination(cellA.candy, cellB.candy)) {
            validMoves.push({
              from: { r, c },
              to: { r: nr, c: nc },
              scoreHint: 100
            });
            continue;
          }

          // 2. Simuler l'échange
          const tmp = cellA.candy;
          cellA.candy = cellB.candy;
          cellB.candy = tmp;

          const matches = this.findMatches();

          // Restaurer
          cellB.candy = cellA.candy;
          cellA.candy = tmp;

          if (matches.length > 0) {
            const totalMatched = matches.reduce((acc, m) => acc + m.positions.length, 0);
            validMoves.push({
              from: { r, c },
              to: { r: nr, c: nc },
              scoreHint: totalMatched
            });
          }
        }
      }
    }

    // Trier pour que getHint() retourne le meilleur coup en premier
    validMoves.sort((a, b) => b.scoreHint - a.scoreHint);
    return validMoves;
  }

  /**
   * Retourne un coup conseillé (pour l'indice après 5s d'inactivité).
   */
  getHint() {
    const moves = this.findValidMoves();
    return moves.length > 0 ? moves[0] : null;
  }

  /**
   * Mélange les bonbons déplaçables du plateau lorsqu'aucun coup n'est possible,
   * sans créer de match immédiat et en garantissant au moins un coup valide.
   */
  shuffleBoard(events = []) {
    const movableCells = [];
    const candies = [];

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const cell = this.board.grid[r][c];
        if (this._isSwappableCell(cell) && cell.candy.special !== SPECIAL_TYPES.INGREDIENT) {
          movableCells.push(cell);
          candies.push(cell.candy);
        }
      }
    }

    let attempts = 0;
    do {
      // Fisher-Yates avec this.rng
      for (let i = candies.length - 1; i > 0; i--) {
        const j = Math.floor(this.rng() * (i + 1));
        const tmp = candies[i];
        candies[i] = candies[j];
        candies[j] = tmp;
      }
      for (let i = 0; i < movableCells.length; i++) {
        movableCells[i].candy = candies[i];
      }
      attempts++;
    } while ((this.findMatches().length > 0 || this.findValidMoves().length === 0) && attempts < 60);

    // Si malgré tout aucun coup valide n'existe (ex: trop peu de bonbons de même couleur), on régénère proprement
    if (this.findMatches().length > 0 || this.findValidMoves().length === 0) {
      this._fillInitialCandies(true);
      if (this.findValidMoves().length === 0) {
        this._forceCreateValidMove();
      }
    }

    const mapping = movableCells.map(cell => ({
      r: cell.r,
      c: cell.c,
      candy: JSON.parse(JSON.stringify(cell.candy))
    }));

    events.push({
      type: 'shuffle',
      message: 'Plus de coups possibles ! Mélange sucré...',
      cells: mapping
    });

    return events;
  }

  /**
   * Action principale du joueur : échanger deux cases adjacentes (posA et posB).
   * Retourne une liste ordonnée d'événements pour le renderer.
   *
   * @param {{r: number, c: number}} posA
   * @param {{r: number, c: number}} posB
   * @returns {Array<Object>} Liste ordonnée d'événements
   */
  swap(posA, posB) {
    const events = [];
    if (this.status !== 'PLAYING') return events;

    if (!this.areAdjacent(posA, posB)) {
      events.push({ type: 'invalid_swap', from: posA, to: posB, reason: 'not_adjacent' });
      return events;
    }

    const cellA = this.getCell(posA.r, posA.c);
    const cellB = this.getCell(posB.r, posB.c);

    if (!this._isSwappableCell(cellA) || !this._isSwappableCell(cellB)) {
      events.push({ type: 'invalid_swap', from: posA, to: posB, reason: 'blocked' });
      return events;
    }

    // Effectuer l'échange
    const tmp = cellA.candy;
    cellA.candy = cellB.candy;
    cellB.candy = tmp;

    const isCombo = isSpecialCombination(cellA.candy, cellB.candy);
    const matches = isCombo ? [] : this.findMatches();

    // Si aucun match et pas de combinaison de spéciaux -> annuler l'échange sans consommer de coup
    if (!isCombo && matches.length === 0) {
      cellB.candy = cellA.candy;
      cellA.candy = tmp;
      events.push({ type: 'swap', from: posA, to: posB });
      events.push({ type: 'invalid_swap', from: posA, to: posB, reason: 'no_match' });
      return events;
    }

    // L'échange est valide : on consomme 1 coup
    this.movesLeft = Math.max(0, this.movesLeft - 1);
    events.push({
      type: 'swap',
      from: posA,
      to: posB,
      movesLeft: this.movesLeft
    });

    const stateTracker = {
      chocolateDestroyedThisTurn: false,
      cascadeLevel: 0,
      swappedPositions: [posA, posB]
    };

    if (isCombo) {
      stateTracker.cascadeLevel = 1;
      this._resolveSpecialCombo(posA, posB, events, stateTracker);
      this._applyGravityAndRefill(events, stateTracker);
    }

    // Boucle de résolution des cascades
    this._resolveBoardLoop(events, stateTracker);

    // Fin du tour : propagation du chocolat, décrémentation des bombes à retardement, vérification blocage & victoire/défaite
    this._endOfTurnMaintenance(events, stateTracker);

    return events;
  }

  /**
   * Booster : Marteau sucré (détruit une case ou une couche d'obstacle sans consommer de coup).
   */
  useHammerBooster(r, c) {
    const events = [];
    if (this.status !== 'PLAYING') return events;
    const cell = this.getCell(r, c);
    if (!cell || !cell.active) return events;

    const stateTracker = {
      chocolateDestroyedThisTurn: false,
      cascadeLevel: 1,
      swappedPositions: [{ r, c }]
    };

    events.push({ type: 'booster_used', booster: 'hammer', position: { r, c } });
    this._clearPositions([{ r, c }], events, stateTracker, { fromSpecial: true });
    this._applyGravityAndRefill(events, stateTracker);
    this._resolveBoardLoop(events, stateTracker);
    this._checkWinLose(events);
    return events;
  }

  /**
   * Booster : Échange libre ("Main magique") entre deux cases adjacentes sans vérifier le match et sans coûter de coup.
   */
  useFreeSwapBooster(posA, posB) {
    const events = [];
    if (this.status !== 'PLAYING' || !this.areAdjacent(posA, posB)) return events;
    const cellA = this.getCell(posA.r, posA.c);
    const cellB = this.getCell(posB.r, posB.c);
    if (!this._isSwappableCell(cellA) || !this._isSwappableCell(cellB)) return events;

    const tmp = cellA.candy;
    cellA.candy = cellB.candy;
    cellB.candy = tmp;

    events.push({ type: 'booster_used', booster: 'free_swap', from: posA, to: posB });
    events.push({ type: 'swap', from: posA, to: posB, movesLeft: this.movesLeft });

    const stateTracker = {
      chocolateDestroyedThisTurn: false,
      cascadeLevel: 0,
      swappedPositions: [posA, posB]
    };

    this._resolveBoardLoop(events, stateTracker);
    this._checkWinLose(events);
    return events;
  }

  /**
   * Booster : +5 coups supplémentaires.
   */
  addExtraMoves(count = 5) {
    this.movesLeft += count;
    if (this.status === 'LOST') this.status = 'PLAYING';
    return [{ type: 'booster_used', booster: 'extra_moves', movesLeft: this.movesLeft }];
  }

  /**
   * Booster : Placer une Bombe Couleur aléatoire au début ou en cours de partie.
   */
  placeColorBombBooster() {
    const events = [];
    const candidates = [];
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const cell = this.board.grid[r][c];
        if (this._isSwappableCell(cell) && !cell.candy.special) {
          candidates.push(cell);
        }
      }
    }
    if (candidates.length > 0) {
      const target = candidates[Math.floor(this.rng() * candidates.length)];
      target.candy.special = SPECIAL_TYPES.COLOR_BOMB;
      target.candy.color = -1;
      events.push({
        type: 'special_created',
        position: { r: target.r, c: target.c },
        special: SPECIAL_TYPES.COLOR_BOMB,
        candy: JSON.parse(JSON.stringify(target.candy))
      });
    }
    return events;
  }

  /**
   * Résout une combinaison de deux bonbons spéciaux échangés.
   */
  _resolveSpecialCombo(posA, posB, events, stateTracker) {
    const combo = describeSpecialCombo(this.board, posA, posB, this.rng);
    if (!combo) return;

    this._addScore(SPECIAL_SCORES.ACTIVATE.COMBO_BONUS, posB, events, stateTracker.cascadeLevel);
    events.push({
      type: 'special_activated',
      comboType: combo.comboType,
      positions: [posA, posB],
      targetColor: combo.targetColor !== undefined ? combo.targetColor : null
    });

    // Cas avec transformation préalable (ex: Bombe + Rayé / Bombe + Emballé / Bombe + Nova)
    if (combo.transformBefore && combo.transformBefore.length > 0) {
      // Détruire d'abord les deux bonbons de la combinaison
      for (const p of (combo.consumePositions || [posA, posB])) {
        const c = this.getCell(p.r, p.c);
        if (c) c.candy = null;
      }

      const toActivate = [];
      for (const tr of combo.transformBefore) {
        const cell = this.getCell(tr.r, tr.c);
        if (cell && cell.candy) {
          cell.candy.special = tr.special;
          events.push({
            type: 'special_created',
            position: { r: tr.r, c: tr.c },
            special: tr.special,
            candy: JSON.parse(JSON.stringify(cell.candy))
          });
          toActivate.push({ r: tr.r, c: tr.c });
        }
      }

      // Activer tous les bonbons nouvellement transformés
      this._clearPositions(toActivate, events, stateTracker, { fromSpecial: true });
      return;
    }

    // Si pas de transformation préalable, les deux bonbons de la combinaison ont déjà livré leur effet combiné :
    // on neutralise leur statut spécial pour éviter qu'ils ne se déclenchent individuellement en plus du combo.
    for (const p of [posA, posB]) {
      const c = this.getCell(p.r, p.c);
      if (c && c.candy) c.candy.special = SPECIAL_TYPES.NONE;
    }

    // Exécuter les passes de nettoyage
    for (const pass of combo.passes) {
      this._clearPositions(pass, events, stateTracker, { fromSpecial: true });
    }

    // Si Emballé + Emballé : 2e explosion 5x5 après gravité
    if (combo.secondBlast) {
      this._applyGravityAndRefill(events, stateTracker);
      const blast2 = [];
      for (let dr = -combo.secondBlast.radius; dr <= combo.secondBlast.radius; dr++) {
        for (let dc = -combo.secondBlast.radius; dc <= combo.secondBlast.radius; dc++) {
          const nr = combo.secondBlast.r + dr;
          const nc = combo.secondBlast.c + dc;
          if (this.getCell(nr, nc)?.active) {
            blast2.push({ r: nr, c: nc });
          }
        }
      }
      events.push({
        type: 'special_activated',
        comboType: 'WRAPPED_SECOND_BLAST',
        positions: [combo.secondBlast]
      });
      this._clearPositions(blast2, events, stateTracker, { fromSpecial: true });
    }
  }

  /**
   * Boucle de résolution : tant qu'il y a des matchs ou des explosions secondaires d'emballés,
   * détruit, fait tomber et remplit. Sécurisée contre toute boucle infinie.
   */
  _resolveBoardLoop(events, stateTracker) {
    let safetyCounter = 0;
    const MAX_CASCADES = 40;

    while (safetyCounter < MAX_CASCADES) {
      safetyCounter++;
      const matches = this.findMatches();
      const pendingWrapped = this._findPendingWrappedBlasts();

      if (matches.length === 0 && pendingWrapped.length === 0) {
        break;
      }

      stateTracker.cascadeLevel++;
      const cascadeMultiplier = 1 + 0.5 * (stateTracker.cascadeLevel - 1);

      if (stateTracker.cascadeLevel >= 2) {
        const msgIdx = Math.min(CASCADE_MESSAGES.length - 1, stateTracker.cascadeLevel - 1);
        events.push({
          type: 'cascade',
          level: stateTracker.cascadeLevel,
          multiplier: cascadeMultiplier,
          message: CASCADE_MESSAGES[msgIdx]
        });
      }

      // 1. Traiter les groupes de matchs
      if (matches.length > 0) {
        this._processMatchGroups(matches, events, stateTracker);
      }

      // 2. Traiter les secondes explosions de bonbons emballés
      if (pendingWrapped.length > 0) {
        for (const pw of pendingWrapped) {
          const cell = this.getCell(pw.r, pw.c);
          if (cell && cell.candy) cell.candy.secondBlastPending = false;
          const targets = [];
          for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
              if (this.getCell(pw.r + dr, pw.c + dc)?.active) {
                targets.push({ r: pw.r + dr, c: pw.c + dc });
              }
            }
          }
          events.push({
            type: 'special_activated',
            special: SPECIAL_TYPES.WRAPPED,
            phase: 2,
            position: { r: pw.r, c: pw.c }
          });
          this._clearPositions(targets, events, stateTracker, { fromSpecial: true });
        }
      }

      // 3. Gravité, collecte d'ingrédients en bas, et remplissage
      this._applyGravityAndRefill(events, stateTracker);

      // Après le premier niveau de cascade, les positions du swap joueur ne servent plus d'ancrage de création
      stateTracker.swappedPositions = [];
    }
  }

  _findPendingWrappedBlasts() {
    const list = [];
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const cell = this.board.grid[r][c];
        if (cell.active && cell.candy && cell.candy.secondBlastPending) {
          list.push({ r, c });
        }
      }
    }
    return list;
  }

  /**
   * Traite chaque groupe de match : calcule le score, détermine si un bonbon spécial est créé,
   * endommage les obstacles adjacents (réglisse, chocolat), et nettoie les cases.
   */
  _processMatchGroups(matchGroups, events, stateTracker) {
    const allCellsToClear = [];
    const protectedPositions = new Set(); // Cases où un nouveau spécial vient d'être créé ce tour
    const adjacentObstacleHits = new Set();

    for (const group of matchGroups) {
      const count = group.positions.length;
      const specialToCreate = determineSpecialToCreate(group);

      // Choisir la case où apparaît le bonbon spécial :
      // sur la case de l'échange du joueur si elle fait partie du match, sinon au centre du match.
      let spawnPos = null;
      if (specialToCreate) {
        for (const sp of stateTracker.swappedPositions) {
          if (group.positions.some(p => p.r === sp.r && p.c === sp.c)) {
            spawnPos = { r: sp.r, c: sp.c };
            break;
          }
        }
        if (!spawnPos) {
          // Si L/T/Croix, privilégier l'intersection, sinon le milieu
          spawnPos = this._findIntersectionOrCenter(group.positions);
        }
      }

      // Événement 'match'
      events.push({
        type: 'match',
        positions: group.positions,
        color: group.color,
        count,
        cascadeLevel: stateTracker.cascadeLevel
      });

      // Score du match : (N * 60 + (N - 3) * 60) * multiplicateur
      const rawMatchScore = count * BASE_CANDY_SCORE + Math.max(0, count - 3) * BASE_CANDY_SCORE;
      const centerPos = spawnPos || group.positions[Math.floor(group.positions.length / 2)];
      this._addScore(rawMatchScore, centerPos, events, stateTracker.cascadeLevel);

      // Obstacles adjacents (réglisse et chocolat se brisent au contact d'un match orthogonal)
      for (const pos of group.positions) {
        const neighbors = [
          { r: pos.r - 1, c: pos.c },
          { r: pos.r + 1, c: pos.c },
          { r: pos.r, c: pos.c - 1 },
          { r: pos.r, c: pos.c + 1 }
        ];
        for (const nb of neighbors) {
          const nbCell = this.getCell(nb.r, nb.c);
          if (nbCell && nbCell.active && nbCell.obstacle) {
            adjacentObstacleHits.add(`${nb.r},${nb.c}`);
          }
        }
      }

      // Si un spécial est créé sur spawnPos :
      if (specialToCreate && spawnPos) {
        const spawnKey = `${spawnPos.r},${spawnPos.c}`;
        protectedPositions.add(spawnKey);

        // Nettoyer d'abord les autres cases du groupe
        for (const pos of group.positions) {
          if (pos.r === spawnPos.r && pos.c === spawnPos.c) continue;
          allCellsToClear.push(pos);
        }

        // Sur la case du spécial créé : si elle avait de la glace ou de la gelée, le match la brise aussi
        const spawnCell = this.getCell(spawnPos.r, spawnPos.c);
        this._damageCellLayers(spawnCell, events, stateTracker);

        // Si la case contenait DÉJÀ un bonbon spécial avant d'être remplacée, on l'active !
        if (spawnCell.candy && spawnCell.candy.special && spawnCell.candy.special !== SPECIAL_TYPES.INGREDIENT) {
          this._triggerSingleSpecial(spawnPos.r, spawnPos.c, spawnCell.candy, group.color, events, stateTracker);
        }

        // Créer le nouveau bonbon spécial
        const newColor = specialToCreate === SPECIAL_TYPES.COLOR_BOMB ? -1 : group.color;
        spawnCell.candy = createCandy(newColor, specialToCreate);
        const createBonus = SPECIAL_SCORES.CREATE[specialToCreate] || 150;
        this._addScore(createBonus, spawnPos, events, stateTracker.cascadeLevel);

        // Compter aussi le bonbon qui fusionne dans les objectifs de couleur
        this._incrementGoal('color', group.color, 1, events);

        events.push({
          type: 'special_created',
          position: spawnPos,
          special: specialToCreate,
          color: newColor,
          candy: JSON.parse(JSON.stringify(spawnCell.candy))
        });
      } else {
        for (const pos of group.positions) {
          allCellsToClear.push(pos);
        }
      }
    }

    // Détruire les obstacles adjacents touchés par les matchs
    for (const key of adjacentObstacleHits) {
      const [r, c] = key.split(',').map(Number);
      const cell = this.getCell(r, c);
      if (cell && cell.obstacle) {
        this._destroyObstacleOnCell(cell, events, stateTracker);
      }
    }

    // Nettoyer toutes les cases des matchs (avec réactions en chaîne des spéciaux touchés)
    this._clearPositions(allCellsToClear, events, stateTracker, {
      fromSpecial: false,
      protectedPositions
    });
  }

  _findIntersectionOrCenter(positions) {
    // Cherche une case qui a à la fois un voisin H et un voisin V dans le groupe
    for (const p of positions) {
      const hasH = positions.some(o => o.r === p.r && Math.abs(o.c - p.c) === 1);
      const hasV = positions.some(o => o.c === p.c && Math.abs(o.r - p.r) === 1);
      if (hasH && hasV) return { r: p.r, c: p.c };
    }
    return { ...positions[Math.floor(positions.length / 2)] };
  }

  /**
   * Nettoie une liste de positions avec file d'attente sans récursion infinie
   * pour gérer les réactions en chaîne des bonbons spéciaux touchés.
   */
  _clearPositions(initialPositions, events, stateTracker, options = {}) {
    const protectedPositions = options.protectedPositions || new Set();
    const queue = [...initialPositions];
    const processedInChain = new Set();
    const clearedList = [];

    while (queue.length > 0) {
      const pos = queue.shift();
      const key = `${pos.r},${pos.c}`;
      if (processedInChain.has(key) || protectedPositions.has(key)) continue;
      processedInChain.add(key);

      const cell = this.getCell(pos.r, pos.c);
      if (!cell || !cell.active) continue;

      // 1. Si la case a de la glace par-dessus : la glace absorbe le coup et se brise d'une couche
      if (cell.ice > 0) {
        cell.ice--;
        this._addScore(80, pos, events, stateTracker.cascadeLevel);
        this._incrementGoal('ice', null, 1, events);
        clearedList.push({ r: pos.r, c: pos.c, layerCleared: 'ice', remainingIce: cell.ice });
        continue;
      }

      // 2. Si la case contient un obstacle (réglisse ou chocolat)
      if (cell.obstacle) {
        this._destroyObstacleOnCell(cell, events, stateTracker);
        clearedList.push({ r: pos.r, c: pos.c, layerCleared: 'obstacle' });
        continue;
      }

      // 3. Si le bonbon est enchaîné (locked) : briser la chaîne sans détruire le bonbon
      if (cell.candy && cell.candy.locked > 0) {
        cell.candy.locked--;
        this._addScore(80, pos, events, stateTracker.cascadeLevel);
        this._incrementGoal('locked', null, 1, events);
        clearedList.push({ r: pos.r, c: pos.c, layerCleared: 'lock' });
        continue;
      }

      // 4. Les ingrédients ne peuvent pas être détruits par des matchs ou spéciaux
      if (cell.candy && cell.candy.special === SPECIAL_TYPES.INGREDIENT) {
        continue;
      }

      // 5. Gelée au sol
      this._damageCellLayers(cell, events, stateTracker);

      if (!cell.candy) continue;

      const candy = cell.candy;

      // Si c'est un bonbon spécial, il s'active en réaction en chaîne !
      if (candy.special && candy.special !== SPECIAL_TYPES.INGREDIENT && !options.suppressChainReaction) {
        // Cas particulier : l'Emballé qui explose en phase 1 reste sur place sous forme "secondBlastPending"
        if (candy.special === SPECIAL_TYPES.WRAPPED && !candy.secondBlastPending) {
          const targets = getSpecialTargets(this.board, pos.r, pos.c, candy);
          this._addScore(SPECIAL_SCORES.ACTIVATE[SPECIAL_TYPES.WRAPPED], pos, events, stateTracker.cascadeLevel);
          events.push({
            type: 'special_activated',
            special: SPECIAL_TYPES.WRAPPED,
            phase: 1,
            position: { r: pos.r, c: pos.c },
            effectType: targets.effectType
          });
          candy.special = SPECIAL_TYPES.NONE;
          candy.secondBlastPending = true;
          for (const t of targets.positions) {
            if (t.r !== pos.r || t.c !== pos.c) {
              queue.push(t);
            }
          }
          continue;
        } else {
          // Rayé, Bombe Couleur, Nova
          const targets = getSpecialTargets(this.board, pos.r, pos.c, candy);
          const actScore = SPECIAL_SCORES.ACTIVATE[candy.special] || 180;
          this._addScore(actScore, pos, events, stateTracker.cascadeLevel);
          events.push({
            type: 'special_activated',
            special: candy.special,
            position: { r: pos.r, c: pos.c },
            effectType: targets.effectType,
            targetColor: targets.targetColor
          });
          for (const t of targets.positions) {
            queue.push(t);
          }
        }
      }

      // Comptabiliser le bonbon détruit
      if (candy.color >= 0) {
        this._incrementGoal('color', candy.color, 1, events);
      }
      if (options.fromSpecial) {
        this._addScore(BASE_CANDY_SCORE, pos, events, stateTracker.cascadeLevel);
      }

      cell.candy = null;
      clearedList.push({
        r: pos.r,
        c: pos.c,
        candy: { id: candy.id, color: candy.color, special: candy.special }
      });
    }

    if (clearedList.length > 0) {
      events.push({
        type: 'clear',
        cells: clearedList,
        cascadeLevel: stateTracker.cascadeLevel
      });
    }
  }

  _triggerSingleSpecial(r, c, candy, matchColor, events, stateTracker) {
    const targets = getSpecialTargets(this.board, r, c, candy, matchColor);
    const actScore = SPECIAL_SCORES.ACTIVATE[candy.special] || 180;
    this._addScore(actScore, { r, c }, events, stateTracker.cascadeLevel);
    events.push({
      type: 'special_activated',
      special: candy.special,
      position: { r, c },
      effectType: targets.effectType
    });
    this._clearPositions(targets.positions, events, stateTracker, { fromSpecial: true });
  }

  _damageCellLayers(cell, events, stateTracker) {
    if (!cell) return;
    if (cell.ice > 0) {
      cell.ice--;
      this._addScore(80, { r: cell.r, c: cell.c }, events, stateTracker.cascadeLevel);
      this._incrementGoal('ice', null, 1, events);
    } else if (cell.jelly > 0) {
      cell.jelly--;
      this._addScore(100, { r: cell.r, c: cell.c }, events, stateTracker.cascadeLevel);
      this._incrementGoal('jelly', null, 1, events);
    }
  }

  _destroyObstacleOnCell(cell, events, stateTracker) {
    if (!cell || !cell.obstacle) return;
    const obs = cell.obstacle;
    cell.obstacle = OBSTACLE_TYPES.NONE;
    if (obs === OBSTACLE_TYPES.CHOCOLATE) {
      stateTracker.chocolateDestroyedThisTurn = true;
      this._addScore(150, { r: cell.r, c: cell.c }, events, stateTracker.cascadeLevel);
      this._incrementGoal('chocolate', null, 1, events);
    } else if (obs === OBSTACLE_TYPES.LICORICE) {
      this._addScore(100, { r: cell.r, c: cell.c }, events, stateTracker.cascadeLevel);
      this._incrementGoal('licorice', null, 1, events);
    }
    events.push({
      type: 'clear',
      cells: [{ r: cell.r, c: cell.c, obstacleCleared: obs }]
    });
  }

  /**
   * Applique la gravité (chute verticale, téléporteurs, et glissement diagonal autour des obstacles/trous),
   * collecte les ingrédients arrivés en bas, et génère de nouveaux bonbons en haut.
   */
  _applyGravityAndRefill(events, stateTracker) {
    const allMovements = [];
    const allSpawns = [];

    // Collecter d'abord les ingrédients déjà sur une case de sortie
    this._collectIngredientsAtExits(events, stateTracker);

    let moved = true;
    let stepGuard = 0;

    while (moved && stepGuard < this.rows * 3) {
      moved = false;
      stepGuard++;

      // 1. Chute verticale directe (et par téléporteur) du bas vers le haut
      for (let r = this.rows - 1; r >= 0; r--) {
        for (let c = 0; c < this.cols; c++) {
          const target = this.board.grid[r][c];
          if (!this._canReceiveFallingCandy(target)) continue;

          // Si cette case a un portail d'entrée (portalFrom), elle reçoit depuis la source du portail
          if (target.portalFrom) {
            const src = this.getCell(target.portalFrom.r, target.portalFrom.c);
            if (src && this._canCandyFallFrom(src)) {
              target.candy = src.candy;
              src.candy = null;
              allMovements.push({
                candyId: target.candy.id,
                from: { r: src.r, c: src.c },
                to: { r: target.r, c: target.c },
                teleported: true
              });
              moved = true;
              continue;
            }
          }

          // Chercher directement au-dessus (en traversant les trous inactifs mais pas les obstacles)
          let srcR = r - 1;
          while (srcR >= 0 && !this.board.grid[srcR][c].active) {
            srcR--;
          }
          if (srcR >= 0) {
            const above = this.board.grid[srcR][c];
            if (this._canCandyFallFrom(above)) {
              target.candy = above.candy;
              above.candy = null;
              allMovements.push({
                candyId: target.candy.id,
                from: { r: srcR, c },
                to: { r, c }
              });
              moved = true;
            }
          }
        }
      }

      // 2. Si une case vide est sous un obstacle/verrou, tenter le glissement en diagonale (haut-gauche ou haut-droite)
      if (!moved) {
        for (let r = this.rows - 1; r >= 1; r--) {
          for (let c = 0; c < this.cols; c++) {
            const target = this.board.grid[r][c];
            if (!this._canReceiveFallingCandy(target)) continue;
            if (!this._isBlockedFromTop(r, c)) continue;

            const diagCols = this.rng() < 0.5 ? [c - 1, c + 1] : [c + 1, c - 1];
            for (const dc of diagCols) {
              const diagCell = this.getCell(r - 1, dc);
              if (diagCell && this._canCandyFallFrom(diagCell)) {
                target.candy = diagCell.candy;
                diagCell.candy = null;
                allMovements.push({
                  candyId: target.candy.id,
                  from: { r: r - 1, c: dc },
                  to: { r, c },
                  diagonal: true
                });
                moved = true;
                break;
              }
            }
          }
        }
      }

      // 3. Remplir la case active la plus haute de chaque colonne si elle est vide
      for (let c = 0; c < this.cols; c++) {
        let topR = -1;
        for (let r = 0; r < this.rows; r++) {
          if (this.board.grid[r][c].active) {
            topR = r;
            break;
          }
        }
        if (topR >= 0) {
          const topCell = this.board.grid[topR][c];
          if (this._canReceiveFallingCandy(topCell) && !topCell.portalFrom) {
            const newCandy = this._generateNewCandyForTop(topR, c);
            topCell.candy = newCandy;
            allSpawns.push({
              r: topR,
              c,
              candy: JSON.parse(JSON.stringify(newCandy))
            });
            moved = true;
          }
        }
      }

      // Vérifier si un ingrédient vient d'atteindre une sortie en bas
      if (this._collectIngredientsAtExits(events, stateTracker)) {
        moved = true;
      }
    }

    if (allMovements.length > 0) {
      events.push({
        type: 'gravity',
        movements: allMovements
      });
    }
    if (allSpawns.length > 0) {
      events.push({
        type: 'refill',
        spawns: allSpawns
      });
    }
  }

  _canReceiveFallingCandy(cell) {
    if (!cell || !cell.active || cell.obstacle) return false;
    return cell.candy === null;
  }

  _canCandyFallFrom(cell) {
    if (!cell || !cell.active || cell.obstacle || cell.ice > 0) return false;
    if (!cell.candy || cell.candy.locked > 0) return false;
    return true;
  }

  /**
   * Vérifie si la colonne au-dessus de (r, c) est bloquée par un obstacle, de la glace ou un bonbon verrouillé.
   */
  _isBlockedFromTop(r, c) {
    for (let ur = r - 1; ur >= 0; ur--) {
      const cell = this.board.grid[ur][c];
      if (!cell.active) continue;
      if (cell.obstacle || cell.ice > 0 || (cell.candy && cell.candy.locked > 0)) {
        return true;
      }
      if (cell.candy) return false;
    }
    return false;
  }

  _generateNewCandyForTop() {
    // Si on doit encore faire apparaître des ingrédients et qu'il y en a moins de 2 sur le plateau
    if (this.ingredientsToSpawn > 0 && this.ingredientsOnBoard < 2 && this.rng() < 0.25) {
      this.ingredientsToSpawn--;
      this.ingredientsOnBoard++;
      const ingType = this.rng() < 0.5 ? 'cherry' : 'hazelnut';
      return createCandy(-1, SPECIAL_TYPES.INGREDIENT, { ingredientType: ingType });
    }
    const color = Math.floor(this.rng() * this.numColors);
    return createCandy(color, SPECIAL_TYPES.NONE);
  }

  _collectIngredientsAtExits(events, stateTracker) {
    let collectedAny = false;
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const cell = this.board.grid[r][c];
        if (cell.active && cell.isExit && cell.candy && cell.candy.special === SPECIAL_TYPES.INGREDIENT) {
          const ingCandy = cell.candy;
          cell.candy = null;
          this.ingredientsOnBoard = Math.max(0, this.ingredientsOnBoard - 1);
          collectedAny = true;

          this._addScore(1000, { r, c }, events, stateTracker.cascadeLevel);
          this._incrementGoal('ingredients', null, 1, events);
          events.push({
            type: 'clear',
            cells: [{ r, c, ingredientCollected: true, candy: ingCandy }]
          });
        }
      }
    }
    return collectedAny;
  }

  /**
   * Maintenance de fin de tour :
   * 1. Si aucun chocolat n'a été détruit ce tour et qu'il reste du chocolat sur le plateau,
   *    1 carré de chocolat se propage sur un bonbon normal adjacent.
   * 2. Les bombes à retardement sur le plateau décrémentent de 1 coup.
   * 3. Si aucun coup valide n'est possible, mélange automatique.
   * 4. Vérifie les conditions de victoire ou de défaite (et déclenche "Sucre à gogo" si gagné).
   */
  _endOfTurnMaintenance(events, stateTracker) {
    // 1. Propagation du chocolat
    if (!stateTracker.chocolateDestroyedThisTurn) {
      const chocCandidates = [];
      for (let r = 0; r < this.rows; r++) {
        for (let c = 0; c < this.cols; c++) {
          const cell = this.board.grid[r][c];
          if (cell.active && cell.obstacle === OBSTACLE_TYPES.CHOCOLATE) {
            const dirs = [
              { r: r - 1, c },
              { r: r + 1, c },
              { r, c: c - 1 },
              { r, c: c + 1 }
            ];
            for (const nb of dirs) {
              const nbCell = this.getCell(nb.r, nb.c);
              if (
                nbCell &&
                nbCell.active &&
                !nbCell.obstacle &&
                nbCell.ice === 0 &&
                nbCell.candy &&
                !nbCell.candy.special &&
                nbCell.candy.locked === 0
              ) {
                chocCandidates.push({ from: { r, c }, to: nbCell });
              }
            }
          }
        }
      }
      if (chocCandidates.length > 0) {
        const pick = chocCandidates[Math.floor(this.rng() * chocCandidates.length)];
        pick.to.obstacle = OBSTACLE_TYPES.CHOCOLATE;
        pick.to.candy = null;
        // Si l'objectif est de détruire tout le chocolat, on ajuste ou garde le suivi
        events.push({
          type: 'chocolate_spread',
          from: pick.from,
          to: { r: pick.to.r, c: pick.to.c }
        });
      }
    }

    // 2. Bombes à retardement
    let bombExploded = false;
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const cell = this.board.grid[r][c];
        if (cell.active && cell.candy && cell.candy.bombTimer !== null) {
          cell.candy.bombTimer--;
          events.push({
            type: 'bomb_tick',
            position: { r, c },
            timer: cell.candy.bombTimer
          });
          if (cell.candy.bombTimer <= 0) {
            bombExploded = true;
          }
        }
      }
    }

    if (bombExploded) {
      this.status = 'LOST';
      events.push({
        type: 'level_lost',
        reason: 'bomb_exploded',
        score: this.score
      });
      return;
    }

    // 3. Mélange automatique si aucun coup possible
    if (this.findValidMoves().length === 0) {
      this.shuffleBoard(events);
    }

    // 4. Vérification victoire / défaite
    this._checkWinLose(events);
  }

  _addScore(basePoints, position, events, cascadeLevel = 1) {
    const multiplier = 1 + 0.5 * Math.max(0, cascadeLevel - 1);
    const points = Math.round(basePoints * multiplier);
    this.score += points;

    // Mise à jour de l'objectif de score s'il existe
    for (const g of this.goals) {
      if (g.type === 'score') {
        g.current = Math.min(g.target, this.score);
      }
    }

    events.push({
      type: 'score',
      points,
      totalScore: this.score,
      multiplier,
      position: position || { r: Math.floor(this.rows / 2), c: Math.floor(this.cols / 2) }
    });
  }

  _incrementGoal(type, color, amount, events) {
    for (const g of this.goals) {
      if (g.type === type) {
        if (type === 'color' && g.color !== undefined && g.color !== color) continue;
        g.current = Math.min(g.target, g.current + amount);
        events.push({
          type: 'goal_progress',
          goalType: g.type,
          color: g.color,
          current: g.current,
          target: g.target
        });
      }
    }
  }

  areAllGoalsMet() {
    for (const g of this.goals) {
      if (g.type === 'score') {
        if (this.score < g.target) return false;
      } else if (g.type === 'jelly') {
        // Vérifier qu'il ne reste plus aucune gelée sur la grille
        for (let r = 0; r < this.rows; r++) {
          for (let c = 0; c < this.cols; c++) {
            if (this.board.grid[r][c].jelly > 0) return false;
          }
        }
      } else if (g.type === 'chocolate') {
        // Soit nombre cible atteint, soit plus aucun chocolat sur la grille
        let remainingChoc = 0;
        for (let r = 0; r < this.rows; r++) {
          for (let c = 0; c < this.cols; c++) {
            if (this.board.grid[r][c].obstacle === OBSTACLE_TYPES.CHOCOLATE) remainingChoc++;
          }
        }
        if (remainingChoc > 0 && g.current < g.target) return false;
      } else {
        if (g.current < g.target) return false;
      }
    }
    return true;
  }

  getStarsEarned() {
    let stars = 0;
    for (let i = 0; i < this.starThresholds.length; i++) {
      if (this.score >= this.starThresholds[i]) stars = i + 1;
    }
    return stars;
  }

  _checkWinLose(events) {
    if (this.status !== 'PLAYING') return;

    if (this.areAllGoalsMet()) {
      this.status = 'WON';

      // "Sucre à gogo" : chaque coup restant se transforme en bonbon rayé et donne +2500 pts
      const bonusMoves = this.movesLeft;
      const bonusPositions = [];
      if (bonusMoves > 0) {
        const candidates = [];
        for (let r = 0; r < this.rows; r++) {
          for (let c = 0; c < this.cols; c++) {
            const cell = this.board.grid[r][c];
            if (cell.active && cell.candy && !cell.candy.special) {
              candidates.push({ r, c });
            }
          }
        }
        for (let i = 0; i < bonusMoves; i++) {
          const pos = candidates.length > 0
            ? candidates[Math.floor(this.rng() * candidates.length)]
            : { r: Math.floor(this.rows / 2), c: Math.floor(this.cols / 2) };
          bonusPositions.push(pos);
          this._addScore(2500, pos, events, 1);
        }
        this.movesLeft = 0;
      }

      // Garantir au moins 1 étoile en cas de victoire
      if (this.score < this.starThresholds[0]) {
        this.score = this.starThresholds[0];
      }

      events.push({
        type: 'level_won',
        score: this.score,
        stars: this.getStarsEarned(),
        bonusMoves,
        bonusPositions
      });
      return;
    }

    if (this.movesLeft <= 0) {
      this.status = 'LOST';
      events.push({
        type: 'level_lost',
        reason: 'out_of_moves',
        score: this.score
      });
    }
  }

  /**
   * Pour les niveaux chronométrés : appelé par la boucle principale chaque seconde.
   */
  tickTimer(seconds = 1) {
    const events = [];
    if (this.status !== 'PLAYING' || this.timeLeft === null) return events;
    this.timeLeft = Math.max(0, this.timeLeft - seconds);
    if (this.areAllGoalsMet()) {
      this._checkWinLose(events);
    } else if (this.timeLeft <= 0) {
      this.status = 'LOST';
      events.push({
        type: 'level_lost',
        reason: 'time_up',
        score: this.score
      });
    }
    return events;
  }
}

/* ============================================================================
 * API FONCTIONNELLE DE COMPATIBILITÉ (pour Engine.test.js / node --test)
 * ============================================================================
 * Expose : createGame, attemptSwap, possibleMoves, findRuns, shuffleBoard,
 * cloneState, boardToText, SPECIAL, STATUS, EVENT, GOAL
 * ============================================================================
 */

export const SPECIAL = {
  NONE: null,
  STRIPED_ROW: 'striped_r',
  STRIPED_COL: 'striped_c',
  WRAPPED: 'wrapped',
  BOMB: 'bomb',
  NOVA: 'nova'
};

export const STATUS = {
  PLAYING: 'playing',
  WON: 'won',
  LOST: 'lost'
};

export const EVENT = {
  SWAP: 'swap',
  INVALID_SWAP: 'invalid_swap',
  MATCH: 'match',
  SPECIAL_CREATED: 'special_created',
  SPECIAL_ACTIVATED: 'special_activated',
  COMBO: 'combo',
  CONVERTED: 'converted',
  CLEAR: 'clear',
  GRAVITY: 'gravity',
  REFILL: 'refill',
  CASCADE: 'cascade',
  SCORE: 'score',
  SHUFFLE: 'shuffle',
  JELLY_HIT: 'jelly_hit',
  BLOCK_DESTROYED: 'block_destroyed',
  INGREDIENT_EXIT: 'ingredient_exit',
  GOAL_PROGRESS: 'goal_progress',
  BONUS_START: 'bonus_start',
  LEVEL_WON: 'level_won',
  LEVEL_LOST: 'level_lost'
};

export const GOAL = {
  SCORE: 'score',
  JELLY: 'jelly',
  BLOCKS: 'blocks',
  COLLECT: 'collect',
  INGREDIENTS: 'ingredients'
};

function fnRngNext(state) {
  let a = (state.rngState = (state.rngState + 0x6D2B79F5) >>> 0);
  let t = Math.imul(a ^ (a >>> 15), a | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function fnIdx(s, r, c) {
  return r * s.cols + c;
}

function fnInBounds(s, r, c) {
  return r >= 0 && r < s.rows && c >= 0 && c < s.cols;
}

function fnCell(s, r, c) {
  if (!fnInBounds(s, r, c)) return null;
  return s.cells[fnIdx(s, r, c)];
}

function fnNewCandy(s, color, special = null, ingredient = false) {
  return {
    id: s.nextId++,
    color,
    special,
    ingredient: Boolean(ingredient)
  };
}

function fnParseToken(s, token, r, c) {
  const cell = {
    r,
    c,
    hole: false,
    jelly: 0,
    block: 0,
    candy: null
  };
  const str = String(token).trim();
  if (str === '#') {
    cell.hole = true;
    return cell;
  }
  if (str === 'L') {
    cell.block = 1;
    return cell;
  }
  if (str === 'I') {
    cell.candy = fnNewCandy(s, -1, null, true);
    return cell;
  }
  if (str === 'B') {
    cell.candy = fnNewCandy(s, -1, SPECIAL.BOMB, false);
    return cell;
  }
  const color = parseInt(str[0], 10);
  let sp = null;
  if (str.length > 1) {
    const mod = str[1];
    if (mod === 'r') sp = SPECIAL.STRIPED_ROW;
    else if (mod === 'c') sp = SPECIAL.STRIPED_COL;
    else if (mod === 'w') sp = SPECIAL.WRAPPED;
  }
  cell.candy = fnNewCandy(s, isNaN(color) ? 0 : color, sp, false);
  return cell;
}

/**
 * Crée un état de jeu pur et sérialisable en JSON.
 */
export function createGame(config = {}) {
  const boardInput = config.board || null;
  const rows = boardInput ? boardInput.length : (config.rows || 9);
  const cols = boardInput ? boardInput[0].length : (config.cols || 9);
  const colors = config.colors || config.numColors || 6;
  const seed = config.seed !== undefined ? config.seed : 1;

  const s = {
    rows,
    cols,
    colors,
    seed,
    rngState: (seed >>> 0) || 1,
    nextId: 1,
    moves: config.moves !== undefined ? config.moves : 20,
    score: 0,
    stars: 0,
    starThresholds: config.stars || [1000, 2500, 5000],
    status: STATUS.PLAYING,
    ingredientsCollected: 0,
    pendingBlasts: [],
    goals: (config.goals || [{ type: GOAL.SCORE, target: 1000 }]).map(g => ({
      ...g,
      current: 0
    })),
    cells: []
  };

  if (boardInput) {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        s.cells.push(fnParseToken(s, boardInput[r][c], r, c));
      }
    }
  } else {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        s.cells.push({ r, c, hole: false, jelly: 0, block: 0, candy: null });
      }
    }
    fnFillInitialRandom(s);
  }

  if (Array.isArray(config.jelly)) {
    for (let r = 0; r < Math.min(rows, config.jelly.length); r++) {
      const rowStr = String(config.jelly[r]);
      for (let c = 0; c < Math.min(cols, rowStr.length); c++) {
        const val = parseInt(rowStr[c], 10) || 0;
        fnCell(s, r, c).jelly = val;
      }
    }
  }

  // Initialiser les cibles implicites pour JELLY et BLOCKS
  for (const g of s.goals) {
    if (g.type === GOAL.JELLY && !g.target) {
      g.target = s.cells.reduce((acc, cell) => acc + cell.jelly, 0);
    }
    if (g.type === GOAL.BLOCKS && !g.target) {
      g.target = s.cells.reduce((acc, cell) => acc + (cell.block > 0 ? 1 : 0), 0);
    }
  }

  return s;
}

function fnFillInitialRandom(s) {
  let attempts = 0;
  do {
    s.nextId = 1;
    for (let r = 0; r < s.rows; r++) {
      for (let c = 0; c < s.cols; c++) {
        const cell = fnCell(s, r, c);
        if (cell.hole || cell.block > 0) {
          cell.candy = null;
          continue;
        }
        const forbidden = new Set();
        if (c >= 2) {
          const c1 = fnCell(s, r, c - 1).candy;
          const c2 = fnCell(s, r, c - 2).candy;
          if (c1 && c2 && c1.color === c2.color && c1.color >= 0) forbidden.add(c1.color);
        }
        if (r >= 2) {
          const r1 = fnCell(s, r - 1, c).candy;
          const r2 = fnCell(s, r - 2, c).candy;
          if (r1 && r2 && r1.color === r2.color && r1.color >= 0) forbidden.add(r1.color);
        }
        const avail = [];
        for (let col = 0; col < s.colors; col++) {
          if (!forbidden.has(col)) avail.push(col);
        }
        const chosen = avail[Math.floor(fnRngNext(s) * avail.length)];
        cell.candy = fnNewCandy(s, chosen, null, false);
      }
    }
    attempts++;
  } while ((findRuns(s).length > 0 || possibleMoves(s).length === 0) && attempts < 40);
}

function fnCanMatch(cell) {
  if (!cell || cell.hole || cell.block > 0 || !cell.candy) return false;
  if (cell.candy.ingredient || cell.candy.special === SPECIAL.BOMB || cell.candy.color < 0) return false;
  return true;
}

function fnCanSwap(cell) {
  if (!cell || cell.hole || cell.block > 0 || !cell.candy) return false;
  return true;
}

/**
 * Trouve tous les alignements horizontaux et verticaux >= 3.
 */
export function findRuns(s) {
  const runs = [];
  // Horizontaux
  for (let r = 0; r < s.rows; r++) {
    let c = 0;
    while (c < s.cols) {
      const start = fnCell(s, r, c);
      if (!fnCanMatch(start)) { c++; continue; }
      const color = start.candy.color;
      let end = c + 1;
      while (end < s.cols && fnCanMatch(fnCell(s, r, end)) && fnCell(s, r, end).candy.color === color) end++;
      if (end - c >= 3) {
        const cells = [];
        for (let k = c; k < end; k++) cells.push([r, k]);
        runs.push({ dir: 'h', color, cells });
      }
      c = end;
    }
  }
  // Verticaux
  for (let c = 0; c < s.cols; c++) {
    let r = 0;
    while (r < s.rows) {
      const start = fnCell(s, r, c);
      if (!fnCanMatch(start)) { r++; continue; }
      const color = start.candy.color;
      let end = r + 1;
      while (end < s.rows && fnCanMatch(fnCell(s, end, c)) && fnCell(s, end, c).candy.color === color) end++;
      if (end - r >= 3) {
        const cells = [];
        for (let k = r; k < end; k++) cells.push([k, c]);
        runs.push({ dir: 'v', color, cells });
      }
      r = end;
    }
  }
  return runs;
}

function fnIsComboPair(cA, cB) {
  if (!cA || !cB || cA.ingredient || cB.ingredient) return false;
  if (cA.special === SPECIAL.BOMB || cB.special === SPECIAL.BOMB) return true;
  return Boolean(cA.special && cB.special);
}

/**
 * Liste tous les échanges valides sur l'état s.
 */
export function possibleMoves(s) {
  const list = [];
  const dirs = [[0, 1], [1, 0]];
  for (let r = 0; r < s.rows; r++) {
    for (let c = 0; c < s.cols; c++) {
      const cellA = fnCell(s, r, c);
      if (!fnCanSwap(cellA)) continue;
      for (const [dr, dc] of dirs) {
        const nr = r + dr;
        const nc = c + dc;
        const cellB = fnCell(s, nr, nc);
        if (!fnCanSwap(cellB)) continue;

        if (fnIsComboPair(cellA.candy, cellB.candy)) {
          list.push({ a: [r, c], b: [nr, nc] });
          continue;
        }
        const tmp = cellA.candy;
        cellA.candy = cellB.candy;
        cellB.candy = tmp;
        const hasMatch = findRuns(s).length > 0;
        cellB.candy = cellA.candy;
        cellA.candy = tmp;
        if (hasMatch) {
          list.push({ a: [r, c], b: [nr, nc] });
        }
      }
    }
  }
  return list;
}

/**
 * Mélange les bonbons normaux sur place sans créer de match immédiat et en garantissant >= 1 coup possible.
 */
export function shuffleBoard(s, events = []) {
  const swappableCells = s.cells.filter(c => !c.hole && c.block === 0 && c.candy && !c.candy.ingredient);
  const candies = swappableCells.map(c => c.candy);

  let tries = 0;
  do {
    for (let i = candies.length - 1; i > 0; i--) {
      const j = Math.floor(fnRngNext(s) * (i + 1));
      const tmp = candies[i];
      candies[i] = candies[j];
      candies[j] = tmp;
    }
    swappableCells.forEach((cell, idx) => {
      cell.candy = candies[idx];
    });
    tries++;
  } while ((findRuns(s).length > 0 || possibleMoves(s).length === 0) && tries < 80);

  if (findRuns(s).length > 0 || possibleMoves(s).length === 0) {
    // Fallback déterministe : forcer un coup valide sans match
    for (let i = 0; i < swappableCells.length; i++) {
      swappableCells[i].candy.color = (swappableCells[i].r + 2 * swappableCells[i].c) % s.colors;
    }
    if (swappableCells.length >= 4) {
      const c0 = swappableCells[0].candy.color;
      const cell00 = fnCell(s, 0, 0);
      const cell01 = fnCell(s, 0, 1);
      const cell12 = fnCell(s, 1, 2);
      if (cell00?.candy && cell01?.candy && cell12?.candy) {
        cell00.candy.color = c0;
        cell01.candy.color = c0;
        cell12.candy.color = c0;
      }
    }
  }

  events.push({ type: EVENT.SHUFFLE });
  return events;
}

/**
 * Tente un échange entre a = [r1, c1] et b = [r2, c2].
 */
export function attemptSwap(s, a, b) {
  const events = [];
  if (s.status !== STATUS.PLAYING) {
    return { ok: false, reason: 'game_over', events };
  }
  const [r1, c1] = a;
  const [r2, c2] = b;
  if (!fnInBounds(s, r1, c1) || !fnInBounds(s, r2, c2)) {
    return { ok: false, reason: 'out_of_bounds', events };
  }
  if (Math.abs(r1 - r2) + Math.abs(c1 - c2) !== 1) {
    return { ok: false, reason: 'not_adjacent', events };
  }

  const cellA = fnCell(s, r1, c1);
  const cellB = fnCell(s, r2, c2);
  if (!fnCanSwap(cellA) || !fnCanSwap(cellB)) {
    return { ok: false, reason: 'blocked', events };
  }

  // Échanger
  const tmp = cellA.candy;
  cellA.candy = cellB.candy;
  cellB.candy = tmp;

  const isCombo = fnIsComboPair(cellA.candy, cellB.candy);
  const runs = isCombo ? [] : findRuns(s);

  if (!isCombo && runs.length === 0) {
    // Annuler sans modifier l'état ni le compteur de coups
    cellB.candy = cellA.candy;
    cellA.candy = tmp;
    events.push({ type: EVENT.INVALID_SWAP, a, b, reason: 'no_match' });
    return { ok: false, reason: 'no_match', events };
  }

  s.moves = Math.max(0, s.moves - 1);
  events.push({ type: EVENT.SWAP, a, b, moves: s.moves });

  if (isCombo) {
    fnExecuteCombo(s, a, b, events);
    fnSettleBoard(s, events, [a, b], 1);
  } else {
    fnSettleBoard(s, events, [a, b], 0);
  }

  // Si aucun coup possible après stabilisation, mélanger automatiquement
  if (s.status === STATUS.PLAYING && possibleMoves(s).length === 0) {
    shuffleBoard(s, events);
  }

  fnCheckWinLose(s, events);
  return { ok: true, events };
}

function fnGroupConnectedRuns(runs) {
  const used = new Array(runs.length).fill(false);
  const groups = [];

  const share = (rA, rB) => {
    if (rA.color !== rB.color) return false;
    return rA.cells.some(([ar, ac]) => rB.cells.some(([br, bc]) => ar === br && ac === bc));
  };

  for (let i = 0; i < runs.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const queue = [runs[i]];
    const comp = [runs[i]];
    while (queue.length > 0) {
      const cur = queue.shift();
      for (let j = 0; j < runs.length; j++) {
        if (!used[j] && share(cur, runs[j])) {
          used[j] = true;
          queue.push(runs[j]);
          comp.push(runs[j]);
        }
      }
    }
    const cellMap = new Map();
    let hasH = false;
    let hasV = false;
    let maxLen = 0;
    let mainDir = comp[0].dir;
    for (const r of comp) {
      if (r.dir === 'h') hasH = true;
      if (r.dir === 'v') hasV = true;
      if (r.cells.length > maxLen) {
        maxLen = r.cells.length;
        mainDir = r.dir;
      }
      for (const pos of r.cells) cellMap.set(`${pos[0]},${pos[1]}`, pos);
    }
    groups.push({
      color: comp[0].color,
      cells: [...cellMap.values()],
      hasH,
      hasV,
      maxLen,
      mainDir
    });
  }
  return groups;
}

function fnExecuteCombo(s, a, b, events) {
  const cellA = fnCell(s, a[0], a[1]);
  const cellB = fnCell(s, b[0], b[1]);
  const cA = cellA.candy;
  const cB = cellB.candy;
  const spA = cA.special;
  const spB = cB.special;
  const isStr = (sp) => sp === SPECIAL.STRIPED_ROW || sp === SPECIAL.STRIPED_COL;

  // 1. Bombe + Bombe
  if (spA === SPECIAL.BOMB && spB === SPECIAL.BOMB) {
    events.push({ type: EVENT.COMBO, kind: 'bomb_bomb', a, b });
    cA.special = null;
    cB.special = null;
    const all = [];
    for (let r = 0; r < s.rows; r++) {
      for (let c = 0; c < s.cols; c++) {
        const cell = fnCell(s, r, c);
        if (!cell.hole && cell.block === 0 && cell.candy && !cell.candy.ingredient) {
          all.push([r, c]);
        }
      }
    }
    fnClearCells(s, all, events, 1, false);
    return;
  }

  // 2. Bombe + (Normal | Rayé | Emballé)
  if (spA === SPECIAL.BOMB || spB === SPECIAL.BOMB) {
    const other = spA === SPECIAL.BOMB ? cB : cA;
    const targetColor = other.color;

    if (isStr(other.special)) {
      events.push({ type: EVENT.COMBO, kind: 'bomb_striped', a, b, color: targetColor });
      cA.special = null;
      cB.special = null;
      const converted = [];
      const toClear = [a, b];
      for (const cell of s.cells) {
        if (cell.candy && cell.candy.color === targetColor && !cell.candy.ingredient) {
          cell.candy.special = fnRngNext(s) < 0.5 ? SPECIAL.STRIPED_ROW : SPECIAL.STRIPED_COL;
          converted.push([cell.r, cell.c]);
          toClear.push([cell.r, cell.c]);
        }
      }
      events.push({ type: EVENT.CONVERTED, cells: converted, special: SPECIAL.STRIPED_ROW });
      fnClearCells(s, toClear, events, 1, false);
      return;
    }

    if (other.special === SPECIAL.WRAPPED) {
      events.push({ type: EVENT.COMBO, kind: 'bomb_wrapped', a, b, color: targetColor });
      cA.special = null;
      cB.special = null;
      const converted = [];
      const toClear = [a, b];
      for (const cell of s.cells) {
        if (cell.candy && cell.candy.color === targetColor && !cell.candy.ingredient) {
          cell.candy.special = SPECIAL.WRAPPED;
          converted.push([cell.r, cell.c]);
          toClear.push([cell.r, cell.c]);
        }
      }
      events.push({ type: EVENT.CONVERTED, cells: converted, special: SPECIAL.WRAPPED });
      fnClearCells(s, toClear, events, 1, false);
      return;
    }

    // Bombe + Bonbon normal
    events.push({ type: EVENT.COMBO, kind: 'bomb_color', a, b, color: targetColor });
    cA.special = null;
    cB.special = null;
    const targets = [a, b];
    for (const cell of s.cells) {
      if (cell.candy && cell.candy.color === targetColor && !cell.candy.ingredient) {
        targets.push([cell.r, cell.c]);
      }
    }
    fnClearCells(s, targets, events, 1, false);
    return;
  }

  // 3. Rayé + Rayé (ligne de a/b et colonne de b)
  if (isStr(spA) && isStr(spB)) {
    events.push({ type: EVENT.COMBO, kind: 'striped_striped', a, b });
    cA.special = null;
    cB.special = null;
    const targets = [];
    for (let c = 0; c < s.cols; c++) targets.push([b[0], c]);
    for (let r = 0; r < s.rows; r++) targets.push([r, b[1]]);
    fnClearCells(s, targets, events, 1, false);
    return;
  }

  // 4. Rayé + Emballé (3 lignes autour de b[0] et 3 colonnes autour de b[1], ou centre)
  if ((isStr(spA) && spB === SPECIAL.WRAPPED) || (spA === SPECIAL.WRAPPED && isStr(spB))) {
    events.push({ type: EVENT.COMBO, kind: 'striped_wrapped', a, b });
    cA.special = null;
    cB.special = null;
    const pivotR = a[0];
    const pivotC = b[1];
    const targets = [];
    for (let dr = -1; dr <= 1; dr++) {
      for (let c = 0; c < s.cols; c++) {
        if (fnInBounds(s, pivotR + dr, c)) targets.push([pivotR + dr, c]);
      }
    }
    for (let dc = -1; dc <= 1; dc++) {
      for (let r = 0; r < s.rows; r++) {
        if (fnInBounds(s, r, pivotC + dc)) targets.push([r, pivotC + dc]);
      }
    }
    fnClearCells(s, targets, events, 1, false);
    return;
  }

  // 5. Emballé + Emballé (explosion 5x5 autour de a ou b, puis seconde explosion)
  if (spA === SPECIAL.WRAPPED && spB === SPECIAL.WRAPPED) {
    events.push({ type: EVENT.COMBO, kind: 'wrapped_wrapped', a, b });
    cA.special = null;
    cB.special = null;
    const centerR = a[0];
    const centerC = a[1];
    const targets = [];
    for (let dr = -2; dr <= 2; dr++) {
      for (let dc = -2; dc <= 2; dc++) {
        if (fnInBounds(s, centerR + dr, centerC + dc)) {
          targets.push([centerR + dr, centerC + dc]);
        }
      }
    }
    s.pendingBlasts.push({ r: centerR, c: centerC, radius: 2 });
    fnClearCells(s, targets, events, 1, false);
  }
}

function fnSettleBoard(s, events, swappedPairs, startCascade = 0) {
  let cascade = startCascade;
  let swapped = swappedPairs || [];

  // Si on vient d'un combo, appliquer d'abord gravité + remplissage
  if (cascade > 0) {
    fnGravityAndRefill(s, events);
  }

  let guard = 0;
  while (guard++ < 50) {
    // 1. S'il y a des explosions secondaires en attente (emballés), les déclencher
    if (s.pendingBlasts.length > 0) {
      const blasts = s.pendingBlasts.splice(0, s.pendingBlasts.length);
      const blastTargets = [];
      for (const b of blasts) {
        const rad = b.radius || 1;
        for (let dr = -rad; dr <= rad; dr++) {
          for (let dc = -rad; dc <= rad; dc++) {
            if (fnInBounds(s, b.r + dr, b.c + dc)) {
              blastTargets.push([b.r + dr, b.c + dc]);
            }
          }
        }
      }
      fnClearCells(s, blastTargets, events, Math.max(1, cascade), false);
      fnGravityAndRefill(s, events);
    }

    const runs = findRuns(s);
    if (runs.length === 0 && s.pendingBlasts.length === 0) break;
    if (runs.length === 0) continue;

    cascade++;
    const groups = fnGroupConnectedRuns(runs);
    const toClear = [];
    const createdMap = new Map();

    for (const g of groups) {
      events.push({ type: EVENT.MATCH, cells: g.cells, color: g.color, cascade });

      // Déterminer si un spécial est créé
      let sp = null;
      if (g.maxLen >= 5) sp = SPECIAL.BOMB;
      else if (g.hasH && g.hasV) sp = SPECIAL.WRAPPED;
      else if (g.maxLen === 4) {
        // 4 en ligne horizontale -> rayé qui efface la colonne (STRIPED_COL)
        sp = g.mainDir === 'h' ? SPECIAL.STRIPED_COL : SPECIAL.STRIPED_ROW;
      }

      let spawnPos = null;
      if (sp) {
        for (const sw of swapped) {
          if (g.cells.some(([r, c]) => r === sw[0] && c === sw[1])) {
            spawnPos = sw;
            break;
          }
        }
        if (!spawnPos) {
          spawnPos = g.cells[Math.floor(g.cells.length / 2)];
        }
        createdMap.set(`${spawnPos[0]},${spawnPos[1]}`, {
          at: spawnPos,
          special: sp,
          color: sp === SPECIAL.BOMB ? -1 : g.color
        });
      }

      for (const pos of g.cells) {
        toClear.push(pos);
      }
    }

    fnClearCells(s, toClear, events, cascade, true, createdMap);

    // Poser les spéciaux nouvellement créés
    for (const info of createdMap.values()) {
      const cell = fnCell(s, info.at[0], info.at[1]);
      cell.candy = fnNewCandy(s, info.color, info.special, false);
      events.push({
        type: EVENT.SPECIAL_CREATED,
        at: info.at,
        special: info.special,
        color: info.color
      });
    }

    fnGravityAndRefill(s, events);
    swapped = [];
  }
}

function fnClearCells(s, initialCells, events, cascade, fromMatch = false, createdMap = new Map()) {
  const queue = [...initialCells];
  const visited = new Set();
  const clearedCells = [];
  const matchNeighborBlocks = new Set();

  if (fromMatch) {
    for (const [r, c] of initialCells) {
      for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const nb = fnCell(s, r + dr, c + dc);
        if (nb && nb.block > 0) {
          matchNeighborBlocks.add(`${r + dr},${c + dc}`);
        }
      }
    }
  }

  while (queue.length > 0) {
    const [r, c] = queue.shift();
    const key = `${r},${c}`;
    if (visited.has(key)) continue;
    visited.add(key);

    const cell = fnCell(s, r, c);
    if (!cell || cell.hole) continue;

    if (cell.block > 0) {
      cell.block = 0;
      events.push({ type: EVENT.BLOCK_DESTROYED, at: [r, c] });
      fnAddGoalProgress(s, GOAL.BLOCKS, null, 1, events);
      continue;
    }

    const candy = cell.candy;
    if (!candy || candy.ingredient) continue;

    if (cell.jelly > 0) {
      cell.jelly--;
      events.push({ type: EVENT.JELLY_HIT, at: [r, c], remaining: cell.jelly });
      fnAddGoalProgress(s, GOAL.JELLY, null, 1, events);
    }

    if (candy.special) {
      events.push({ type: EVENT.SPECIAL_ACTIVATED, at: [r, c], special: candy.special });
      if (candy.special === SPECIAL.STRIPED_ROW) {
        for (let col = 0; col < s.cols; col++) queue.push([r, col]);
      } else if (candy.special === SPECIAL.STRIPED_COL) {
        for (let row = 0; row < s.rows; row++) queue.push([row, c]);
      } else if (candy.special === SPECIAL.WRAPPED) {
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            if (fnInBounds(s, r + dr, c + dc)) queue.push([r + dr, c + dc]);
          }
        }
        s.pendingBlasts.push({ r, c, radius: 1 });
      } else if (candy.special === SPECIAL.BOMB) {
        let targetCol = 0;
        for (const cl of s.cells) {
          if (cl.candy && cl.candy.color >= 0 && !cl.candy.ingredient) {
            targetCol = cl.candy.color;
            break;
          }
        }
        for (const cl of s.cells) {
          if (cl.candy && cl.candy.color === targetCol && !cl.candy.ingredient) {
            queue.push([cl.r, cl.c]);
          }
        }
      }
    }

    if (candy.color >= 0) {
      fnAddGoalProgress(s, GOAL.COLLECT, candy.color, 1, events);
    }

    cell.candy = null;
    clearedCells.push({ at: [r, c], color: candy.color, special: candy.special });
  }

  for (const bKey of matchNeighborBlocks) {
    const [br, bc] = bKey.split(',').map(Number);
    const bCell = fnCell(s, br, bc);
    if (bCell && bCell.block > 0) {
      bCell.block = 0;
      events.push({ type: EVENT.BLOCK_DESTROYED, at: [br, bc] });
      fnAddGoalProgress(s, GOAL.BLOCKS, null, 1, events);
    }
  }

  if (clearedCells.length > 0) {
    const pts = Math.round(clearedCells.length * BASE_CANDY_SCORE * (1 + 0.5 * Math.max(0, cascade - 1)));
    s.score += pts;
    fnAddGoalProgress(s, GOAL.SCORE, null, pts, events);
    events.push({ type: EVENT.CLEAR, cells: clearedCells });
    events.push({ type: EVENT.SCORE, points: pts, total: s.score });
  }
}

function fnGravityAndRefill(s, events) {
  fnExtractIngredientsAtBottom(s, events);

  const moves = [];
  const spawns = [];
  let changed = true;
  let guard = 0;

  while (changed && guard++ < s.rows * 4) {
    changed = false;

    for (let r = s.rows - 1; r >= 1; r--) {
      for (let c = 0; c < s.cols; c++) {
        const dst = fnCell(s, r, c);
        if (dst.hole || dst.block > 0 || dst.candy) continue;

        const src = fnCell(s, r - 1, c);
        if (src && !src.hole && src.block === 0 && src.candy) {
          dst.candy = src.candy;
          src.candy = null;
          moves.push({ from: [r - 1, c], to: [r, c], id: dst.candy.id });
          changed = true;
        }
      }
    }

    for (let c = 0; c < s.cols; c++) {
      const top = fnCell(s, 0, c);
      if (!top.hole && top.block === 0 && !top.candy) {
        const col = Math.floor(fnRngNext(s) * s.colors);
        top.candy = fnNewCandy(s, col, null, false);
        spawns.push({ at: [0, c], candy: { ...top.candy } });
        changed = true;
      }
    }

    if (changed) {
      if (fnExtractIngredientsAtBottom(s, events)) {
        changed = true;
      }
      continue;
    }

    for (let r = s.rows - 1; r >= 1; r--) {
      for (let c = 0; c < s.cols; c++) {
        const dst = fnCell(s, r, c);
        if (dst.hole || dst.block > 0 || dst.candy) continue;

        for (const dc of [-1, 1]) {
          const diag = fnCell(s, r - 1, c + dc);
          if (diag && !diag.hole && diag.block === 0 && diag.candy) {
            dst.candy = diag.candy;
            diag.candy = null;
            moves.push({ from: [r - 1, c + dc], to: [r, c], id: dst.candy.id });
            changed = true;
            break;
          }
        }
      }
    }

    if (fnExtractIngredientsAtBottom(s, events)) {
      changed = true;
    }
  }

  for (let r = 0; r < s.rows; r++) {
    for (let c = 0; c < s.cols; c++) {
      const cell = fnCell(s, r, c);
      if (!cell.hole && cell.block === 0 && !cell.candy) {
        const col = Math.floor(fnRngNext(s) * s.colors);
        cell.candy = fnNewCandy(s, col, null, false);
        spawns.push({ at: [r, c], candy: { ...cell.candy } });
      }
    }
  }

  if (moves.length > 0) events.push({ type: EVENT.GRAVITY, moves });
  if (spawns.length > 0) events.push({ type: EVENT.REFILL, spawns });
}

function fnExtractIngredientsAtBottom(s, events) {
  let any = false;
  const r = s.rows - 1;
  for (let c = 0; c < s.cols; c++) {
    const cell = fnCell(s, r, c);
    if (cell && !cell.hole && cell.candy && cell.candy.ingredient) {
      cell.candy = null;
      s.ingredientsCollected++;
      any = true;
      events.push({ type: EVENT.INGREDIENT_EXIT, at: [r, c] });
      fnAddGoalProgress(s, GOAL.INGREDIENTS, null, 1, events);
    }
  }
  return any;
}

function fnAddGoalProgress(s, type, color, amount, events) {
  for (const g of s.goals) {
    if (g.type !== type) continue;
    if (type === GOAL.COLLECT && g.color !== undefined && g.color !== color) continue;
    if (type === GOAL.SCORE) {
      g.current = s.score;
    } else {
      g.current += amount;
    }
    events.push({ type: EVENT.GOAL_PROGRESS, goal: g.type, current: g.current, target: g.target });
  }
}

function fnAreGoalsMet(s) {
  for (const g of s.goals) {
    if (g.type === GOAL.SCORE && s.score < g.target) return false;
    if (g.type === GOAL.JELLY && s.cells.some(c => c.jelly > 0)) return false;
    if (g.type === GOAL.BLOCKS && s.cells.some(c => c.block > 0)) return false;
    if (g.type === GOAL.COLLECT && g.current < g.target) return false;
    if (g.type === GOAL.INGREDIENTS && s.ingredientsCollected < g.target) return false;
  }
  return true;
}

function fnCheckWinLose(s, events) {
  if (s.status !== STATUS.PLAYING) return;

  if (fnAreGoalsMet(s)) {
    s.status = STATUS.WON;
    if (s.moves > 0) {
      events.push({ type: EVENT.BONUS_START, remainingMoves: s.moves });
      s.score += s.moves * 120;
      s.moves = 0;
    }
    let st = 0;
    for (let i = 0; i < s.starThresholds.length; i++) {
      if (s.score >= s.starThresholds[i]) st = i + 1;
    }
    s.stars = Math.max(1, st);
    events.push({ type: EVENT.LEVEL_WON, score: s.score, stars: s.stars });
    return;
  }

  if (s.moves <= 0) {
    s.status = STATUS.LOST;
    events.push({ type: EVENT.LEVEL_LOST, score: s.score });
  }
}

export function cloneState(s) {
  return JSON.parse(JSON.stringify(s));
}

export function boardToText(s) {
  const lines = [];
  for (let r = 0; r < s.rows; r++) {
    const rowTokens = [];
    for (let c = 0; c < s.cols; c++) {
      const cell = fnCell(s, r, c);
      if (cell.hole) rowTokens.push('#');
      else if (cell.block > 0) rowTokens.push('L');
      else if (!cell.candy) rowTokens.push('.');
      else if (cell.candy.ingredient) rowTokens.push('I');
      else if (cell.candy.special === SPECIAL.BOMB) rowTokens.push('B');
      else {
        let tok = String(cell.candy.color);
        if (cell.candy.special === SPECIAL.STRIPED_ROW) tok += 'r';
        else if (cell.candy.special === SPECIAL.STRIPED_COL) tok += 'c';
        else if (cell.candy.special === SPECIAL.WRAPPED) tok += 'w';
        rowTokens.push(tok);
      }
    }
    lines.push(rowTokens.join(' '));
  }
  return lines.join('\n');
}
