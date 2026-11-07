/**
 * @file renderer.js
 * @description Rendu visuel et animations de "Sweet Match" (Canvas 2D haute performance + Canvas FX superposé).
 * Piloté exclusivement par la file d'événements retournée par engine.js.
 *
 * DIRECTION ARTISTIQUE & ACCESSIBILITÉ :
 * - 6 bonbons originaux, chacun avec une COULEUR saturée et une FORME géométrique unique :
 *   0: Fraise Rubis (Rond)
 *   1: Citron Soleil (Carré arrondi / Coussin)
 *   2: Myrtille Azur (Goutte d'eau)
 *   3: Pomme Émeraude (Hexagone)
 *   4: Raisin Violet (Étoile à 5 branches)
 *   5: Mandarine Corail (Haricot / Cœur bombé)
 * - Mode daltonien (colorblind) : ajoute un symbole contrasté net au cœur de chaque bonbon.
 * - Effets ("Juice") : squash & stretch à l'atterrissage, éclairs sur les rayés, anneaux d'onde de choc,
 *   particules de sucre, textes flottants ("Sucré !", "Délicieux !", "+180"), tremblement d'écran léger,
 *   flash blanc sur Bombe Couleur, respect de `prefers-reduced-motion`.
 */

import { SPECIAL_TYPES } from './specials.js';
import { OBSTACLE_TYPES } from './engine.js';

export const CANDY_PALETTE = [
  { name: 'Fraise', main: '#ff2a6d', light: '#ff85ad', dark: '#a80038', symbol: '●' },
  { name: 'Citron', main: '#ffcc00', light: '#fff085', dark: '#b38600', symbol: '■' },
  { name: 'Myrtille', main: '#00b4ff', light: '#8ce2ff', dark: '#005f9e', symbol: '▲' },
  { name: 'Pomme', main: '#10d976', light: '#8affc1', dark: '#007a3d', symbol: '◆' },
  { name: 'Raisin', main: '#b53dff', light: '#e2a8ff', dark: '#5e00a3', symbol: '★' },
  { name: 'Mandarine', main: '#ff6d1f', light: '#ffb88c', dark: '#ad3400', symbol: '♥' }
];

export class BoardRenderer {
  constructor(boardCanvas, fxCanvas, saveManager, audioManager) {
    this.canvas = boardCanvas;
    this.ctx = boardCanvas.getContext('2d');
    this.fxCanvas = fxCanvas;
    this.fxCtx = fxCanvas.getContext('2d');
    this.saveManager = saveManager;
    this.audio = audioManager;

    this.rows = 9;
    this.cols = 9;
    this.cellSize = 56;
    this.boardPadding = 12;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);

    // État visuel découplé pour interpoler les positions et échelles
    this.visualGrid = [];
    this.candySprites = new Map(); // candyId -> { x, y, scaleX, scaleY, alpha, color, special, locked, bombTimer, ingredientType }
    this.particles = [];
    this.shockwaves = [];
    this.laserBeams = [];
    this.floatingTexts = [];
    this.flashAlpha = 0;
    this.shakeAmount = 0;

    // Sélection, curseur clavier et indice (hint)
    this.selectedCell = null; // { r, c }
    this.cursorCell = { r: 4, c: 4 };
    this.keyboardFocusActive = false;
    this.hintMove = null; // { from: {r,c}, to: {r,c} }

    this.reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /**
   * Redimensionne les canvas pour s'adapter parfaitement au conteneur mobile/desktop.
   */
  resize(containerWidth, containerHeight) {
    const maxSide = Math.max(260, Math.min(containerWidth - 12, containerHeight - 12, 560));
    this.cellSize = Math.floor((maxSide - this.boardPadding * 2) / Math.max(this.rows, this.cols));
    const width = this.cols * this.cellSize + this.boardPadding * 2;
    const height = this.rows * this.cellSize + this.boardPadding * 2;

    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    for (const c of [this.canvas, this.fxCanvas]) {
      c.width = width * this.dpr;
      c.height = height * this.dpr;
      c.style.width = `${width}px`;
      c.style.height = `${height}px`;
    }
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.fxCtx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    // Recaler les coordonnées des sprites sur la nouvelle taille de cellule
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const cell = this.visualGrid[r]?.[c];
        if (cell && cell.candy) {
          const sp = this.candySprites.get(cell.candy.id);
          if (sp) {
            const center = this.cellToPixel(r, c);
            sp.x = center.x;
            sp.y = center.y;
          }
        }
      }
    }
  }

  cellToPixel(r, c) {
    return {
      x: this.boardPadding + (c + 0.5) * this.cellSize,
      y: this.boardPadding + (r + 0.5) * this.cellSize
    };
  }

  pixelToCell(px, py) {
    const c = Math.floor((px - this.boardPadding) / this.cellSize);
    const r = Math.floor((py - this.boardPadding) / this.cellSize);
    if (r < 0 || r >= this.rows || c < 0 || c >= this.cols) return null;
    if (!this.visualGrid[r]?.[c]?.active) return null;
    return { r, c };
  }

  /**
   * Synchronise immédiatement l'état visuel avec le moteur (au chargement du niveau ou fin de résolution).
   */
  syncFromEngine(engine) {
    this.rows = engine.rows;
    this.cols = engine.cols;
    this.visualGrid = JSON.parse(JSON.stringify(engine.board.grid));
    this.candySprites.clear();

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const cell = this.visualGrid[r][c];
        if (cell.active && cell.candy) {
          const pos = this.cellToPixel(r, c);
          this.candySprites.set(cell.candy.id, {
            id: cell.candy.id,
            x: pos.x,
            y: pos.y,
            scaleX: 1,
            scaleY: 1,
            alpha: 1,
            ...cell.candy
          });
        }
      }
    }
  }

  /**
   * Rejoue de façon asynchrone la liste ordonnée d'événements retournée par engine.js
   * avec les timings de référence (swap 200ms, éclatement 250ms, chute 300ms).
   */
  async playEvents(events, engine, callbacks = {}) {
    this.hintMove = null;
    const speedFactor = this.reducedMotion ? 0.35 : 1;

    for (let i = 0; i < events.length; i++) {
      const ev = events[i];

      switch (ev.type) {
        case 'swap': {
          this.audio.playSwap();
          if (ev.movesLeft !== undefined && callbacks.onMovesUpdate) {
            callbacks.onMovesUpdate(ev.movesLeft);
          }
          await this._animateSwap(ev.from, ev.to, 200 * speedFactor);
          break;
        }

        case 'invalid_swap': {
          this.audio.playInvalidSwap();
          if (ev.reason === 'no_match') {
            await this._animateSwap(ev.to, ev.from, 200 * speedFactor);
          } else {
            this._triggerShake(4);
            await this._wait(140 * speedFactor);
          }
          break;
        }

        case 'match': {
          this.audio.playMatch(ev.cascadeLevel || 1);
          for (const pos of ev.positions) {
            const p = this.cellToPixel(pos.r, pos.c);
            this._spawnShockwave(p.x, p.y, CANDY_PALETTE[ev.color]?.light || '#fff', this.cellSize * 0.7);
          }
          break;
        }

        case 'special_created': {
          this.audio.playSpecialCreated(ev.special);
          const cell = this.visualGrid[ev.position.r]?.[ev.position.c];
          if (cell) {
            cell.candy = JSON.parse(JSON.stringify(ev.candy));
            const pos = this.cellToPixel(ev.position.r, ev.position.c);
            this.candySprites.set(ev.candy.id, {
              id: ev.candy.id,
              x: pos.x,
              y: pos.y,
              scaleX: 1.45,
              scaleY: 1.45,
              alpha: 1,
              ...ev.candy
            });
            this._spawnParticles(pos.x, pos.y, '#ffffff', 16);
            this._spawnShockwave(pos.x, pos.y, '#ffe066', this.cellSize * 1.3);
          }
          break;
        }

        case 'special_activated': {
          this.audio.playSpecialActivated(ev.special || ev.comboType);
          const pos = ev.position || (ev.positions && ev.positions[0]);
          if (pos) {
            const px = this.cellToPixel(pos.r, pos.c);
            if (ev.effectType === 'line_h' || ev.comboType === 'STRIPED_STRIPED' || ev.comboType === 'STRIPED_WRAPPED') {
              this.laserBeams.push({ x: 0, y: px.y, w: this.canvas.width, h: this.cellSize * 0.65, life: 1 });
            }
            if (ev.effectType === 'line_v' || ev.comboType === 'STRIPED_STRIPED' || ev.comboType === 'STRIPED_WRAPPED') {
              this.laserBeams.push({ x: px.x, y: 0, w: this.cellSize * 0.65, h: this.canvas.height, life: 1, vertical: true });
            }
            if (ev.special === SPECIAL_TYPES.COLOR_BOMB || ev.comboType?.startsWith('BOMB')) {
              if (!this.reducedMotion) this.flashAlpha = 0.75;
              this._triggerShake(9);
            } else {
              this._triggerShake(6);
            }
            this._spawnShockwave(px.x, px.y, '#ffef8a', this.cellSize * 2.5);
          }
          break;
        }

        case 'clear': {
          await this._animateClear(ev.cells, 250 * speedFactor);
          break;
        }

        case 'gravity': {
          // Regarder si le prochain événement est un 'refill' pour animer chute + nouveaux bonbons ensemble fluidement
          let refillSpawns = [];
          if (events[i + 1] && events[i + 1].type === 'refill') {
            refillSpawns = events[i + 1].spawns;
            i++;
          }
          await this._animateGravityAndRefill(ev.movements, refillSpawns, 300 * speedFactor);
          break;
        }

        case 'refill': {
          await this._animateGravityAndRefill([], ev.spawns, 260 * speedFactor);
          break;
        }

        case 'cascade': {
          if (ev.message) {
            this.spawnBannerText(ev.message, '#fff07c');
            if (callbacks.onAnnouncement) callbacks.onAnnouncement(ev.message);
          }
          break;
        }

        case 'score': {
          if (callbacks.onScoreUpdate) callbacks.onScoreUpdate(ev.totalScore);
          if (ev.points >= 60 && ev.position) {
            const p = this.cellToPixel(ev.position.r, ev.position.c);
            this.floatingTexts.push({
              text: `+${ev.points}`,
              x: p.x,
              y: p.y,
              vy: -1.4,
              alpha: 1,
              scale: ev.points >= 300 ? 1.25 : 1,
              color: ev.points >= 300 ? '#ffe066' : '#ffffff'
            });
          }
          break;
        }

        case 'goal_progress': {
          if (callbacks.onGoalUpdate) callbacks.onGoalUpdate(engine.goals);
          break;
        }

        case 'chocolate_spread': {
          const cell = this.visualGrid[ev.to.r]?.[ev.to.c];
          if (cell) {
            if (cell.candy) this.candySprites.delete(cell.candy.id);
            cell.candy = null;
            cell.obstacle = OBSTACLE_TYPES.CHOCOLATE;
            const p = this.cellToPixel(ev.to.r, ev.to.c);
            this._spawnParticles(p.x, p.y, '#6b3e26', 12);
          }
          await this._wait(180 * speedFactor);
          break;
        }

        case 'bomb_tick': {
          const cell = this.visualGrid[ev.position.r]?.[ev.position.c];
          if (cell && cell.candy) {
            cell.candy.bombTimer = ev.timer;
            const sp = this.candySprites.get(cell.candy.id);
            if (sp) sp.bombTimer = ev.timer;
          }
          break;
        }

        case 'shuffle': {
          this.spawnBannerText(ev.message || 'Mélange sucré !', '#8ce2ff');
          if (callbacks.onAnnouncement) callbacks.onAnnouncement(ev.message);
          await this._wait(450 * speedFactor);
          this.syncFromEngine(engine);
          break;
        }

        case 'level_won': {
          if (ev.bonusMoves > 0) {
            this.spawnBannerText('Sucre à gogo !', '#ffe066');
            for (const bp of (ev.bonusPositions || []).slice(0, 8)) {
              const p = this.cellToPixel(bp.r, bp.c);
              this._spawnParticles(p.x, p.y, '#ffea79', 18);
              this._spawnShockwave(p.x, p.y, '#ffea79', this.cellSize * 1.8);
              this.audio.playSpecialActivated('striped_h');
              await this._wait(120 * speedFactor);
            }
          }
          break;
        }

        default:
          break;
      }
    }

    // Resynchronisation finale propre avec l'état exact du moteur
    this.syncFromEngine(engine);
  }

  spawnBannerText(text, color = '#ffffff') {
    const w = this.cols * this.cellSize + this.boardPadding * 2;
    const h = this.rows * this.cellSize + this.boardPadding * 2;
    this.floatingTexts.push({
      text,
      x: w / 2,
      y: h / 2,
      vy: -0.9,
      alpha: 1.2,
      scale: 1.7,
      color,
      isBanner: true
    });
  }

  _triggerShake(amount) {
    if (this.reducedMotion) return;
    this.shakeAmount = Math.max(this.shakeAmount, amount);
  }

  _spawnParticles(x, y, color, count = 14) {
    if (this.reducedMotion) count = Math.min(4, count);
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.5;
      const speed = 1.8 + Math.random() * 4.2;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 1.2,
        size: 4 + Math.random() * 5,
        color,
        alpha: 1,
        rotation: Math.random() * Math.PI * 2
      });
    }
  }

  _spawnShockwave(x, y, color, maxRadius) {
    if (this.reducedMotion) return;
    this.shockwaves.push({
      x,
      y,
      radius: 4,
      maxRadius,
      color,
      alpha: 0.9
    });
  }

  _wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async _animateSwap(posA, posB, durationMs) {
    const cellA = this.visualGrid[posA.r]?.[posA.c];
    const cellB = this.visualGrid[posB.r]?.[posB.c];
    if (!cellA || !cellB) return;

    const spA = cellA.candy ? this.candySprites.get(cellA.candy.id) : null;
    const spB = cellB.candy ? this.candySprites.get(cellB.candy.id) : null;
    const startA = this.cellToPixel(posA.r, posA.c);
    const startB = this.cellToPixel(posB.r, posB.c);

    // Échanger dans visualGrid
    const tmp = cellA.candy;
    cellA.candy = cellB.candy;
    cellB.candy = tmp;

    const startTime = performance.now();
    return new Promise(resolve => {
      const step = (now) => {
        const t = Math.min(1, (now - startTime) / Math.max(1, durationMs));
        const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        if (spA) {
          spA.x = startA.x + (startB.x - startA.x) * ease;
          spA.y = startA.y + (startB.y - startA.y) * ease;
        }
        if (spB) {
          spB.x = startB.x + (startA.x - startB.x) * ease;
          spB.y = startB.y + (startA.y - startB.y) * ease;
        }
        if (t < 1) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
  }

  async _animateClear(cells, durationMs) {
    const spritesToShrink = [];

    for (const item of cells) {
      const vCell = this.visualGrid[item.r]?.[item.c];
      const pos = this.cellToPixel(item.r, item.c);

      if (item.layerCleared === 'ice' && vCell) {
        vCell.ice = Math.max(0, vCell.ice - 1);
        this._spawnParticles(pos.x, pos.y, '#b8f2ff', 12);
        continue;
      }
      if ((item.layerCleared === 'obstacle' || item.obstacleCleared) && vCell) {
        const col = vCell.obstacle === OBSTACLE_TYPES.CHOCOLATE ? '#6b3e26' : '#2d1e3e';
        vCell.obstacle = null;
        this._spawnParticles(pos.x, pos.y, col, 14);
        continue;
      }
      if (item.layerCleared === 'lock' && vCell && vCell.candy) {
        vCell.candy.locked = 0;
        const sp = this.candySprites.get(vCell.candy.id);
        if (sp) sp.locked = 0;
        this._spawnParticles(pos.x, pos.y, '#ffd166', 10);
        continue;
      }

      if (vCell && vCell.jelly > 0) {
        vCell.jelly = Math.max(0, vCell.jelly - 1);
      }

      const candyId = item.candy?.id || vCell?.candy?.id;
      if (candyId !== undefined) {
        const sp = this.candySprites.get(candyId);
        if (sp) {
          spritesToShrink.push(sp);
          const pColor = sp.color >= 0 ? CANDY_PALETTE[sp.color]?.main : '#ffe066';
          this._spawnParticles(pos.x, pos.y, pColor || '#ffffff', 12);
        }
        if (vCell) vCell.candy = null;
      }
    }

    const startTime = performance.now();
    return new Promise(resolve => {
      const step = (now) => {
        const t = Math.min(1, (now - startTime) / Math.max(1, durationMs));
        for (const sp of spritesToShrink) {
          sp.scaleX = 1 + 0.3 * Math.sin(t * Math.PI) - t;
          sp.scaleY = sp.scaleX;
          sp.alpha = 1 - t;
        }
        if (t < 1) {
          requestAnimationFrame(step);
        } else {
          for (const sp of spritesToShrink) {
            this.candySprites.delete(sp.id);
          }
          resolve();
        }
      };
      requestAnimationFrame(step);
    });
  }

  async _animateGravityAndRefill(movements, spawns, durationMs) {
    // Regrouper les mouvements par candyId pour avoir départ -> arrivée finale
    const moveMap = new Map();
    for (const m of movements) {
      if (!moveMap.has(m.candyId)) {
        moveMap.set(m.candyId, { from: m.from, to: m.to });
      } else {
        moveMap.get(m.candyId).to = m.to;
      }
    }

    const animItems = [];

    // Créer les sprites des nouveaux bonbons apparus en haut
    for (const sp of spawns) {
      const targetPx = this.cellToPixel(sp.r, sp.c);
      const startY = this.boardPadding - this.cellSize * 0.8;
      // Chercher si ce nouveau bonbon est descendu encore plus bas dans movements
      const finalDest = moveMap.get(sp.candy.id)?.to || { r: sp.r, c: sp.c };
      const finalPx = this.cellToPixel(finalDest.r, finalDest.c);
      moveMap.delete(sp.candy.id);

      const sprite = {
        id: sp.candy.id,
        x: targetPx.x,
        y: startY,
        scaleX: 1,
        scaleY: 1,
        alpha: 1,
        ...sp.candy
      };
      this.candySprites.set(sp.candy.id, sprite);
      const vCell = this.visualGrid[finalDest.r]?.[finalDest.c];
      if (vCell) vCell.candy = JSON.parse(JSON.stringify(sp.candy));

      animItems.push({
        sprite,
        startX: targetPx.x,
        startY,
        endX: finalPx.x,
        endY: finalPx.y,
        colDelay: (finalDest.c % 5) * 0.04
      });
    }

    // Mouvements des bonbons existants
    for (const [candyId, mv] of moveMap.entries()) {
      const sprite = this.candySprites.get(candyId);
      if (!sprite) continue;
      const startPx = { x: sprite.x, y: sprite.y };
      const endPx = this.cellToPixel(mv.to.r, mv.to.c);

      const srcCell = this.visualGrid[mv.from.r]?.[mv.from.c];
      const dstCell = this.visualGrid[mv.to.r]?.[mv.to.c];
      if (srcCell && srcCell.candy?.id === candyId) srcCell.candy = null;
      if (dstCell) dstCell.candy = { id: candyId, color: sprite.color, special: sprite.special, locked: sprite.locked, bombTimer: sprite.bombTimer, ingredientType: sprite.ingredientType };

      animItems.push({
        sprite,
        startX: startPx.x,
        startY: startPx.y,
        endX: endPx.x,
        endY: endPx.y,
        colDelay: (mv.to.c % 5) * 0.04
      });
    }

    if (animItems.length === 0) return;

    const startTime = performance.now();
    return new Promise(resolve => {
      const step = (now) => {
        const rawT = Math.min(1, (now - startTime) / Math.max(1, durationMs));
        for (const item of animItems) {
          const localT = Math.max(0, Math.min(1, (rawT - item.colDelay) / (1 - item.colDelay)));
          // Easing avec léger rebond et squash & stretch à l'atterrissage
          const easeOutBack = 1 + 1.4 * Math.pow(localT - 1, 3) + 0.4 * Math.pow(localT - 1, 2);
          item.sprite.x = item.startX + (item.endX - item.startX) * localT;
          item.sprite.y = item.startY + (item.endY - item.startY) * easeOutBack;

          if (!this.reducedMotion) {
            if (localT > 0.8) {
              const squash = Math.sin(((localT - 0.8) / 0.2) * Math.PI) * 0.16;
              item.sprite.scaleX = 1 + squash;
              item.sprite.scaleY = 1 - squash;
            } else {
              item.sprite.scaleX = 0.96;
              item.sprite.scaleY = 1.04;
            }
          }
        }
        if (rawT < 1) {
          requestAnimationFrame(step);
        } else {
          for (const item of animItems) {
            item.sprite.x = item.endX;
            item.sprite.y = item.endY;
            item.sprite.scaleX = 1;
            item.sprite.scaleY = 1;
          }
          resolve();
        }
      };
      requestAnimationFrame(step);
    });
  }

  /**
   * Boucle de rendu principale appelée à 60 fps par requestAnimationFrame.
   */
  render(now = performance.now()) {
    const ctx = this.ctx;
    const fx = this.fxCtx;
    const width = this.cols * this.cellSize + this.boardPadding * 2;
    const height = this.rows * this.cellSize + this.boardPadding * 2;

    ctx.clearRect(0, 0, width, height);
    fx.clearRect(0, 0, width, height);

    ctx.save();
    if (this.shakeAmount > 0.2) {
      const dx = (Math.random() - 0.5) * this.shakeAmount * 2;
      const dy = (Math.random() - 0.5) * this.shakeAmount * 2;
      ctx.translate(dx, dy);
      this.shakeAmount *= 0.85;
    } else {
      this.shakeAmount = 0;
    }

    // 1. Dessiner les cases de la grille, la gelée, les portails et les flèches de sortie
    this._drawBoardCells(ctx, now);

    // 2. Dessiner tous les bonbons (et obstacles réglisse/chocolat)
    for (const sprite of this.candySprites.values()) {
      this._drawCandySprite(ctx, sprite, now);
    }

    // 3. Dessiner les obstacles fixes (Réglisse, Chocolat) et la Glace par-dessus les bonbons
    this._drawTopObstacles(ctx, now);

    ctx.restore();

    // 4. Dessiner les effets spéciaux (Lasers, ondes de choc, particules, textes flottants, flash)
    this._drawFX(fx, width, height);
  }

  _drawBoardCells(ctx, now) {
    const cs = this.cellSize;

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const cell = this.visualGrid[r]?.[c];
        if (!cell || !cell.active) continue;

        const x = this.boardPadding + c * cs;
        const y = this.boardPadding + r * cs;

        // Case de fond translucide en damier doux
        ctx.fillStyle = (r + c) % 2 === 0
          ? 'rgba(255, 255, 255, 0.20)'
          : 'rgba(255, 255, 255, 0.12)';
        this._roundRect(ctx, x + 2, y + 2, cs - 4, cs - 4, 10);
        ctx.fill();

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Gelée au sol (1 ou 2 couches)
        if (cell.jelly > 0) {
          ctx.save();
          ctx.fillStyle = cell.jelly >= 2
            ? 'rgba(255, 77, 178, 0.62)'
            : 'rgba(190, 110, 255, 0.45)';
          this._roundRect(ctx, x + 4, y + 4, cs - 8, cs - 8, 9);
          ctx.fill();
          ctx.strokeStyle = cell.jelly >= 2 ? '#ffaae5' : '#e5c2ff';
          ctx.lineWidth = cell.jelly >= 2 ? 3 : 2;
          ctx.stroke();
          ctx.restore();
        }

        // Portails (Téléporteurs)
        if (cell.portalTo || cell.portalFrom) {
          ctx.save();
          ctx.strokeStyle = cell.portalTo ? '#ff5ea8' : '#00f2fe';
          ctx.lineWidth = 3;
          ctx.beginPath();
          const barY = cell.portalTo ? y + cs - 3 : y + 3;
          ctx.moveTo(x + 6, barY);
          ctx.lineTo(x + cs - 6, barY);
          ctx.stroke();
          ctx.restore();
        }

        // Indicateur de sortie d'ingrédients en bas (si le niveau a des ingrédients)
        if (cell.isExit) {
          ctx.save();
          ctx.fillStyle = 'rgba(255, 230, 102, 0.55)';
          ctx.beginPath();
          ctx.moveTo(x + cs * 0.35, y + cs - 5);
          ctx.lineTo(x + cs * 0.65, y + cs - 5);
          ctx.lineTo(x + cs * 0.5, y + cs - 1);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }

        // Surbrillance de la case sélectionnée
        if (this.selectedCell && this.selectedCell.r === r && this.selectedCell.c === c) {
          ctx.save();
          ctx.strokeStyle = '#fff066';
          ctx.lineWidth = 3.5;
          this._roundRect(ctx, x + 3, y + 3, cs - 6, cs - 6, 10);
          ctx.stroke();
          ctx.restore();
        }

        // Curseur de navigation clavier
        if (this.keyboardFocusActive && this.cursorCell && this.cursorCell.r === r && this.cursorCell.c === c) {
          ctx.save();
          ctx.strokeStyle = '#00f5d4';
          ctx.setLineDash([5, 4]);
          ctx.lineWidth = 3;
          this._roundRect(ctx, x + 2, y + 2, cs - 4, cs - 4, 10);
          ctx.stroke();
          ctx.restore();
        }
      }
    }
  }

  _drawCandySprite(ctx, sprite, now) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, sprite.alpha));
    ctx.translate(sprite.x, sprite.y);

    // Pulsation douce si ce bonbon fait partie de l'indice (hint après 5s)
    let hintPulse = 1;
    if (this.hintMove && !this.reducedMotion) {
      const cell = this.pixelToCell(sprite.x, sprite.y);
      if (
        cell &&
        ((cell.r === this.hintMove.from.r && cell.c === this.hintMove.from.c) ||
          (cell.r === this.hintMove.to.r && cell.c === this.hintMove.to.c))
      ) {
        hintPulse = 1 + Math.sin(now * 0.008) * 0.13;
      }
    }

    ctx.scale(sprite.scaleX * hintPulse, sprite.scaleY * hintPulse);
    const radius = this.cellSize * 0.38;

    // 1. Ingrédient (Cerise ou Noisette)
    if (sprite.special === SPECIAL_TYPES.INGREDIENT) {
      this._drawIngredient(ctx, radius, sprite.ingredientType);
      ctx.restore();
      return;
    }

    // 2. Bombe Couleur
    if (sprite.special === SPECIAL_TYPES.COLOR_BOMB) {
      this._drawColorBomb(ctx, radius, now);
      ctx.restore();
      return;
    }

    const palette = CANDY_PALETTE[sprite.color] || CANDY_PALETTE[0];

    // Halo d'emballage pulsant si bonbon EMBALLÉ ou NOVA
    if (sprite.special === SPECIAL_TYPES.WRAPPED) {
      ctx.save();
      const wrapPulse = this.reducedMotion ? 1 : 1 + Math.sin(now * 0.007) * 0.08;
      ctx.scale(wrapPulse, wrapPulse);
      ctx.fillStyle = palette.light;
      ctx.globalAlpha = 0.45;
      this._roundRect(ctx, -radius * 1.15, -radius * 1.15, radius * 2.3, radius * 2.3, 10);
      ctx.fill();
      ctx.globalAlpha = 0.95;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3;
      ctx.shadowColor = '#ffffff';
      ctx.shadowBlur = 10;
      ctx.stroke();
      ctx.restore();
    } else if (sprite.special === SPECIAL_TYPES.NOVA) {
      ctx.save();
      const pulse = this.reducedMotion ? 1 : 1 + Math.sin(now * 0.01) * 0.08;
      ctx.strokeStyle = '#ffe066';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, radius * 1.15 * pulse, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Ombre portée sous le bonbon
    ctx.save();
    ctx.fillStyle = 'rgba(20, 5, 40, 0.28)';
    ctx.translate(0, 3);
    this._traceCandyShapePath(ctx, sprite.color, radius);
    ctx.fill();
    ctx.restore();

    // Corps du bonbon avec dégradé radial brillant
    this._traceCandyShapePath(ctx, sprite.color, radius);
    const grad = ctx.createRadialGradient(-radius * 0.3, -radius * 0.3, radius * 0.1, 0, 0, radius * 1.1);
    grad.addColorStop(0, palette.light);
    grad.addColorStop(0.55, palette.main);
    grad.addColorStop(1, palette.dark);
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.lineWidth = 2;
    ctx.strokeStyle = palette.dark;
    ctx.stroke();

    // Rayures blanches lumineuses si bonbon RAYÉ (H ou V)
    if (sprite.special === SPECIAL_TYPES.STRIPED_H || sprite.special === SPECIAL_TYPES.STRIPED_V) {
      ctx.save();
      ctx.clip();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.88)';
      ctx.lineWidth = 3.5;
      for (const offset of [-radius * 0.48, 0, radius * 0.48]) {
        ctx.beginPath();
        if (sprite.special === SPECIAL_TYPES.STRIPED_H) {
          ctx.moveTo(-radius, offset);
          ctx.lineTo(radius, offset);
        } else {
          ctx.moveTo(offset, -radius);
          ctx.lineTo(offset, radius);
        }
        ctx.stroke();
      }
      ctx.restore();
    }

    // Reflet glossy blanc en haut à gauche
    ctx.save();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
    ctx.beginPath();
    ctx.ellipse(-radius * 0.28, -radius * 0.3, radius * 0.32, radius * 0.16, -Math.PI / 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Mode daltonien : symbole contrasté au centre
    if (this.saveManager?.data?.settings?.colorblind) {
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      ctx.lineWidth = 3;
      ctx.font = `bold ${Math.round(radius * 0.95)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.strokeText(palette.symbol, 0, 1);
      ctx.fillText(palette.symbol, 0, 1);
    }

    // Compte à rebours de bombe à retardement
    if (sprite.bombTimer !== null && sprite.bombTimer !== undefined) {
      ctx.fillStyle = 'rgba(15, 10, 30, 0.85)';
      ctx.beginPath();
      ctx.arc(radius * 0.55, -radius * 0.55, radius * 0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = sprite.bombTimer <= 3 ? '#ff2a6d' : '#ffe066';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.font = `bold ${Math.round(radius * 0.65)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(sprite.bombTimer), radius * 0.55, -radius * 0.53);
    }

    // Chaînes si le bonbon est verrouillé (locked)
    if (sprite.locked > 0) {
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(-radius * 0.85, -radius * 0.85);
      ctx.lineTo(radius * 0.85, radius * 0.85);
      ctx.moveTo(radius * 0.85, -radius * 0.85);
      ctx.lineTo(-radius * 0.85, radius * 0.85);
      ctx.stroke();
    }

    ctx.restore();
  }

  /**
   * Trace la forme géométrique distinctive associée à la couleur (0 à 5).
   */
  _traceCandyShapePath(ctx, color, r) {
    ctx.beginPath();
    switch (color) {
      case 0: // Rond (Fraise)
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        break;

      case 1: // Carré arrondi / Coussin (Citron)
        this._roundRect(ctx, -r * 0.92, -r * 0.92, r * 1.84, r * 1.84, r * 0.42);
        break;

      case 2: // Goutte d'eau (Myrtille)
        ctx.moveTo(0, -r * 1.08);
        ctx.bezierCurveTo(r * 0.95, -r * 0.2, r * 1.05, r * 0.85, 0, r * 1.02);
        ctx.bezierCurveTo(-r * 1.05, r * 0.85, -r * 0.95, -r * 0.2, 0, -r * 1.08);
        ctx.closePath();
        break;

      case 3: // Hexagone (Pomme)
        for (let i = 0; i < 6; i++) {
          const angle = (Math.PI / 3) * i - Math.PI / 6;
          const px = Math.cos(angle) * r * 1.02;
          const py = Math.sin(angle) * r * 1.02;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        break;

      case 4: // Étoile à 5 branches arrondie (Raisin)
        for (let i = 0; i < 10; i++) {
          const rad = i % 2 === 0 ? r * 1.08 : r * 0.55;
          const angle = (Math.PI / 5) * i - Math.PI / 2;
          const px = Math.cos(angle) * rad;
          const py = Math.sin(angle) * rad;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        break;

      case 5: // Cœur / Haricot sucré (Mandarine)
      default:
        ctx.moveTo(0, r * 0.95);
        ctx.bezierCurveTo(r * 1.2, r * 0.25, r * 1.05, -r * 0.95, 0, -r * 0.42);
        ctx.bezierCurveTo(-r * 1.05, -r * 0.95, -r * 1.2, r * 0.25, 0, r * 0.95);
        ctx.closePath();
        break;
    }
  }

  _drawColorBomb(ctx, r, now) {
    // Sphère arc-en-ciel rotative + cœur cosmique et pépites lumineuses
    ctx.save();
    const spin = this.reducedMotion ? 0 : now * 0.0022;
    const sprinkleColors = ['#ff2a6d', '#ffcc00', '#00b4ff', '#10d976', '#b53dff', '#ff6d1f'];

    // Couronne arc-en-ciel rotative
    for (let i = 0; i < 6; i++) {
      const a0 = spin + (Math.PI * 2 * i) / 6;
      const a1 = spin + (Math.PI * 2 * (i + 1)) / 6;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, r * 1.05, a0, a1);
      ctx.closePath();
      ctx.fillStyle = sprinkleColors[i];
      ctx.fill();
    }

    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.05, 0, Math.PI * 2);
    ctx.stroke();

    // Cœur sombre étoilé
    const grad = ctx.createRadialGradient(-r * 0.2, -r * 0.2, r * 0.08, 0, 0, r * 0.72);
    grad.addColorStop(0, '#5a3d7a');
    grad.addColorStop(0.7, '#27153d');
    grad.addColorStop(1, '#11071f');
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.72, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();

    for (let i = 0; i < 6; i++) {
      const a = -spin * 1.2 + (Math.PI * 2 * i) / 6;
      const sx = Math.cos(a) * r * 0.44;
      const sy = Math.sin(a) * r * 0.44;
      ctx.fillStyle = sprinkleColors[i];
      ctx.beginPath();
      ctx.arc(sx, sy, r * 0.14, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.18, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  _drawIngredient(ctx, r, type) {
    ctx.save();
    // Halo doré
    ctx.fillStyle = 'rgba(255, 230, 102, 0.35)';
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.12, 0, Math.PI * 2);
    ctx.fill();

    if (type === 'hazelnut') {
      ctx.fillStyle = '#c67d3b';
      ctx.beginPath();
      ctx.arc(0, r * 0.1, r * 0.78, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#7c471c';
      ctx.beginPath();
      ctx.arc(0, -r * 0.25, r * 0.65, Math.PI, 0);
      ctx.fill();
    } else {
      // Cerises jumelles
      ctx.strokeStyle = '#2ec44d';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(-r * 0.35, r * 0.2);
      ctx.quadraticCurveTo(0, -r * 0.85, r * 0.2, -r * 0.75);
      ctx.moveTo(r * 0.35, r * 0.25);
      ctx.quadraticCurveTo(0, -r * 0.85, r * 0.2, -r * 0.75);
      ctx.stroke();

      for (const cx of [-r * 0.38, r * 0.38]) {
        ctx.fillStyle = '#ff1e56';
        ctx.beginPath();
        ctx.arc(cx, r * 0.32, r * 0.42, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  _drawTopObstacles(ctx) {
    const cs = this.cellSize;
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const cell = this.visualGrid[r]?.[c];
        if (!cell || !cell.active) continue;
        const pos = this.cellToPixel(r, c);
        const rad = cs * 0.39;

        // Réglisse (tourbillon noir et violet)
        if (cell.obstacle === OBSTACLE_TYPES.LICORICE) {
          ctx.save();
          ctx.translate(pos.x, pos.y);
          ctx.fillStyle = '#231934';
          this._roundRect(ctx, -rad, -rad, rad * 2, rad * 2, 10);
          ctx.fill();
          ctx.strokeStyle = '#a78bfa';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(0, 0, rad * 0.68, 0, Math.PI * 1.7);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(0, 0, rad * 0.34, 0.5, Math.PI * 1.9);
          ctx.stroke();
          ctx.restore();
        }

        // Chocolat (carré gaufré gourmand)
        if (cell.obstacle === OBSTACLE_TYPES.CHOCOLATE) {
          ctx.save();
          ctx.translate(pos.x, pos.y);
          ctx.fillStyle = '#5c2c16';
          this._roundRect(ctx, -rad * 1.05, -rad * 1.05, rad * 2.1, rad * 2.1, 8);
          ctx.fill();
          ctx.fillStyle = '#7b3f20';
          this._roundRect(ctx, -rad * 0.78, -rad * 0.78, rad * 1.56, rad * 1.56, 5);
          ctx.fill();
          ctx.strokeStyle = '#ff99c8';
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.restore();
        }

        // Glace (1 à 3 couches givrées par-dessus le bonbon)
        if (cell.ice > 0) {
          ctx.save();
          const x = this.boardPadding + c * cs;
          const y = this.boardPadding + r * cs;
          const alpha = 0.28 + cell.ice * 0.16;
          ctx.fillStyle = `rgba(180, 245, 255, ${alpha})`;
          this._roundRect(ctx, x + 4, y + 4, cs - 8, cs - 8, 10);
          ctx.fill();
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = cell.ice;
          ctx.stroke();
          ctx.restore();
        }
      }
    }
  }

  _drawFX(fx, width, height) {
    // 1. Rayons laser (bonbons rayés)
    for (let i = this.laserBeams.length - 1; i >= 0; i--) {
      const b = this.laserBeams[i];
      fx.save();
      fx.globalAlpha = b.life;
      fx.fillStyle = '#ffffff';
      if (b.vertical) {
        fx.fillRect(b.x - (b.w * b.life) / 2, 0, b.w * b.life, height);
      } else {
        fx.fillRect(0, b.y - (b.h * b.life) / 2, width, b.h * b.life);
      }
      fx.restore();
      b.life -= 0.08;
      if (b.life <= 0) this.laserBeams.splice(i, 1);
    }

    // 2. Ondes de choc
    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const sw = this.shockwaves[i];
      fx.save();
      fx.globalAlpha = sw.alpha;
      fx.strokeStyle = sw.color;
      fx.lineWidth = 4;
      fx.beginPath();
      fx.arc(sw.x, sw.y, sw.radius, 0, Math.PI * 2);
      fx.stroke();
      fx.restore();

      sw.radius += (sw.maxRadius - sw.radius) * 0.22;
      sw.alpha -= 0.06;
      if (sw.alpha <= 0) this.shockwaves.splice(i, 1);
    }

    // 3. Particules de sucre
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      fx.save();
      fx.globalAlpha = p.alpha;
      fx.fillStyle = p.color;
      fx.translate(p.x, p.y);
      fx.rotate(p.rotation);
      fx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
      fx.restore();

      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.18; // Gravité légère
      p.alpha -= 0.035;
      if (p.alpha <= 0) this.particles.splice(i, 1);
    }

    // 4. Textes flottants (scores et bannières "Délicieux !")
    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      const ft = this.floatingTexts[i];
      fx.save();
      fx.globalAlpha = Math.min(1, ft.alpha);
      const fontSize = ft.isBanner ? Math.round(this.cellSize * 0.62) : Math.round(this.cellSize * 0.36 * ft.scale);
      fx.font = `900 ${fontSize}px 'Fredoka', 'Baloo 2', sans-serif`;
      fx.textAlign = 'center';
      fx.textBaseline = 'middle';
      fx.lineWidth = ft.isBanner ? 6 : 4;
      fx.strokeStyle = 'rgba(45, 10, 75, 0.85)';
      fx.strokeText(ft.text, ft.x, ft.y);
      fx.fillStyle = ft.color;
      fx.fillText(ft.text, ft.x, ft.y);
      fx.restore();

      ft.y += ft.vy;
      ft.alpha -= ft.isBanner ? 0.022 : 0.032;
      if (ft.alpha <= 0) this.floatingTexts.splice(i, 1);
    }

    // 5. Flash blanc (Bombe Couleur)
    if (this.flashAlpha > 0) {
      fx.save();
      fx.fillStyle = `rgba(255, 255, 255, ${this.flashAlpha})`;
      fx.fillRect(0, 0, width, height);
      fx.restore();
      this.flashAlpha = Math.max(0, this.flashAlpha - 0.07);
    }
  }

  _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
}
