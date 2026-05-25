import type { Exercise, ExerciseStep, SideSegment } from "./types.ts";
import { audio } from "./audio.ts";

// The engine expands an exercise into a flat list of PHASES and plays them on a
// single 100ms clock. Each phase has a duration; the engine speaks/beeps at the
// right moments so the user never has to look at the screen.

type PhaseKind = "countdown" | "rep" | "hold" | "rest" | "breathIn" | "breathOut" | "say" | "walk";

interface Phase {
  kind: PhaseKind;
  seconds: number;
  /** spoken announcement at the start of the phase */
  announce?: string;
  /** large label shown on screen */
  label: string;
  /** small sub-label, e.g. "повтор 3 из 10" */
  sub?: string;
  /** beep tone fired at phase start */
  startBeep?: Parameters<typeof audio.beep>[0];
  /** for reps: tick every second; for holds: tick on whole seconds */
  tickEachSecond?: boolean;
}

const sideWord: Record<string, string> = { right: "правая", left: "левая", both: "обе" };

function expandStep(step: ExerciseStep, phases: Phase[]) {
  if (step.kind === "breath") {
    for (let c = 1; c <= step.cycles; c++) {
      phases.push({
        kind: "breathIn",
        seconds: step.inhale,
        announce: "Вдох",
        label: "Вдох",
        sub: `цикл ${c} из ${step.cycles}`,
        startBeep: "go",
      });
      phases.push({
        kind: "breathOut",
        seconds: step.exhale,
        announce: "Выдох",
        label: "Выдох",
        sub: `цикл ${c} из ${step.cycles}`,
        startBeep: "halfway",
      });
    }
    phases.push({ kind: "say", seconds: 0, announce: "Дыхание завершено", label: "Готово", startBeep: "done" });
    return;
  }

  if (step.kind === "hold") {
    const label = step.label ?? "Удержание";
    for (let i = 1; i <= step.count; i++) {
      phases.push({
        kind: "countdown",
        seconds: 3,
        announce: step.count > 1 ? `Подход ${i}` : undefined,
        label: "Приготовься",
        sub: step.count > 1 ? `${i} из ${step.count}` : undefined,
      });
      const counted = step.seconds <= 12; // short holds get a per-second beep
      phases.push({
        kind: "hold",
        seconds: step.seconds,
        label,
        sub: `удержание ${step.seconds} сек · ${i} из ${step.count}`,
        startBeep: "go",
        tickEachSecond: counted,
      });
      // For counted holds, say "отпускай" at the end so the release is audible.
      if (counted) {
        phases.push({ kind: "say", seconds: 0, announce: "Отпускай", label, startBeep: "done" });
      }
      if (step.rest && i < step.count) {
        phases.push({
          kind: "rest",
          seconds: step.rest,
          announce: `Отдых ${step.rest} секунд`,
          label: "Отдых",
          sub: `${step.rest} сек`,
          startBeep: "rest",
        });
      }
    }
    return;
  }

  // reps
  const sets = step.sets ?? 1;
  const label = step.label ?? "Повтор";
  for (let s = 1; s <= sets; s++) {
    if (sets > 1) {
      phases.push({
        kind: "say",
        seconds: 0,
        announce: `Подход ${s} из ${sets}`,
        label: `Подход ${s}/${sets}`,
        startBeep: "go",
      });
    }
    phases.push({ kind: "countdown", seconds: 3, label: "Приготовься" });
    for (let r = 1; r <= step.count; r++) {
      const sub = `повтор ${r} из ${step.count}`;
      if (step.tempo) {
        // Voiced tempo: "Вверх N" → ["Держи"] → "Вниз".
        phases.push({
          kind: "rep",
          seconds: step.tempo.up,
          announce: `Вверх ${r}`,
          label: "Вверх",
          sub,
          startBeep: "go",
        });
        if (step.tempo.hold) {
          phases.push({
            kind: "rep",
            seconds: step.tempo.hold,
            announce: "Держи",
            label: "Держи",
            sub,
            startBeep: "tick",
          });
        }
        phases.push({
          kind: "rep",
          seconds: step.tempo.down,
          announce: "Вниз",
          label: "Вниз",
          sub,
          startBeep: "halfway",
        });
      } else {
        const dur = step.secondsPerRep ?? 2;
        phases.push({
          kind: "rep",
          seconds: dur,
          // speak every rep number so you can count with eyes closed
          announce: String(r),
          label,
          sub,
          startBeep: "tick",
        });
      }
    }
    phases.push({
      kind: "say",
      seconds: 0,
      announce: "Подход завершён",
      label: "Подход завершён",
      startBeep: "done",
    });
    if (step.rest && s < sets) {
      phases.push({
        kind: "rest",
        seconds: step.rest,
        announce: `Отдых ${step.rest} секунд`,
        label: "Отдых",
        sub: `${step.rest} сек`,
        startBeep: "rest",
      });
    }
  }
}

function expandSegment(seg: SideSegment, phases: Phase[]) {
  const intro = seg.intro ?? (seg.side !== "both" ? `Сторона: ${sideWord[seg.side]}` : undefined);
  if (intro) {
    phases.push({ kind: "say", seconds: 0, announce: intro, label: intro, startBeep: "rest" });
  }
  for (const step of seg.steps) expandStep(step, phases);
}

export function buildPhases(ex: Exercise): Phase[] {
  const phases: Phase[] = [];
  for (const seg of ex.segments) expandSegment(seg, phases);
  return phases;
}

export interface EngineView {
  label: string;
  sub?: string;
  /** seconds remaining in current phase */
  remaining: number;
  /** total seconds of current phase (for the ring) */
  total: number;
  /** 0..1 progress through all phases of this exercise */
  exerciseProgress: number;
  running: boolean;
  finished: boolean;
}

export class ExerciseEngine {
  private phases: Phase[] = [];
  private idx = 0;
  private remainingMs = 0;
  private timer: number | null = null;
  private lastTickSec = -1;
  running = false;
  finished = false;

  constructor(
    ex: Exercise,
    private onUpdate: (v: EngineView) => void,
    private onFinish: () => void,
  ) {
    this.phases = buildPhases(ex);
  }

  private get phase(): Phase | undefined {
    return this.phases[this.idx];
  }

  start() {
    audio.unlock();
    this.running = true;
    this.beginPhase();
    this.timer = window.setInterval(() => this.tick(), 100);
  }

  private beginPhase() {
    const p = this.phase;
    if (!p) return this.finish();
    this.remainingMs = p.seconds * 1000;
    this.lastTickSec = -1;
    if (p.startBeep) audio.beep(p.startBeep);
    // Speak just after the beep — firing both at the exact same instant can let
    // the WebAudio output starve the TTS engine on some mobile WebViews.
    if (p.announce) {
      const text = p.announce;
      window.setTimeout(() => audio.say(text), 120);
    }
    if (p.kind === "countdown") audio.countdown(p.seconds);
    // Zero-duration "say" phases advance on the next tick automatically.
    this.emit();
  }

  private tick() {
    if (!this.running) return;
    const p = this.phase;
    if (!p) return this.finish();

    this.remainingMs -= 100;

    // Per-second beeps for reps and short holds, so counts are audible.
    if (p.tickEachSecond || p.kind === "rep") {
      const sec = Math.ceil(this.remainingMs / 1000);
      if (sec !== this.lastTickSec && sec > 0 && p.kind === "hold") {
        audio.beep("tick");
      }
      this.lastTickSec = sec;
    }

    if (this.remainingMs <= 0) {
      this.idx++;
      if (this.idx >= this.phases.length) return this.finish();
      this.beginPhase();
      return;
    }
    this.emit();
  }

  private emit() {
    const p = this.phase;
    if (!p) return;
    const totalPhases = this.phases.length;
    this.onUpdate({
      label: p.label,
      sub: p.sub,
      remaining: Math.max(0, Math.ceil(this.remainingMs / 1000)),
      total: p.seconds,
      exerciseProgress: totalPhases ? this.idx / totalPhases : 1,
      running: this.running,
      finished: this.finished,
    });
  }

  pause() {
    this.running = false;
    audio.shutUp();
    if (this.timer) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    this.emit();
  }

  resume() {
    if (this.finished) return;
    this.running = true;
    this.timer = window.setInterval(() => this.tick(), 100);
    this.emit();
  }

  /** Skip to the next phase (e.g. cut a hold short). */
  next() {
    audio.shutUp();
    this.idx++;
    if (this.idx >= this.phases.length) return this.finish();
    this.beginPhase();
  }

  private finish() {
    this.running = false;
    this.finished = true;
    if (this.timer) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    audio.beep("done");
    audio.say("Упражнение завершено");
    this.onUpdate({
      label: "Завершено",
      remaining: 0,
      total: 0,
      exerciseProgress: 1,
      running: false,
      finished: true,
    });
    this.onFinish();
  }

  destroy() {
    if (this.timer) window.clearInterval(this.timer);
    audio.shutUp();
  }
}
