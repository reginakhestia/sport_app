// Data model for the workout.
//
// The whole routine is a list of BLOCKS, each holding a list of EXERCISES.
// An exercise is driven by the timer engine through a list of STEPS. A step is
// one timed unit the engine can announce and count down/up:
//
//  - "hold"     : hold a position for `seconds` (e.g. isometric 8 sec hold).
//  - "rep"      : one repetition lasting `seconds` (tempo reps like 3s up/3s down).
//  - "rest"     : a rest pause between sets/sides.
//  - "breath"   : a guided breath cycle (inhale `inhale`s / exhale `exhale`s).
//  - "say"      : an instant spoken/visual cue with no duration (e.g. "switch sides").
//
// The engine expands `sets`/`reps`/`sides` into a flat sequence of steps so it
// can speak "подход 2", "повтор 5", "поменяй сторону" without per-exercise code.

export type Side = "right" | "left" | "both";

export interface BreathStep {
  kind: "breath";
  inhale: number; // seconds
  exhale: number; // seconds
  cycles: number;
}

export interface HoldStep {
  kind: "hold";
  seconds: number;
  /** repetitions of the hold (e.g. 30 sec × 3) */
  count: number;
  /** rest between holds, seconds */
  rest?: number;
  /** spoken label, e.g. "удержание" */
  label?: string;
}

export interface RepStep {
  kind: "reps";
  /** number of repetitions */
  count: number;
  /** seconds per rep (tempo). If omitted, reps are user-paced with a single tick. */
  secondsPerRep?: number;
  /**
   * Tempo broken into phases — when set, the engine voices "Вверх"/"Вниз"
   * (and optionally a hold) instead of one announcement per rep. Overrides
   * `secondsPerRep`. `up` = lift, `hold` = pause at top, `down` = lower.
   */
  tempo?: { up: number; hold?: number; down: number };
  /** number of sets */
  sets?: number;
  /** rest between sets, seconds */
  rest?: number;
  label?: string;
}

export type ExerciseStep = BreathStep | HoldStep | RepStep;

/** A side-specific segment: some exercises do left then right with different volume. */
export interface SideSegment {
  side: Side;
  /** spoken intro for this segment, e.g. "Сначала левая сторона" */
  intro?: string;
  steps: ExerciseStep[];
}

export interface Exercise {
  id: string;
  /** "2.1" etc. — keeps mapping to the source document obvious */
  number: string;
  title: string;
  /** short one-line summary shown in lists */
  summary: string;
  /** full bullet-by-bullet description, rendered as a list */
  description: string[];
  /** technique cues / warnings (the "> " callouts in the source) */
  cues?: string[];
  /** which side(s) this targets — for the summary table badge */
  side: Side;
  /** approximate duration label from the source, e.g. "2 минуты" */
  durationLabel: string;
  /** ordered timed segments that the engine plays */
  segments: SideSegment[];
}

export interface Block {
  id: string;
  number: string;
  title: string;
  /** "4 минуты" */
  durationLabel: string;
  /** intro/principles text shown above the exercises */
  note?: string;
  exercises: Exercise[];
}

export interface Workout {
  title: string;
  meta: {
    duration: string;
    frequency: string;
    principles: string[];
    equipment: string;
  };
  blocks: Block[];
  warnings: {
    skipIf: string[];
    pauseActivities: string[];
    addOns: string[];
  };
}

// ---- Tracking ----

export type Slot = "am" | "pm";

export interface SessionRecord {
  /** ISO timestamp when the session was completed */
  at: number;
  /** local date key YYYY-MM-DD */
  date: string;
  slot: Slot;
  /** seconds the session took */
  durationSec: number;
}
