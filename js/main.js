/**
 * @file main.js
 * @description Point d'entrée principal et machine d'états stricte de "Sweet Match" :
 * MENU -> MAP -> LEVEL_INTRO -> PLAYING -> (RESOLVING <-> PLAYING) -> WIN | LOSE -> MAP
 * Pendant RESOLVING, toute entrée joueur est verrouillée (aucune course d'état possible).
 */

import { GameEngine } from './engine.js';
import { getLevelById } from './levels.js';
import { SaveManager } from './save.js';
import { AudioManager } from './audio.js';
import { BoardRenderer } from './renderer.js';
import { InputController } from './input.js';
import { UIManager } from './ui.js';

export const GAME_STATES = {
  MENU: 'MENU',
  MAP: 'MAP',
  LEVEL_INTRO: 'LEVEL_INTRO',
  PLAYING: 'PLAYING',
  RESOLVING: 'RESOLVING',
  WIN: 'WIN',
  LOSE: 'LOSE'
};

class SweetMatchApp {
  constructor() {
    this.state = GAME_STATES.MENU;
    this.save = new SaveManager();
    this.audio = new AudioManager(this.save);
    this.engine = null;
    this.currentLevelId = this.save.data.unlockedLevel || 1;
    this.levelTimerInterval = null;

    const boardCanvas = document.getElementById('board-canvas');
    const fxCanvas = document.getElementById('fx-canvas');
    this.renderer = new BoardRenderer(boardCanvas, fxCanvas, this.save, this.audio);

    this.ui = new UIManager(this.save, this.audio, {
      onOpenMenu: () => this.transitionTo(GAME_STATES.MENU),
      onOpenMap: () => this.transitionTo(GAME_STATES.MAP),
      onStartLevel: (levelId, preBoosters) => this.startLevel(levelId, preBoosters),
      onUseBooster: (type) => this.handleBoosterButton(type),
      onRestartLevel: () => this.restartCurrentLevel(),
      onNextLevel: () => {
        const nextId = Math.min(100, this.currentLevelId + 1);
        this.ui.openLevelIntro(nextId);
      },
      onContinueWithExtraMoves: () => this.continueWithExtraMoves(),
      onBackToMap: () => {
        this._clearLevelTimer();
        this.transitionTo(GAME_STATES.MAP);
      }
    });

    this.input = new InputController(boardCanvas, this.renderer, {
      canInteract: () => this.state === GAME_STATES.PLAYING,
      onSwap: (posA, posB) => this.handlePlayerSwap(posA, posB),
      onCellTap: (pos) => this.handleCellTap(pos),
      getHint: () => (this.engine ? this.engine.getHint() : null)
    });

    this._setupResizeListener();
    this._setupStatusIntervals();
    this._registerServiceWorker();
    this._startMainLoop();
  }

  transitionTo(newState) {
    this.state = newState;
    if (newState === GAME_STATES.MENU) {
      this._clearLevelTimer();
      this.ui.closeAllModals();
      this.ui.showScreen('menu');
    } else if (newState === GAME_STATES.MAP) {
      this._clearLevelTimer();
      this.ui.showScreen('map');
    } else if (newState === GAME_STATES.PLAYING) {
      this.ui.showScreen('game');
      this.input.resetIdleTimer();
    }
  }

  async startLevel(levelId, preBoosters = []) {
    this.save.syncLives();
    if (this.save.data.lives <= 0) {
      this.ui.openModal('nolives');
      return;
    }

    this.currentLevelId = levelId;
    const levelConfig = getLevelById(levelId);
    this.engine = new GameEngine(levelConfig);

    this.transitionTo(GAME_STATES.PLAYING);
    this.renderer.syncFromEngine(this.engine);
    this._resizeBoard();
    this.ui.initGameHUD(this.engine);
    this.ui.announce(`Niveau ${levelId} commencé.`);

    // Appliquer les boosters de pré-niveau sélectionnés
    if (preBoosters.includes('color_bomb') && this.save.useBooster('color_bomb')) {
      this.state = GAME_STATES.RESOLVING;
      const evs = this.engine.placeColorBombBooster();
      await this.renderer.playEvents(evs, this.engine);
      this.ui.updateBoostersHUD();
      this.state = GAME_STATES.PLAYING;
    }

    // Démarrer le compte à rebours si le niveau est chronométré
    this._clearLevelTimer();
    if (this.engine.timeLeft !== null) {
      this.levelTimerInterval = setInterval(async () => {
        if (this.state !== GAME_STATES.PLAYING || !this.engine) return;
        const evs = this.engine.tickTimer(1);
        this.ui.updateMovesHUD(this.engine.movesLeft, this.engine.timeLeft);
        if (evs.length > 0) {
          await this._processEngineEvents(evs);
        }
      }, 1000);
    }
  }

  restartCurrentLevel() {
    this.ui.closeAllModals();
    this.startLevel(this.currentLevelId, []);
  }

  continueWithExtraMoves() {
    if (!this.engine) return;
    this.engine.addExtraMoves(5);
    this.ui.updateMovesHUD(this.engine.movesLeft, this.engine.timeLeft);
    this.state = GAME_STATES.PLAYING;
  }

  /**
   * Gère l'échange demandé par le joueur (ou l'échange libre si le booster Main magique est actif).
   */
  async handlePlayerSwap(posA, posB) {
    if (this.state !== GAME_STATES.PLAYING || !this.engine) return;

    this.state = GAME_STATES.RESOLVING;

    let events = [];
    if (this.ui.activeBoosterMode === 'free_swap') {
      if (this.save.useBooster('free_swap')) {
        this.ui.setBoosterSelectionMode(null);
        this.ui.updateBoostersHUD();
        events = this.engine.useFreeSwapBooster(posA, posB);
      } else {
        this.ui.setBoosterSelectionMode(null);
        this.state = GAME_STATES.PLAYING;
        return;
      }
    } else {
      events = this.engine.swap(posA, posB);
    }

    await this._processEngineEvents(events);
  }

  /**
   * Gère le clic direct sur une case lorsque le booster Marteau est armé.
   */
  handleCellTap(pos) {
    if (this.state !== GAME_STATES.PLAYING || !this.engine) return false;
    if (this.ui.activeBoosterMode !== 'hammer') return false;

    if (!this.save.useBooster('hammer')) {
      this.ui.setBoosterSelectionMode(null);
      return true;
    }

    this.ui.setBoosterSelectionMode(null);
    this.ui.updateBoostersHUD();
    this.state = GAME_STATES.RESOLVING;

    const events = this.engine.useHammerBooster(pos.r, pos.c);
    this._processEngineEvents(events);
    return true;
  }

  /**
   * Gère le clic sur l'un des 4 boutons de boosters dans le HUD.
   */
  async handleBoosterButton(type) {
    if (this.state !== GAME_STATES.PLAYING || !this.engine) return;
    const count = this.save.data.boosters[type] || 0;
    if (count <= 0) {
      this.ui.openModal('shop');
      return;
    }

    if (type === 'hammer' || type === 'free_swap') {
      const nextMode = this.ui.activeBoosterMode === type ? null : type;
      this.ui.setBoosterSelectionMode(nextMode);
      return;
    }

    if (type === 'extra_moves') {
      if (this.save.useBooster('extra_moves')) {
        this.engine.addExtraMoves(5);
        this.ui.updateMovesHUD(this.engine.movesLeft, this.engine.timeLeft);
        this.ui.updateBoostersHUD();
        this.renderer.spawnBannerText('+5 Coups !', '#8affc1');
      }
      return;
    }

    if (type === 'color_bomb') {
      if (this.save.useBooster('color_bomb')) {
        this.state = GAME_STATES.RESOLVING;
        const evs = this.engine.placeColorBombBooster();
        await this.renderer.playEvents(evs, this.engine);
        this.ui.updateBoostersHUD();
        this.state = GAME_STATES.PLAYING;
      }
    }
  }

  async _processEngineEvents(events) {
    await this.renderer.playEvents(events, this.engine, {
      onMovesUpdate: (movesLeft) => this.ui.updateMovesHUD(movesLeft, this.engine.timeLeft),
      onScoreUpdate: (totalScore) => this.ui.updateScoreHUD(totalScore, this.engine.starThresholds),
      onGoalUpdate: (goals) => this.ui.updateGoalsHUD(goals),
      onAnnouncement: (msg) => this.ui.announce(msg)
    });

    this.ui.updateScoreHUD(this.engine.score, this.engine.starThresholds);
    this.ui.updateGoalsHUD(this.engine.goals);
    this.ui.updateMovesHUD(this.engine.movesLeft, this.engine.timeLeft);

    const wonEvent = events.find(e => e.type === 'level_won');
    const lostEvent = events.find(e => e.type === 'level_lost');

    if (wonEvent) {
      this._clearLevelTimer();
      this.state = GAME_STATES.WIN;
      this.audio.playWin();
      const rewardInfo = this.save.recordLevelWin(this.currentLevelId, wonEvent.score, wonEvent.stars);
      this.ui.updateTopStatus();
      this.ui.showWinModal(this.currentLevelId, wonEvent.score, wonEvent.stars, rewardInfo);
      this.ui.announce(`Victoire ! Niveau ${this.currentLevelId} terminé avec ${wonEvent.stars} étoiles.`);
    } else if (lostEvent) {
      this._clearLevelTimer();
      this.state = GAME_STATES.LOSE;
      this.audio.playLose();
      this.save.consumeLife();
      this.ui.updateTopStatus();
      this.ui.showLoseModal(lostEvent.reason, lostEvent.score);
      this.ui.announce('Partie perdue.');
    } else {
      this.state = GAME_STATES.PLAYING;
      this.input.resetIdleTimer();
    }
  }

  _clearLevelTimer() {
    if (this.levelTimerInterval) {
      clearInterval(this.levelTimerInterval);
      this.levelTimerInterval = null;
    }
  }

  _resizeBoard() {
    const wrapper = document.getElementById('board-stage');
    if (wrapper) {
      const rect = wrapper.getBoundingClientRect();
      this.renderer.resize(rect.width || 420, rect.height || 420);
    }
  }

  _setupResizeListener() {
    window.addEventListener('resize', () => this._resizeBoard());
  }

  _setupStatusIntervals() {
    setInterval(() => {
      this.ui.updateTopStatus();
    }, 1000);
  }

  _registerServiceWorker() {
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
  }

  _startMainLoop() {
    const loop = (now) => {
      if (
        this.state === GAME_STATES.PLAYING ||
        this.state === GAME_STATES.RESOLVING ||
        this.state === GAME_STATES.WIN ||
        this.state === GAME_STATES.LOSE
      ) {
        this.input.update(now);
        this.renderer.render(now);
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.sweetMatchApp = new SweetMatchApp();
});
