/**
 * @file audio.js
 * @description Synthétiseur sonore WebAudio 100 % procédural (aucun fichier externe) + Vibrations mobile.
 * Produit les effets sonores de Sweet Match : échange, retour invalide, éclatement avec hauteur
 * croissante selon la cascade, création et activation de bonbons spéciaux, fanfare de victoire,
 * étoiles et mélodie d'ambiance douce.
 */

export class AudioManager {
  constructor(saveManager) {
    this.saveManager = saveManager;
    this.ctx = null;
    this.musicTimer = null;
    this.musicNoteIdx = 0;
  }

  _ensureContext() {
    if (!this.saveManager.data.settings.sound && !this.saveManager.data.settings.music) return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  vibrate(pattern) {
    if (!this.saveManager.data.settings.vibration) return;
    try {
      if (navigator.vibrate) {
        navigator.vibrate(pattern);
      }
    } catch (e) {
      // Ignoré sur les navigateurs sans support
    }
  }

  _playTone(freq, duration = 0.12, type = 'sine', gainVal = 0.16, slideFreq = null, delay = 0) {
    if (!this.saveManager.data.settings.sound) return;
    const ctx = this._ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (slideFreq) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideFreq), now + duration);
    }

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(gainVal, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  playSwap() {
    this._playTone(340, 0.11, 'sine', 0.14, 520);
  }

  playInvalidSwap() {
    this._playTone(240, 0.12, 'triangle', 0.15, 160, 0);
    this._playTone(170, 0.14, 'triangle', 0.15, 120, 0.1);
    this.vibrate(40);
  }

  /**
   * Son de match avec hauteur croissante selon le niveau de cascade (gamme pentatonique joyeuse).
   */
  playMatch(cascadeLevel = 1) {
    const scale = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5, 1174.66, 1318.5];
    const idx = Math.min(scale.length - 1, Math.max(0, cascadeLevel - 1));
    const baseFreq = scale[idx];
    this._playTone(baseFreq, 0.16, 'sine', 0.18, baseFreq * 1.15, 0);
    this._playTone(baseFreq * 1.25, 0.18, 'triangle', 0.12, baseFreq * 1.5, 0.045);
    if (cascadeLevel >= 3) {
      this.vibrate(25);
    }
  }

  playSpecialCreated(specialType) {
    const notes = [587.33, 783.99, 1046.5, 1318.5];
    notes.forEach((n, i) => {
      this._playTone(n, 0.14, 'triangle', 0.15, n * 1.1, i * 0.045);
    });
    this.vibrate([30, 30, 50]);
  }

  playSpecialActivated(specialType) {
    if (specialType === 'color_bomb' || specialType === 'BOMB_BOMB') {
      // Rayon électrique / arpège cosmique
      const freqs = [330, 440, 660, 880, 1320, 1760];
      freqs.forEach((f, i) => {
        this._playTone(f, 0.22, 'sawtooth', 0.09, f * 1.3, i * 0.04);
      });
      this.vibrate([60, 40, 90]);
    } else {
      // Explosion ou laser rayé
      this._playTone(720, 0.22, 'sawtooth', 0.12, 140, 0);
      this._playTone(480, 0.26, 'triangle', 0.16, 95, 0.03);
      this.vibrate(55);
    }
  }

  playStar(starIndex = 1) {
    const freqs = [659.25, 783.99, 1046.5];
    const f = freqs[(starIndex - 1) % freqs.length];
    this._playTone(f, 0.25, 'sine', 0.2, f * 1.05);
    this._playTone(f * 1.5, 0.3, 'triangle', 0.12, f * 1.52, 0.05);
  }

  playWin() {
    const melody = [
      { f: 523.25, d: 0.14, t: 0 },
      { f: 659.25, d: 0.14, t: 0.12 },
      { f: 783.99, d: 0.14, t: 0.24 },
      { f: 1046.5, d: 0.35, t: 0.36 }
    ];
    melody.forEach(n => this._playTone(n.f, n.d, 'triangle', 0.18, null, n.t));
    this.vibrate([50, 40, 50, 40, 120]);
  }

  playLose() {
    const melody = [
      { f: 392.0, d: 0.18, t: 0 },
      { f: 349.23, d: 0.18, t: 0.18 },
      { f: 329.63, d: 0.18, t: 0.36 },
      { f: 261.63, d: 0.4, t: 0.54 }
    ];
    melody.forEach(n => this._playTone(n.f, n.d, 'sine', 0.16, n.f * 0.92, n.t));
    this.vibrate([80, 60, 80]);
  }

  playClick() {
    this._playTone(620, 0.06, 'sine', 0.1, 780);
  }

  syncMusic() {
    if (this.saveManager.data.settings.music) {
      if (!this.musicTimer) {
        const notes = [523.25, 659.25, 783.99, 659.25, 587.33, 783.99, 880.0, 659.25];
        this.musicTimer = setInterval(() => {
          if (!this.saveManager.data.settings.music || document.hidden) return;
          const ctx = this._ensureContext();
          if (!ctx) return;
          const f = notes[this.musicNoteIdx % notes.length];
          this.musicNoteIdx++;
          const now = ctx.currentTime;
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(f, now);
          gain.gain.setValueAtTime(0.001, now);
          gain.gain.linearRampToValueAtTime(0.035, now + 0.05);
          gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(now);
          osc.stop(now + 0.48);
        }, 550);
      }
    } else if (this.musicTimer) {
      clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
  }
}
