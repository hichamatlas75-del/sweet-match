/**
 * @file ui.js
 * @description Gestionnaire de l'interface utilisateur (en français) :
 * - Écran d'accueil (MENU)
 * - Carte des 100 niveaux en chemin sinueux scrollable avec SVG et chapitres (MAP)
 * - Modale d'introduction de niveau & tutoriel contextuel (LEVEL_INTRO)
 * - HUD de partie : objectifs, coups/timer, score, jauge à 3 étoiles, barre de boosters (PLAYING)
 * - Écrans de Victoire / Défaite / Plus de vies / Boutique / Paramètres.
 */

import { LEVELS, CHAPTERS, getLevelById } from './levels.js';
import { CANDY_PALETTE } from './renderer.js';
import { MAX_LIVES } from './save.js';

export class UIManager {
  constructor(saveManager, audioManager, callbacks) {
    this.save = saveManager;
    this.audio = audioManager;
    this.callbacks = callbacks; // { onSelectLevel(id), onStartLevel(id, preBoosters), onUseBooster(type), onRestartLevel(), onBackToMap() }

    this.activeBoosterMode = null; // 'hammer' | 'free_swap' | null
    this.selectedPreBoosters = new Set();

    this._cacheDOM();
    this._bindButtons();
    this.renderMap();
    this.updateTopStatus();
  }

  _cacheDOM() {
    this.screens = {
      menu: document.getElementById('screen-menu'),
      map: document.getElementById('screen-map'),
      game: document.getElementById('screen-game')
    };

    this.modals = {
      intro: document.getElementById('modal-level-intro'),
      win: document.getElementById('modal-win'),
      lose: document.getElementById('modal-lose'),
      shop: document.getElementById('modal-shop'),
      settings: document.getElementById('modal-settings'),
      nolives: document.getElementById('modal-no-lives')
    };

    this.liveRegion = document.getElementById('aria-announcer');
    this.mapContainer = document.getElementById('map-scroll-container');
    this.mapTrack = document.getElementById('map-nodes-track');
  }

  _bindButtons() {
    const bind = (id, fn) => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('click', () => {
          this.audio.playClick();
          fn();
        });
      }
    };

    // Menu principal -> Carte
    bind('btn-play-main', () => this.callbacks.onOpenMap());
    bind('btn-open-shop-menu', () => this.openModal('shop'));
    bind('btn-open-settings-menu', () => this.openModal('settings'));

    // Barre supérieure de la Carte
    bind('btn-map-home', () => this.callbacks.onOpenMenu());
    bind('btn-map-shop', () => this.openModal('shop'));
    bind('btn-map-settings', () => this.openModal('settings'));
    bind('btn-map-lives', () => {
      if (this.save.data.lives < MAX_LIVES) this.openModal('nolives');
    });

    // Modale Intro Niveau
    bind('btn-close-intro', () => {
      this.closeAllModals();
      if (this.callbacks.onCloseLevelIntro) this.callbacks.onCloseLevelIntro();
    });
    bind('btn-launch-level', () => {
      const levelId = Number(this.modals.intro.dataset.levelId || 1);
      const preBoosters = Array.from(this.selectedPreBoosters);
      this.closeAllModals();
      this.callbacks.onStartLevel(levelId, preBoosters);
    });

    // Boutons HUD en cours de partie
    bind('btn-game-pause', () => this.openModal('settings'));
    bind('btn-game-hint', () => {
      if (this.callbacks.onRequestHint) this.callbacks.onRequestHint();
    });
    bind('btn-game-restart', () => this.callbacks.onRestartLevel());
    bind('btn-game-map', () => this.callbacks.onBackToMap());

    // Boosters en jeu
    document.querySelectorAll('.booster-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.audio.playClick();
        const type = btn.dataset.booster;
        this.callbacks.onUseBooster(type);
      });
    });

    // Modales Victoire / Défaite
    bind('btn-win-next', () => {
      this.closeAllModals();
      this.callbacks.onNextLevel();
    });
    bind('btn-win-map', () => {
      this.closeAllModals();
      this.callbacks.onBackToMap();
    });
    bind('btn-lose-retry', () => {
      this.closeAllModals();
      this.callbacks.onRestartLevel();
    });
    bind('btn-lose-buy-moves', () => {
      const btn = document.getElementById('btn-lose-buy-moves');
      if (this.save.useBooster('extra_moves') || this.save.buyItem('extra_moves', 60, 0)) {
        this.closeAllModals();
        this.callbacks.onContinueWithExtraMoves();
        this.updateTopStatus();
        this.updateBoostersHUD();
      } else {
        this.announce('Pas assez de cristaux de sucre !');
        if (btn) {
          btn.classList.add('shake-error');
          setTimeout(() => btn.classList.remove('shake-error'), 400);
        }
      }
    });
    bind('btn-lose-map', () => {
      this.closeAllModals();
      this.callbacks.onBackToMap();
    });

    // Modale Plus de vies
    bind('btn-refill-lives-coins', () => {
      if (this.save.buyItem('lives', 80)) {
        this.updateTopStatus();
        this.closeAllModals();
      }
    });
    bind('btn-refill-lives-free', () => {
      this.save.refillLivesFree();
      this.updateTopStatus();
      this.closeAllModals();
    });
    bind('btn-close-nolives', () => this.closeAllModals());

    // Boutique
    bind('btn-close-shop', () => this.closeAllModals());
    document.querySelectorAll('.shop-buy-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.audio.playClick();
        const item = btn.dataset.item;
        const cost = Number(btn.dataset.cost);
        if (this.save.buyItem(item, cost, 1)) {
          this.updateTopStatus();
          this.updateBoostersHUD();
          btn.textContent = 'Acheté ✓';
          setTimeout(() => {
            btn.textContent = `${cost} 💎`;
          }, 900);
        } else {
          btn.classList.add('shake-error');
          setTimeout(() => btn.classList.remove('shake-error'), 400);
        }
      });
    });

    // Paramètres
    bind('btn-close-settings', () => this.closeAllModals());
    bind('toggle-sound', () => {
      this.save.updateSetting('sound', !this.save.data.settings.sound);
      this.syncSettingsUI();
    });
    bind('toggle-music', () => {
      this.save.updateSetting('music', !this.save.data.settings.music);
      this.audio.syncMusic();
      this.syncSettingsUI();
    });
    bind('toggle-vibration', () => {
      this.save.updateSetting('vibration', !this.save.data.settings.vibration);
      this.syncSettingsUI();
    });
    bind('toggle-colorblind', () => {
      this.save.updateSetting('colorblind', !this.save.data.settings.colorblind);
      this.syncSettingsUI();
    });
    bind('btn-reset-save', () => {
      this.save.resetAll();
      this.renderMap();
      this.updateTopStatus();
      this.closeAllModals();
    });
  }

  announce(message) {
    if (this.liveRegion) {
      this.liveRegion.textContent = message;
    }
  }

  showScreen(screenName) {
    Object.entries(this.screens).forEach(([key, el]) => {
      if (el) el.classList.toggle('active', key === screenName);
    });
    if (screenName === 'map') {
      this.renderMap();
      this.updateTopStatus();
      this.scrollToCurrentLevel();
    }
  }

  openModal(modalName) {
    this.closeAllModals();
    const m = this.modals[modalName];
    if (m) {
      m.classList.add('open');
      if (modalName === 'settings') this.syncSettingsUI();
      if (modalName === 'shop') this.updateTopStatus();
    }
  }

  closeAllModals() {
    Object.values(this.modals).forEach(m => {
      if (m) m.classList.remove('open');
    });
  }

  isAnyModalOpen() {
    return Object.values(this.modals).some(m => m && m.classList.contains('open'));
  }

  syncSettingsUI() {
    const s = this.save.data.settings;
    const setBtn = (id, state) => {
      const el = document.getElementById(id);
      if (el) {
        el.textContent = state ? 'Activé' : 'Désactivé';
        el.classList.toggle('btn-toggle-on', state);
      }
    };
    setBtn('toggle-sound', s.sound);
    setBtn('toggle-music', s.music);
    setBtn('toggle-vibration', s.vibration);
    setBtn('toggle-colorblind', s.colorblind);
  }

  /**
   * Met à jour les compteurs de vies, timer de régénération, étoiles totales et cristaux de sucre.
   */
  updateTopStatus() {
    const msNext = this.save.syncLives();
    const d = this.save.data;

    const livesEl = document.getElementById('map-lives-count');
    const timerEl = document.getElementById('map-lives-timer');
    const starsEl = document.getElementById('map-stars-count');
    const coinsEl = document.getElementById('map-coins-count');
    const shopCoinsEl = document.getElementById('shop-coins-count');

    if (livesEl) livesEl.textContent = `${d.lives}/${MAX_LIVES}`;
    if (timerEl) {
      if (d.lives >= MAX_LIVES) {
        timerEl.textContent = 'MAX';
      } else {
        const mins = Math.floor(msNext / 60000);
        const secs = Math.floor((msNext % 60000) / 1000);
        timerEl.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
      }
    }
    if (starsEl) starsEl.textContent = String(d.totalStars);
    if (coinsEl) coinsEl.textContent = String(d.coins);
    if (shopCoinsEl) shopCoinsEl.textContent = String(d.coins);
  }

  /**
   * Génère la carte sinueuse des 100 niveaux avec son tracé SVG et ses bannières de chapitres.
   */
  renderMap() {
    if (!this.mapTrack) return;
    this.mapTrack.innerHTML = '';

    const unlocked = this.save.data.unlockedLevel;
    const starsMap = this.save.data.starsByLevel;
    const totalLevels = LEVELS.length;
    const stepY = 82;
    const totalHeight = (totalLevels + 2) * stepY;

    this.mapTrack.style.height = `${totalHeight}px`;

    // Créer le SVG du chemin sinueux
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('class', 'map-path-svg');
    svg.setAttribute('viewBox', `0 0 400 ${totalHeight}`);
    svg.setAttribute('preserveAspectRatio', 'none');

    const points = [];
    for (let i = 0; i < totalLevels; i++) {
      const id = i + 1;
      // De bas en haut : le niveau 1 est en bas, le niveau 100 est tout en haut
      const y = totalHeight - id * stepY - 30;
      const x = 200 + Math.sin(i * 0.65) * 115;
      points.push({ id, x, y });
    }

    let pathD = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const cur = points[i];
      const midY = (prev.y + cur.y) / 2;
      pathD += ` C ${prev.x} ${midY}, ${cur.x} ${midY}, ${cur.x} ${cur.y}`;
    }

    const pathBg = document.createElementNS(svgNS, 'path');
    pathBg.setAttribute('d', pathD);
    pathBg.setAttribute('fill', 'none');
    pathBg.setAttribute('stroke', 'rgba(255, 255, 255, 0.45)');
    pathBg.setAttribute('stroke-width', '14');
    pathBg.setAttribute('stroke-linecap', 'round');
    pathBg.setAttribute('stroke-dasharray', '18 14');
    svg.appendChild(pathBg);
    this.mapTrack.appendChild(svg);

    // Bannières des 10 chapitres
    for (const ch of CHAPTERS) {
      const startPt = points[ch.range[0] - 1];
      const banner = document.createElement('div');
      banner.className = 'chapter-banner';
      banner.style.top = `${startPt.y + 38}px`;
      banner.style.borderColor = ch.color;
      banner.innerHTML = `<span class="chapter-num">Chapitre ${ch.id}</span> <strong>${ch.name}</strong>`;
      this.mapTrack.appendChild(banner);
    }

    // Boutons des 100 niveaux
    for (const pt of points) {
      const isUnlocked = pt.id <= unlocked;
      const isCurrent = pt.id === unlocked;
      const stars = starsMap[pt.id] || 0;

      const btn = document.createElement('button');
      btn.className = `map-node ${isUnlocked ? 'unlocked' : 'locked'} ${isCurrent ? 'current' : ''}`;
      btn.style.left = `${(pt.x / 400) * 100}%`;
      btn.style.top = `${pt.y}px`;
      btn.dataset.level = pt.id;
      btn.setAttribute('aria-label', `Niveau ${pt.id}, ${isUnlocked ? `${stars} étoiles` : 'verrouillé'}`);

      const starStr = isUnlocked
        ? `<div class="node-stars">${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}</div>`
        : '';

      btn.innerHTML = `
        <span class="node-num">${pt.id}</span>
        ${starStr}
      `;

      btn.addEventListener('click', () => {
        this.audio.playClick();
        if (!isUnlocked) {
          this.announce(`Le niveau ${pt.id} est encore verrouillé.`);
          return;
        }
        this.openLevelIntro(pt.id);
      });

      this.mapTrack.appendChild(btn);
    }
  }

  scrollToCurrentLevel() {
    if (!this.mapContainer || !this.mapTrack) return;
    const currentBtn = this.mapTrack.querySelector('.map-node.current');
    if (currentBtn) {
      const top = currentBtn.offsetTop - this.mapContainer.clientHeight / 2;
      this.mapContainer.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    }
  }

  /**
   * Ouvre la fenêtre de présentation d'un niveau (objectifs, record, tutoriel contextuel, boosters de départ).
   */
  openLevelIntro(levelId) {
    const level = getLevelById(levelId);
    const modal = this.modals.intro;
    if (!modal) return;

    modal.dataset.levelId = String(levelId);
    this.selectedPreBoosters.clear();

    document.getElementById('intro-level-title').textContent = `Niveau ${level.id}`;
    const record = this.save.data.highScoreByLevel[level.id] || 0;
    document.getElementById('intro-level-record').textContent = record > 0 ? `Record : ${record} pts` : 'Nouveau défi !';

    // Objectifs
    const goalsList = document.getElementById('intro-goals-list');
    goalsList.innerHTML = level.goals.map(g => `
      <div class="goal-chip">
        <span class="goal-icon">${this._getGoalIcon(g)}</span>
        <span class="goal-label">${this._getGoalText(g)}</span>
      </div>
    `).join('');

    // Tutoriel contextuel (tous les ~10 niveaux)
    const tutBox = document.getElementById('intro-tutorial-box');
    if (level.tutorial) {
      tutBox.style.display = 'flex';
      document.getElementById('intro-tutorial-icon').textContent = level.tutorial.icon;
      document.getElementById('intro-tutorial-title').textContent = level.tutorial.title;
      document.getElementById('intro-tutorial-text').textContent = level.tutorial.text;
    } else {
      tutBox.style.display = 'none';
    }

    // Boosters de pré-niveau (Bombe Couleur de départ)
    const preBombBtn = document.getElementById('btn-prebooster-bomb');
    if (preBombBtn) {
      const count = this.save.data.boosters.color_bomb || 0;
      preBombBtn.classList.remove('selected');
      preBombBtn.querySelector('.pre-count').textContent = `x${count}`;
      preBombBtn.onclick = () => {
        this.audio.playClick();
        if (count <= 0) return;
        if (this.selectedPreBoosters.has('color_bomb')) {
          this.selectedPreBoosters.delete('color_bomb');
          preBombBtn.classList.remove('selected');
        } else {
          this.selectedPreBoosters.add('color_bomb');
          preBombBtn.classList.add('selected');
        }
      };
    }

    this.openModal('intro');
    if (this.callbacks.onOpenLevelIntro) {
      this.callbacks.onOpenLevelIntro(levelId);
    }
  }

  /**
   * Initialise et met à jour le HUD de la partie en cours.
   */
  initGameHUD(engine) {
    document.getElementById('hud-level-num').textContent = `Niv. ${engine.level.id}`;
    this.updateScoreHUD(engine.score, engine.starThresholds);
    this.updateMovesHUD(engine.movesLeft, engine.timeLeft);
    this.updateGoalsHUD(engine.goals);
    this.updateBoostersHUD();
    this.setBoosterSelectionMode(null);
  }

  updateScoreHUD(score, starThresholds) {
    const scoreEl = document.getElementById('hud-score-val');
    if (scoreEl) scoreEl.textContent = String(score);

    const maxStarScore = starThresholds[2] || 5000;
    const pct = Math.min(100, Math.round((score / maxStarScore) * 100));
    const fill = document.getElementById('hud-star-fill');
    if (fill) fill.style.width = `${pct}%`;

    for (let i = 0; i < 3; i++) {
      const starEl = document.getElementById(`hud-star-${i + 1}`);
      if (starEl) {
        starEl.classList.toggle('earned', score >= starThresholds[i]);
      }
    }
  }

  updateMovesHUD(movesLeft, timeLeft = null) {
    const labelEl = document.getElementById('hud-moves-label');
    const valEl = document.getElementById('hud-moves-val');
    if (timeLeft !== null && timeLeft !== undefined) {
      if (labelEl) labelEl.textContent = 'Temps';
      if (valEl) {
        valEl.textContent = `${timeLeft}s`;
        valEl.classList.toggle('danger-pulse', timeLeft <= 10);
      }
    } else {
      if (labelEl) labelEl.textContent = 'Coups';
      if (valEl) {
        valEl.textContent = String(movesLeft);
        valEl.classList.toggle('danger-pulse', movesLeft <= 5);
      }
    }
  }

  updateGoalsHUD(goals) {
    const container = document.getElementById('hud-goals-container');
    if (!container) return;
    container.innerHTML = goals.map(g => {
      const remaining = Math.max(0, g.target - g.current);
      const done = remaining === 0;
      return `
        <div class="hud-goal-item ${done ? 'completed' : ''}">
          <span class="hud-goal-icon">${this._getGoalIcon(g)}</span>
          <span class="hud-goal-count">${done ? '✓' : (g.type === 'score' ? `${g.current}/${g.target}` : remaining)}</span>
        </div>
      `;
    }).join('');
  }

  updateBoostersHUD() {
    const b = this.save.data.boosters;
    document.querySelectorAll('.booster-btn').forEach(btn => {
      const type = btn.dataset.booster;
      const badge = btn.querySelector('.booster-count');
      if (badge && b[type] !== undefined) {
        badge.textContent = String(b[type]);
      }
      btn.classList.toggle('disabled', (b[type] || 0) <= 0);
    });
  }

  setBoosterSelectionMode(mode) {
    this.activeBoosterMode = mode;
    document.querySelectorAll('.booster-btn').forEach(btn => {
      btn.classList.toggle('active-booster', btn.dataset.booster === mode);
    });
    const banner = document.getElementById('booster-instruction-banner');
    if (banner) {
      if (mode === 'hammer') {
        banner.textContent = '🔨 Marteau actif : touche une case du plateau à briser !';
        banner.style.display = 'block';
      } else if (mode === 'free_swap') {
        banner.textContent = '✋ Main magique active : échange librement 2 bonbons adjacents !';
        banner.style.display = 'block';
      } else {
        banner.style.display = 'none';
      }
    }
  }

  showWinModal(levelId, score, stars, rewardInfo) {
    document.getElementById('win-score-val').textContent = `${score} pts`;
    document.getElementById('win-coins-reward').textContent = `+${rewardInfo.coinReward} 💎`;
    const starsBox = document.getElementById('win-stars-display');
    starsBox.innerHTML = [1, 2, 3].map(i =>
      `<span class="win-star ${i <= stars ? 'lit' : ''}">★</span>`
    ).join('');
    this.openModal('win');
  }

  showLoseModal(reason, score) {
    const msgMap = {
      out_of_moves: 'Tu n’as plus de coups disponibles !',
      bomb_exploded: 'Une bombe pétillante a atteint zéro !',
      time_up: 'Le temps imparti est écoulé !'
    };
    document.getElementById('lose-reason-text').textContent = msgMap[reason] || 'Dommage, essaie encore !';
    document.getElementById('lose-score-val').textContent = `Score : ${score} pts`;
    const buyBtn = document.getElementById('btn-lose-buy-moves');
    if (buyBtn) {
      const freeCount = this.save.data.boosters.extra_moves || 0;
      buyBtn.textContent = freeCount > 0
        ? `Continuer (+5 coups — Booster x${freeCount})`
        : 'Continuer (+5 coups — 60 💎)';
    }
    this.openModal('lose');
  }

  _getGoalIcon(g) {
    switch (g.type) {
      case 'score': return '⭐';
      case 'jelly': return '🍮';
      case 'ice': return '🧊';
      case 'licorice': return '🌀';
      case 'chocolate': return '🍫';
      case 'ingredients': return '🍒';
      case 'locked': return '⛓️';
      case 'color': {
        const pal = CANDY_PALETTE[g.color || 0];
        return `<span class="color-dot" style="background:${pal.main}"></span>`;
      }
      default: return '🍬';
    }
  }

  _getGoalText(g) {
    switch (g.type) {
      case 'score': return `Atteindre ${g.target} points`;
      case 'jelly': return `Nettoyer toute la gelée (${g.target})`;
      case 'ice': return `Briser ${g.target} couches de glace`;
      case 'licorice': return `Détruire ${g.target} tourbillons de réglisse`;
      case 'chocolate': return `Éliminer tout le chocolat (${g.target})`;
      case 'ingredients': return `Faire descendre ${g.target} ingrédients`;
      case 'locked': return `Libérer ${g.target} bonbons enchaînés`;
      case 'color': {
        const pal = CANDY_PALETTE[g.color || 0];
        return `Collecter ${g.target} bonbons ${pal.name}`;
      }
      default: return `Objectif : ${g.target}`;
    }
  }
}
