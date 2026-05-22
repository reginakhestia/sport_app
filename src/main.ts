import "./style.css";
import { workout } from "./workout.ts";
import type { Block, Exercise, SessionRecord } from "./types.ts";
import { el, clear } from "./dom.ts";
import { audio } from "./audio.ts";
import { ExerciseEngine, type EngineView } from "./engine.ts";
import { tg, haptic } from "./telegram.ts";
import {
  addSession,
  lastDays,
  loadSessions,
  perfectDays,
  statsForToday,
  streak,
} from "./tracking.ts";

const root = document.getElementById("app")!;
const allExercises: Exercise[] = workout.blocks.flatMap((b) => b.exercises);

// ---- App state ----
let sessions: SessionRecord[] = [];
let sessionStartedAt = 0;
// completed exercise ids within the current run-through
const doneThisSession = new Set<string>();

type View =
  | { name: "home" }
  | { name: "exercise"; index: number }
  | { name: "player"; index: number }
  | { name: "done" }
  | { name: "info" };

let view: View = { name: "home" };
let engine: ExerciseEngine | null = null;

// ---- Telegram chrome ----
function applyTheme() {
  if (!tg) return;
  const p = tg.themeParams;
  const set = (cssVar: string, val?: string) => {
    if (val) document.documentElement.style.setProperty(cssVar, val);
  };
  set("--bg", p.bg_color);
  set("--card", p.secondary_bg_color);
  set("--bg-elev", p.secondary_bg_color);
  set("--text", p.text_color);
  set("--hint", p.hint_color);
  set("--accent", p.button_color);
  set("--accent-text", p.button_text_color);
  set("--line", p.section_separator_color);
  tg.setHeaderColor?.(p.bg_color ?? "#17212b");
  tg.setBackgroundColor?.(p.bg_color ?? "#17212b");
}

function syncBackButton() {
  if (!tg) return;
  if (view.name === "home") tg.BackButton.hide();
  else tg.BackButton.show();
}

// ---- Navigation ----
function go(next: View) {
  // Tear down the player engine when leaving it.
  if (engine && next.name !== "player") {
    engine.destroy();
    engine = null;
  }
  view = next;
  render();
  syncBackButton();
  window.scrollTo(0, 0);
}

function back() {
  if (view.name === "player") go({ name: "exercise", index: view.index });
  else go({ name: "home" });
}

// ---- Views ----
function homeView(): HTMLElement {
  const today = statsForToday(sessions);
  const wrap = el("div");

  wrap.append(
    el("h1", {}, workout.title),
    el("div", { class: "hint" }, `${workout.meta.duration} · ${workout.meta.frequency}`),
  );

  // Today's two slots
  wrap.append(
    el(
      "div",
      { class: "slots" },
      slotCard("Утро", today.am),
      slotCard("Вечер", today.pm),
    ),
  );

  // Stats
  wrap.append(
    el(
      "div",
      { class: "stat-row" },
      statCard(String(streak(sessions)), "дней подряд"),
      statCard(`${today.count}/2`, "сегодня"),
      statCard(String(perfectDays(sessions, 30)), "по 2× за 30 дн"),
    ),
  );

  // Calendar strip
  const strip = el("div", { class: "strip" });
  for (const d of lastDays(sessions, 14)) {
    strip.append(
      el(
        "div",
        { class: "day", title: d.date },
        el("div", { class: `half ${d.am ? "on" : ""}` }),
        el("div", { class: `half ${d.pm ? "on" : ""}` }),
      ),
    );
  }
  wrap.append(el("div", { class: "card" }, el("div", { class: "hint" }, "Последние 14 дней"), strip));

  // Start full session
  wrap.append(
    el(
      "button",
      {
        class: "btn-primary",
        onclick: () => startSession(),
      },
      "▶︎ Начать тренировку",
    ),
    el("div", { class: "spacer" }),
  );

  // Blocks + exercises
  for (const block of workout.blocks) {
    wrap.append(blockSection(block));
  }

  // Info / warnings link
  wrap.append(
    el("div", { class: "spacer" }),
    el(
      "button",
      { class: "btn-ghost", style: { width: "100%" }, onclick: () => go({ name: "info" }) },
      "ⓘ Принципы и предостережения",
    ),
  );

  return wrap;
}

function slotCard(label: string, done: boolean): HTMLElement {
  return el(
    "div",
    { class: `slot ${done ? "done" : ""}` },
    el("div", { class: "big" }, done ? "✓" : "—"),
    el("div", { class: "lbl" }, label),
  );
}

function statCard(num: string, label: string): HTMLElement {
  return el("div", { class: "stat" }, el("div", { class: "num" }, num), el("div", { class: "lbl" }, label));
}

function blockSection(block: Block): HTMLElement {
  const wrap = el("div");
  wrap.append(
    el(
      "div",
      { class: "block-head" },
      el("span", { class: "num" }, block.number),
      el("h2", {}, block.title),
      el("span", { class: "hint" }, block.durationLabel),
    ),
  );
  for (const ex of block.exercises) {
    const index = allExercises.indexOf(ex);
    wrap.append(
      el(
        "div",
        { class: "card card-tappable ex-item", onclick: () => go({ name: "exercise", index }) },
        el("span", { class: "check" }, doneThisSession.has(ex.id) ? "✓" : ""),
        el(
          "div",
          { class: "body" },
          el("div", { class: "t" }, `${ex.number} · ${ex.title}`),
          el("div", { class: "s" }, ex.summary),
        ),
        ex.side !== "both"
          ? el("span", { class: "badge right" }, ex.side === "right" ? "справа" : "слева")
          : el("span", { class: "badge both" }, "обе"),
      ),
    );
  }
  return wrap;
}

function exerciseView(index: number): HTMLElement {
  const ex = allExercises[index];
  const wrap = el("div");

  wrap.append(
    el("div", { class: "hint" }, `Упражнение ${ex.number} · ${ex.durationLabel}`),
    el("h1", {}, ex.title),
    el("div", { class: "hint" }, ex.summary),
  );

  const desc = el("ul", { class: "desc" });
  for (const line of ex.description) desc.append(el("li", {}, line));
  wrap.append(el("div", { class: "card" }, desc));

  if (ex.cues) {
    for (const cue of ex.cues) wrap.append(el("div", { class: "cue" }, "⚠️ " + cue));
  }

  wrap.append(
    el("div", { class: "spacer" }),
    el(
      "button",
      { class: "btn-primary", onclick: () => go({ name: "player", index }) },
      "▶︎ Начать упражнение",
    ),
    el("div", { class: "spacer" }),
    el(
      "div",
      { class: "btn-row" },
      index > 0 && el("button", { class: "btn-ghost", onclick: () => go({ name: "exercise", index: index - 1 }) }, "← Пред."),
      index < allExercises.length - 1 &&
        el("button", { class: "btn-ghost", onclick: () => go({ name: "exercise", index: index + 1 }) }, "След. →"),
    ),
  );

  return wrap;
}

// ---- Player ----
const RING = 110; // radius
const CIRC = 2 * Math.PI * RING;

function playerView(index: number): HTMLElement {
  const ex = allExercises[index];
  const wrap = el("div", { class: "player" });

  wrap.append(el("div", { class: "ex-title" }, `${ex.number} · ${ex.title}`));

  // Audio toggles
  const beepToggle = el("div", { class: `toggle ${audio.enabled ? "on" : ""}` }, "🔊 Сигналы");
  const voiceToggle = el("div", { class: `toggle ${audio.voiceEnabled ? "on" : ""}` }, "🗣 Голос");
  beepToggle.addEventListener("click", () => {
    audio.enabled = !audio.enabled;
    beepToggle.className = `toggle ${audio.enabled ? "on" : ""}`;
  });
  voiceToggle.addEventListener("click", () => {
    audio.voiceEnabled = !audio.voiceEnabled;
    if (!audio.voiceEnabled) audio.shutUp();
    voiceToggle.className = `toggle ${audio.voiceEnabled ? "on" : ""}`;
  });
  wrap.append(el("div", { class: "toggle-row" }, beepToggle, voiceToggle));

  // Ring — built via SVG namespace (el() is HTML-only).
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "240");
  svg.setAttribute("height", "240");
  svg.setAttribute("viewBox", "0 0 240 240");
  const mkCircle = (cls: string) => {
    const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    c.setAttribute("cx", "120");
    c.setAttribute("cy", "120");
    c.setAttribute("r", String(RING));
    c.setAttribute("fill", "none");
    c.setAttribute("stroke-width", "14");
    c.setAttribute("class", cls);
    return c;
  };
  const bg = mkCircle("ring-bg");
  const fg = mkCircle("ring-fg");
  fg.setAttribute("stroke-dasharray", String(CIRC));
  fg.setAttribute("stroke-dashoffset", "0");
  svg.append(bg, fg);

  const timeEl = el("div", { class: "time" }, "—");
  const phaseEl = el("div", { class: "phase" }, "Готов?");
  const center = el("div", { class: "ring-center" }, phaseEl, timeEl);
  const ringWrap = el("div", { class: "ring-wrap" });
  ringWrap.append(svg, center);
  wrap.append(ringWrap);

  const subEl = el("div", { class: "sub" }, allExercises[index].summary);
  wrap.append(subEl);

  const progBar = el("div", {});
  wrap.append(el("div", { class: "progress-bar" }, progBar));

  // Controls
  const playBtn = el("button", { class: "btn-primary" }, "▶︎ Старт");
  const skipBtn = el("button", { class: "btn-ghost" }, "Пропустить шаг ⏭");
  wrap.append(el("div", { class: "controls" }, skipBtn, playBtn));

  // Full instruction, visible right here in the player so technique can be
  // checked mid-exercise without leaving the timer.
  const desc = el("ul", { class: "desc" });
  for (const line of ex.description) desc.append(el("li", {}, line));
  const instr = el("div", { class: "card instr" }, el("div", { class: "instr-head" }, "Инструкция"), desc);
  for (const cue of ex.cues ?? []) instr.append(el("div", { class: "cue" }, "⚠️ " + cue));
  wrap.append(instr);

  const update = (v: EngineView) => {
    timeEl.textContent = v.total > 0 ? String(v.remaining) : "•";
    phaseEl.textContent = v.label;
    subEl.textContent = v.sub ?? "";
    const frac = v.total > 0 ? v.remaining / v.total : 1;
    fg.setAttribute("stroke-dashoffset", String(CIRC * (1 - frac)));
    progBar.setAttribute("style", `width:${Math.round(v.exerciseProgress * 100)}%`);
    if (v.finished) {
      phaseEl.textContent = "Завершено ✓";
      timeEl.textContent = "✓";
      fg.setAttribute("stroke-dashoffset", "0");
    }
  };

  const isLast = index === allExercises.length - 1;
  engine = new ExerciseEngine(
    ex,
    update,
    () => {
      doneThisSession.add(ex.id);
      haptic("success");
      if (isLast) {
        // Reaching the end of the final exercise completes the whole session.
        playBtn.textContent = "✓ Завершить тренировку";
        playBtn.onclick = () => void finishSession();
      } else {
        playBtn.textContent = "След. упражнение →";
        playBtn.onclick = () => go({ name: "player", index: index + 1 });
      }
    },
  );

  let started = false;
  playBtn.onclick = () => {
    if (!started) {
      started = true;
      audio.unlock();
      haptic("light");
      playBtn.textContent = "⏸ Пауза";
      engine!.start();
      playBtn.onclick = togglePause;
    }
  };

  function togglePause() {
    if (!engine) return;
    if (engine.running) {
      engine.pause();
      playBtn.textContent = "▶︎ Продолжить";
    } else {
      engine.resume();
      playBtn.textContent = "⏸ Пауза";
    }
  }

  skipBtn.onclick = () => {
    if (started && engine) engine.next();
  };

  return wrap;
}

function infoView(): HTMLElement {
  const wrap = el("div", { class: "warn-list" });
  wrap.append(el("h1", {}, "Принципы и предостережения"));

  const principles = el("div", { class: "card" });
  principles.append(el("div", { class: "head" }, "Главные принципы"));
  const ul = el("ul", { class: "desc" });
  for (const p of workout.meta.principles) ul.append(el("li", {}, p));
  principles.append(ul, el("div", { class: "hint" }, "Что понадобится: " + workout.meta.equipment));
  wrap.append(principles);

  const danger = el("div", { class: "card danger-card" });
  danger.append(el("div", { class: "head" }, "🚫 НЕ делать, если:"));
  const ul2 = el("ul", { class: "desc" });
  for (const w of workout.warnings.skipIf) ul2.append(el("li", {}, w));
  danger.append(ul2);
  wrap.append(danger);

  const pause = el("div", { class: "card" });
  pause.append(el("div", { class: "head" }, "🚫 На время комплекса прекратить:"));
  const ul3 = el("ul", { class: "desc" });
  for (const w of workout.warnings.pauseActivities) ul3.append(el("li", {}, w));
  pause.append(ul3);
  wrap.append(pause);

  const add = el("div", { class: "card" });
  add.append(el("div", { class: "head" }, "✅ Что добавить:"));
  const ul4 = el("ul", { class: "desc" });
  for (const w of workout.warnings.addOns) ul4.append(el("li", {}, w));
  add.append(ul4);
  wrap.append(add);

  return wrap;
}

function doneView(): HTMLElement {
  const today = statsForToday(sessions);
  const wrap = el("div", { class: "done-screen" });
  wrap.append(
    el("div", { class: "big" }, "🎉"),
    el("h1", {}, "Тренировка засчитана!"),
    el(
      "div",
      { class: "hint" },
      today.count >= 2
        ? "Обе тренировки за сегодня выполнены. Отлично!"
        : `Сегодня: ${today.count}/2. Серия: ${streak(sessions)} дн.`,
    ),
    el("div", { class: "spacer" }),
    el("button", { class: "btn-primary", onclick: () => go({ name: "home" }) }, "На главную"),
  );
  return wrap;
}

// ---- Session lifecycle ----
function startSession() {
  doneThisSession.clear();
  sessionStartedAt = Date.now();
  go({ name: "player", index: 0 });
}

async function finishSession() {
  const durationSec = Math.round((Date.now() - sessionStartedAt) / 1000);
  sessions = await addSession(durationSec);
  haptic("success");
  go({ name: "done" });
}

// ---- Render ----
function render() {
  clear(root);
  switch (view.name) {
    case "home":
      root.append(homeView());
      break;
    case "exercise":
      root.append(exerciseView(view.index));
      break;
    case "player":
      root.append(playerView(view.index));
      break;
    case "done":
      root.append(doneView());
      break;
    case "info":
      root.append(infoView());
      break;
  }
}

// ---- Boot ----
async function boot() {
  if (tg) {
    tg.ready();
    tg.expand();
    applyTheme();
    tg.onEvent("themeChanged", applyTheme);
    tg.BackButton.onClick(back);
  }
  sessions = await loadSessions();
  render();
  syncBackButton();
}

void boot();
