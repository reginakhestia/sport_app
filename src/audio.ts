// Audio engine: WebAudio beeps + Russian speech synthesis.
//
// Designed for hands-free counting — you should be able to tell what's happening
// with your eyes closed:
//   - tick   : short mid tone, one per rep / per counted second
//   - go      : rising tone, a rep/hold starts
//   - done    : two-note "ta-da", a set/segment finished
//   - rest    : low tone, rest begins
//   - countdown: three pips then a higher pip ("3,2,1, go")
//
// Voice speaks Russian cues ("повтор 3", "поменяй сторону", "отдых 30 секунд").
// iOS requires audio to be unlocked by a user gesture, so call `unlock()` from
// the first tap (the Start button).

type Tone = "tick" | "go" | "done" | "rest" | "halfway";

export class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  enabled = true;
  voiceEnabled = true;
  private ruVoice: SpeechSynthesisVoice | null = null;

  constructor() {
    this.loadVoice();
    // Voices load async on some browsers.
    if (typeof speechSynthesis !== "undefined") {
      speechSynthesis.onvoiceschanged = () => this.loadVoice();
    }
  }

  private loadVoice() {
    if (typeof speechSynthesis === "undefined") return;
    const voices = speechSynthesis.getVoices();
    if (!voices.length) return; // not loaded yet — onvoiceschanged will retry
    this.ruVoice =
      voices.find((v) => v.lang.toLowerCase().startsWith("ru")) ??
      voices.find((v) => v.lang.toLowerCase().includes("ru")) ??
      null;
  }

  /**
   * Must be called from a user gesture (the Start tap). On mobile WebViews the
   * speech engine only "warms up" if the very first utterance is spoken inside
   * that gesture — so we speak a real (silent) primer here, not just resume.
   */
  unlock() {
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();

    if (this.voiceEnabled && typeof speechSynthesis !== "undefined") {
      this.loadVoice(); // voices are usually ready by the first tap
      // Prime the engine with a real utterance during the gesture. Using a
      // tiny near-silent word (not volume:0, which hangs some Android engines).
      speechSynthesis.resume();
      const primer = new SpeechSynthesisUtterance(" ");
      primer.volume = 0.01;
      primer.lang = "ru-RU";
      try {
        speechSynthesis.speak(primer);
      } catch {
        /* ignore */
      }
    }
  }

  private blip(freq: number, durationMs: number, type: OscillatorType = "sine", gain = 1) {
    if (!this.enabled || !this.ctx || !this.master) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    const dur = durationMs / 1000;
    // Quick attack/decay to avoid clicks.
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(gain, now + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start(now);
    osc.stop(now + dur + 0.02);
  }

  beep(tone: Tone) {
    switch (tone) {
      case "tick":
        this.blip(660, 90, "sine", 0.6);
        break;
      case "go":
        this.blip(880, 140, "triangle", 0.9);
        break;
      case "halfway":
        this.blip(560, 110, "sine", 0.5);
        break;
      case "done":
        this.blip(784, 130, "triangle", 0.9);
        window.setTimeout(() => this.blip(1046, 200, "triangle", 0.9), 140);
        break;
      case "rest":
        this.blip(330, 220, "sine", 0.7);
        break;
    }
  }

  /** "3, 2, 1" pips then a "go". Call before a hold/rep starts. */
  countdown(from = 3) {
    for (let i = 0; i < from; i++) {
      window.setTimeout(() => this.blip(440, 120, "sine", 0.7), i * 1000);
    }
    window.setTimeout(() => this.beep("go"), from * 1000);
  }

  say(text: string) {
    if (!this.voiceEnabled || typeof speechSynthesis === "undefined") return;
    // Android/Telegram WebView frequently leaves the engine paused after a
    // prior cancel(); resume() before every speak() keeps it from going mute.
    try {
      speechSynthesis.resume();
    } catch {
      /* ignore */
    }
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "ru-RU";
    // Only pin a voice if we actually found a Russian one; otherwise let the
    // platform pick by lang — pinning a null/absent voice silences output.
    if (this.ruVoice) u.voice = this.ruVoice;
    u.rate = 1.0;
    u.pitch = 1.0;
    u.volume = 1.0;
    speechSynthesis.speak(u);
    this.keepAlive();
  }

  // WebKit/Chromium pause the speech engine if an utterance runs >~15s or the
  // tab loses focus; a periodic resume() keeps the queue moving. Cheap no-op
  // when nothing is queued.
  private keepAliveTimer: number | null = null;
  private keepAlive() {
    if (this.keepAliveTimer != null) return;
    this.keepAliveTimer = window.setInterval(() => {
      if (typeof speechSynthesis === "undefined") return;
      if (speechSynthesis.speaking || speechSynthesis.pending) {
        speechSynthesis.resume();
      } else {
        if (this.keepAliveTimer != null) window.clearInterval(this.keepAliveTimer);
        this.keepAliveTimer = null;
      }
    }, 5000);
  }

  /** Stop any queued speech (e.g. on pause/skip). */
  shutUp() {
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
  }
}

export const audio = new Audio();
