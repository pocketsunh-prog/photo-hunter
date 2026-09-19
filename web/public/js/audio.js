/**
 * Audio: procedurally generated background music + sound effects.
 *
 * Browsers block audio until the first user gesture, so nothing is created
 * until `unlock()` runs from a pointer/key event; after that the requested
 * track starts automatically. Music and effects have separate gains so muting
 * the music never silences the "found it" chime.
 */
import { storage } from './api.js';

const BGM = {
  menu: '/assets/audio/bgm-menu.wav',
  game: '/assets/audio/bgm-game.wav',
};

const SFX = {
  found: '/assets/audio/sfx-found.wav',
  wrong: '/assets/audio/sfx-wrong.wav',
  hint: '/assets/audio/sfx-hint.wav',
  levelClear: '/assets/audio/sfx-level-clear.wav',
  gameClear: '/assets/audio/sfx-game-clear.wav',
  bonus: '/assets/audio/sfx-bonus.wav',
  click: '/assets/audio/sfx-click.wav',
};

const BGM_VOLUME = 0.5;
const SFX_VOLUME = 0.85;

class AudioManager {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.bgmGain = null;
    this.sfxGain = null;
    this.buffers = new Map();
    this.loading = null;
    this.current = null; // { name, source, gain }
    this.wantedTrack = 'menu';
    this.muted = storage.muted;
    this.unlocked = false;
  }

  get isMuted() {
    return this.muted;
  }

  /** Must be called from a real user gesture (click / pointerdown / keydown). */
  async unlock() {
    if (!this.ctx) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return false;
      this.ctx = new Ctor();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.muted ? 0 : 1;
      this.masterGain.connect(this.ctx.destination);
      this.bgmGain = this.ctx.createGain();
      this.bgmGain.gain.value = BGM_VOLUME;
      this.bgmGain.connect(this.masterGain);
      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = SFX_VOLUME;
      this.sfxGain.connect(this.masterGain);
    }
    if (this.ctx.state === 'suspended') {
      try {
        await this.ctx.resume();
      } catch {
        /* ignore */
      }
    }
    this.unlocked = true;
    await this.preload();
    if (this.wantedTrack && !this.current) this.playBgm(this.wantedTrack, { instant: true });
    return true;
  }

  async preload() {
    if (this.loading) return this.loading;
    this.loading = (async () => {
      const entries = [...Object.entries(BGM), ...Object.entries(SFX)];
      await Promise.all(
        entries.map(async ([name, url]) => {
          if (this.buffers.has(name) || !this.ctx) return;
          try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const raw = await response.arrayBuffer();
            const buffer = await this.ctx.decodeAudioData(raw);
            this.buffers.set(name, buffer);
          } catch (error) {
            console.warn(`[audio] could not load ${name} (${url})`, error);
          }
        }),
      );
    })();
    return this.loading;
  }

  setMuted(muted) {
    this.muted = muted;
    storage.muted = muted;
    if (this.masterGain && this.ctx) {
      const now = this.ctx.currentTime;
      this.masterGain.gain.cancelScheduledValues(now);
      this.masterGain.gain.setTargetAtTime(muted ? 0 : 1, now, 0.05);
    }
    return this.muted;
  }

  toggleMuted() {
    return this.setMuted(!this.muted);
  }

  /** Play a looping track, crossfading away from whatever is playing. */
  playBgm(name, { instant = false } = {}) {
    this.wantedTrack = name;
    if (!this.ctx || !this.unlocked) return;
    if (this.current?.name === name) return;
    const buffer = this.buffers.get(name);
    const fade = instant ? 0.05 : 1.0;

    if (this.current) {
      const { source, gain } = this.current;
      const now = this.ctx.currentTime;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(0.0001, now + fade);
      try {
        source.stop(now + fade + 0.05);
      } catch {
        /* already stopped */
      }
      this.current = null;
    }

    if (!buffer) return;
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const gain = this.ctx.createGain();
    const now = this.ctx.currentTime;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(BGM_VOLUME, now + fade);
    source.connect(gain);
    gain.connect(this.masterGain);
    source.start(now);
    this.current = { name, source, gain };
  }

  stopBgm({ fade = 0.6 } = {}) {
    this.wantedTrack = null;
    if (!this.ctx || !this.current) return;
    const { source, gain } = this.current;
    const now = this.ctx.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(0.0001, now + fade);
    try {
      source.stop(now + fade + 0.05);
    } catch {
      /* ignore */
    }
    this.current = null;
  }

  /** Fire-and-forget one-shot effect. */
  play(name, { volume = 1, rate = 1 } = {}) {
    if (!this.ctx || !this.unlocked || this.muted) return;
    const buffer = this.buffers.get(name);
    if (!buffer) return;
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    const gain = this.ctx.createGain();
    gain.gain.value = volume;
    source.connect(gain);
    gain.connect(this.sfxGain);
    source.start();
  }
}

export const audio = new AudioManager();
export { BGM, SFX };
