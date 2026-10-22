// Modular Audio & Sound Effects Manager
// Plays authentic project_aeii MP3 soundtracks + procedural WebAudio tactical SFX

export class SoundManager {
  constructor() {
    // ?muted=1 in the address starts the game silent (automated tests, screen recordings); the player can still unmute
    this.muted = typeof location !== 'undefined' && new URLSearchParams(location.search).get('muted') === '1';
    this.musicVolume = 0.45;
    this.sfxVolume = 0.7;
    this.currentMusic = null;
    this.currentTrackName = '';
    this.audioCtx = null;

    this.tracks = {
      menu: '/assets/audio/music/main_theme.mp3',
      good: '/assets/audio/music/bg_good.mp3',
      bad: '/assets/audio/music/bg_bad.mp3'
    };
  }

  ensureContext() {
    if (!this.audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) this.audioCtx = new Ctx();
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }
  }

  playMusic(trackKey = 'menu') {
    if (this.muted) return;
    const url = this.tracks[trackKey] || this.tracks.menu;
    if (this.currentTrackName === trackKey && this.currentMusic && !this.currentMusic.paused) {
      return;
    }
    this.stopMusic();
    this.currentTrackName = trackKey;
    const audio = new Audio(url);
    audio.loop = true;
    audio.volume = this.musicVolume;
    audio.play().catch(() => {});
    this.currentMusic = audio;
  }

  stopMusic() {
    if (this.currentMusic) {
      this.currentMusic.pause();
      this.currentMusic.currentTime = 0;
      this.currentMusic = null;
    }
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.muted) {
      this.stopMusic();
    } else {
      this.playMusic(this.currentTrackName || 'menu');
    }
    return this.muted;
  }

  playPrompt() {
    if (this.muted) return;
    const a = new Audio('/assets/audio/se/prompt.mp3');
    a.volume = this.sfxVolume;
    a.play().catch(() => {});
  }

  playSfx(type) {
    if (this.muted) return;
    this.ensureContext();
    if (!this.audioCtx) return;

    const now = this.audioCtx.currentTime;
    const osc = this.audioCtx.createOscillator();
    const gain = this.audioCtx.createGain();
    osc.connect(gain);
    gain.connect(this.audioCtx.destination);

    if (type === 'select' || type === 'move') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(type === 'select' ? 520 : 380, now);
      osc.frequency.exponentialRampToValueAtTime(type === 'select' ? 680 : 480, now + 0.07);
      gain.gain.setValueAtTime(0.18 * this.sfxVolume, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.08);
      osc.start(now);
      osc.stop(now + 0.08);
    } else if (type === 'attack') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(220, now);
      osc.frequency.exponentialRampToValueAtTime(65, now + 0.18);
      gain.gain.setValueAtTime(0.32 * this.sfxVolume, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.19);
      osc.start(now);
      osc.stop(now + 0.19);
    } else if (type === 'heal' || type === 'capture' || type === 'recruit') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.setValueAtTime(554.37, now + 0.07);
      osc.frequency.setValueAtTime(659.25, now + 0.14);
      gain.gain.setValueAtTime(0.24 * this.sfxVolume, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.28);
      osc.start(now);
      osc.stop(now + 0.28);
    } else if (type === 'summon') {
      osc.type = 'square';
      osc.frequency.setValueAtTime(160, now);
      osc.frequency.exponentialRampToValueAtTime(340, now + 0.25);
      gain.gain.setValueAtTime(0.22 * this.sfxVolume, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.26);
      osc.start(now);
      osc.stop(now + 0.26);
    }
  }
}
