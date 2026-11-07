/**
 * @file save.js
 * @description Gestionnaire de sauvegarde dans localStorage (toujours encapsulé dans try/catch).
 * Gère la progression des niveaux, les étoiles, les records, les 5 vies (régénération toutes les 30 min),
 * la monnaie virtuelle (cristaux de sucre), les boosters et les paramètres d'accessibilité/audio.
 */

const STORAGE_KEY = 'sweet_match_save_v1';
export const MAX_LIVES = 5;
export const LIFE_REGEN_MS = 30 * 60 * 1000; // 30 minutes en millisecondes

const DEFAULT_SAVE = {
  unlockedLevel: 1,
  starsByLevel: {},     // { [levelId]: 1 | 2 | 3 }
  highScoreByLevel: {}, // { [levelId]: number }
  totalStars: 0,
  coins: 250,           // Monnaie virtuelle gratuite gagnée en jouant
  lives: MAX_LIVES,
  lastLifeTimestamp: Date.now(),
  boosters: {
    hammer: 3,          // Marteau sucré : casse une case
    free_swap: 2,       // Main magique : échange libre
    extra_moves: 2,     // +5 coups
    color_bomb: 1       // Bombe couleur de départ
  },
  settings: {
    sound: true,
    music: false,
    vibration: true,
    colorblind: false   // Mode daltonien (symboles haute visibilité)
  }
};

export class SaveManager {
  constructor() {
    this.data = this.load();
    this.syncLives();
  }

  load() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return JSON.parse(JSON.stringify(DEFAULT_SAVE));
      const parsed = JSON.parse(raw);
      return {
        ...JSON.parse(JSON.stringify(DEFAULT_SAVE)),
        ...parsed,
        boosters: { ...DEFAULT_SAVE.boosters, ...(parsed.boosters || {}) },
        settings: { ...DEFAULT_SAVE.settings, ...(parsed.settings || {}) }
      };
    } catch (e) {
      return JSON.parse(JSON.stringify(DEFAULT_SAVE));
    }
  }

  save() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
    } catch (e) {
      // Ignore en cas de navigation privée stricte ou quota dépassé
    }
  }

  resetAll() {
    this.data = JSON.parse(JSON.stringify(DEFAULT_SAVE));
    this.data.lastLifeTimestamp = Date.now();
    this.save();
    return this.data;
  }

  /**
   * Met à jour le nombre de vies selon le temps écoulé (1 vie toutes les 30 min).
   * Retourne le nombre de millisecondes avant la prochaine vie (ou 0 si plein).
   */
  syncLives() {
    if (this.data.lives >= MAX_LIVES) {
      this.data.lives = MAX_LIVES;
      this.data.lastLifeTimestamp = Date.now();
      return 0;
    }

    const now = Date.now();
    const elapsed = Math.max(0, now - (this.data.lastLifeTimestamp || now));
    const gained = Math.floor(elapsed / LIFE_REGEN_MS);

    if (gained > 0) {
      this.data.lives = Math.min(MAX_LIVES, this.data.lives + gained);
      if (this.data.lives >= MAX_LIVES) {
        this.data.lastLifeTimestamp = now;
      } else {
        this.data.lastLifeTimestamp += gained * LIFE_REGEN_MS;
      }
      this.save();
    }

    if (this.data.lives >= MAX_LIVES) return 0;
    return Math.max(0, LIFE_REGEN_MS - (now - this.data.lastLifeTimestamp));
  }

  consumeLife() {
    this.syncLives();
    if (this.data.lives <= 0) return false;
    if (this.data.lives === MAX_LIVES) {
      this.data.lastLifeTimestamp = Date.now();
    }
    this.data.lives--;
    this.save();
    return true;
  }

  refillLivesFree() {
    this.data.lives = MAX_LIVES;
    this.data.lastLifeTimestamp = Date.now();
    this.save();
  }

  recordLevelWin(levelId, score, stars) {
    const prevStars = this.data.starsByLevel[levelId] || 0;
    const prevHigh = this.data.highScoreByLevel[levelId] || 0;

    if (stars > prevStars) {
      this.data.starsByLevel[levelId] = stars;
    }
    if (score > prevHigh) {
      this.data.highScoreByLevel[levelId] = score;
    }
    if (levelId >= this.data.unlockedLevel && levelId < 100) {
      this.data.unlockedLevel = levelId + 1;
    }

    // Recalculer le total d'étoiles
    this.data.totalStars = Object.values(this.data.starsByLevel).reduce((a, b) => a + b, 0);

    // Récompense en cristaux de sucre
    const coinReward = 30 + stars * 15 + (stars > prevStars ? (stars - prevStars) * 20 : 0);
    this.data.coins += coinReward;
    this.save();
    return { coinReward, isNewRecord: score > prevHigh };
  }

  useBooster(type) {
    if (!this.data.boosters[type] || this.data.boosters[type] <= 0) return false;
    this.data.boosters[type]--;
    this.save();
    return true;
  }

  buyItem(itemKey, cost, amount = 1) {
    if (this.data.coins < cost) return false;
    this.data.coins -= cost;
    if (itemKey === 'lives') {
      this.refillLivesFree();
    } else if (this.data.boosters[itemKey] !== undefined) {
      this.data.boosters[itemKey] += amount;
    }
    this.save();
    return true;
  }

  updateSetting(key, value) {
    this.data.settings[key] = value;
    this.save();
  }
}
