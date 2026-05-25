// Audio engine: WebAudio beeps + pre-recorded Russian voice clips.
//
// We do NOT use the platform SpeechSynthesis API — it is silent in the mobile
// Telegram WebView (no installed voice / blocked engine). Instead we ship small
// pre-rendered .m4a clips (generated with macOS `say` voice "Milena") under
// /voice and play them through the same AudioContext as the beeps, which works
// anywhere sound works.
//
// `say(text)` maps a phrase to a sequence of clip keys (e.g. "Вверх 3" →
// ["vverh", "n3"]) and plays them back-to-back so we don't need a clip for
// every number/phrase combination.
//
// Hands-free cues, eyes closed:
//   tick  : short mid tone, one per counted second
//   go    : rising tone, a rep/hold starts
//   done  : two-note "ta-da", a set/segment finished
//   rest  : low tone, rest begins
//   countdown: three pips then a "go"
//
// iOS/Android require audio to be unlocked by a user gesture, so `unlock()` is
// called from the first tap (Start / "Проверить голос").

type Tone = "tick" | "go" | "done" | "rest" | "halfway";

// Vite serves /public at the app base; import.meta.env.BASE_URL handles the
// GitHub Pages sub-path ("/sport_app/").
const VOICE_BASE = `${import.meta.env.BASE_URL}voice/`;

const NUM_WORDS = [
  "n0", "n1", "n2", "n3", "n4", "n5", "n6", "n7", "n8", "n9", "n10",
  "n11", "n12", "n13", "n14", "n15", "n16", "n17", "n18", "n19", "n20",
];

export class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  enabled = true;
  voiceEnabled = true;

  // Decoded clip cache + a monotonically increasing token so a new utterance
  // (or shutUp) cancels any still-queued clips from a previous one.
  private buffers = new Map<string, AudioBuffer>();
  private voiceGain: GainNode | null = null;
  private playToken = 0;
  private currentSource: AudioBufferSourceNode | null = null;

  /** Map a phrase the engine produces into an ordered list of clip keys. */
  private phraseToClips(text: string): string[] {
    const t = text.trim();

    // "Вверх 3" → ["vverh", "n3"]
    const upMatch = t.match(/^Вверх\s+(\d+)$/i);
    if (upMatch) return ["vverh", `n${upMatch[1]}`];

    // "Подход 2 из 2" → ["podhod", "n2", "iz", "n2"]
    const setOf = t.match(/^Подход\s+(\d+)\s+из\s+(\d+)$/i);
    if (setOf) return ["podhod", `n${setOf[1]}`, "iz", `n${setOf[2]}`];

    // "Подход 2" → ["podhod", "n2"]
    const setN = t.match(/^Подход\s+(\d+)$/i);
    if (setN) return ["podhod", `n${setN[1]}`];

    // "Отдых 30 секунд" → ["otdyh", "n30", "sekund"]
    const rest = t.match(/^Отдых\s+(\d+)\s+секунд[ы]?$/i);
    if (rest) return ["otdyh", `n${rest[1]}`, "sekund"];

    // Bare number (a rep count voiced as just "3").
    if (/^\d+$/.test(t)) return [`n${t}`];

    const direct: Record<string, string> = {
      "Вдох": "vdoh",
      "Выдох": "vydoh",
      "Вниз": "vniz",
      "Держи": "derzhi",
      "Отпускай": "otpuskay",
      "Приготовься": "prigotovsya",
      "Дыхание завершено": "breath_done",
      "Подход завершён": "set_done",
      "Упражнение завершено": "ex_done",
      "Сначала левая сторона — лёжа на правом боку": "side_left",
      "Теперь правая сторона — лёжа на левом боку": "side_right",
    };
    if (direct[t]) return [direct[t]];

    // Unknown phrase — nothing to play (rather than a wrong clip).
    return [];
  }

  private async loadClip(key: string): Promise<AudioBuffer | null> {
    if (!this.ctx) return null;
    const cached = this.buffers.get(key);
    if (cached) return cached;
    try {
      const res = await fetch(`${VOICE_BASE}${key}.m4a`);
      const arr = await res.arrayBuffer();
      const buf = await this.ctx.decodeAudioData(arr);
      this.buffers.set(key, buf);
      return buf;
    } catch {
      return null;
    }
  }

  /** Pre-fetch every clip once unlocked, so playback has no network latency. */
  private async preloadAll() {
    const keys = [
      "vdoh", "vydoh", "vverh", "vniz", "derzhi", "otpuskay", "podhod", "iz",
      "otdyh", "sekund", "breath_done", "set_done", "ex_done", "side_left",
      "side_right", "prigotovsya", "n30", ...NUM_WORDS,
    ];
    await Promise.all(keys.map((k) => this.loadClip(k)));
  }

  /** Must be called from a user gesture (the Start tap) to unlock audio. */
  unlock() {
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      this.voiceGain = this.ctx.createGain();
      this.voiceGain.gain.value = 1.0;
      this.voiceGain.connect(this.ctx.destination);
      void this.preloadAll();
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  private blip(freq: number, durationMs: number, type: OscillatorType = "sine", gain = 1) {
    if (!this.enabled || !this.ctx || !this.master) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    const dur = durationMs / 1000;
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

  /** "3, 2, 1" pips then a "go". */
  countdown(from = 3) {
    for (let i = 0; i < from; i++) {
      window.setTimeout(() => this.blip(440, 120, "sine", 0.7), i * 1000);
    }
    window.setTimeout(() => this.beep("go"), from * 1000);
  }

  /** Speak a phrase by playing its clip sequence through WebAudio. */
  say(text: string) {
    if (!this.voiceEnabled || !this.ctx) return;
    const clips = this.phraseToClips(text);
    if (!clips.length) return;
    const token = ++this.playToken; // supersedes any in-flight utterance
    void this.playSequence(clips, token);
  }

  private async playSequence(keys: string[], token: number) {
    const bufs = await Promise.all(keys.map((k) => this.loadClip(k)));
    if (token !== this.playToken || !this.ctx || !this.voiceGain) return;
    if (this.ctx.state === "suspended") await this.ctx.resume();
    let when = this.ctx.currentTime;
    for (const buf of bufs) {
      if (!buf) continue;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.connect(this.voiceGain);
      src.start(when);
      when += buf.duration + 0.04; // tiny gap between words
      this.currentSource = src;
    }
  }

  /** Stop any queued/playing voice (on pause/skip). */
  shutUp() {
    this.playToken++; // any pending playSequence will bail out
    if (this.currentSource) {
      try {
        this.currentSource.stop();
      } catch {
        /* already stopped */
      }
      this.currentSource = null;
    }
  }

  /** True if voice clips can play (audio context exists). For diagnostics. */
  get ready(): boolean {
    return !!this.ctx;
  }
}

export const audio = new Audio();
