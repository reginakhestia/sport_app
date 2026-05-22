import type { SessionRecord, Slot } from "./types.ts";
import { storeGet, storeSet } from "./telegram.ts";

const KEY = "sessions_v1";

// Local date helpers (avoid UTC drift — tracking is about the user's local day).
export function dateKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function currentSlot(d = new Date()): Slot {
  return d.getHours() < 14 ? "am" : "pm";
}

export async function loadSessions(): Promise<SessionRecord[]> {
  const raw = await storeGet(KEY);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as SessionRecord[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export async function addSession(durationSec: number): Promise<SessionRecord[]> {
  const sessions = await loadSessions();
  const now = new Date();
  sessions.push({ at: now.getTime(), date: dateKey(now), slot: currentSlot(now), durationSec });
  // Keep the last ~400 records (well over a year) to bound CloudStorage size.
  const trimmed = sessions.slice(-400);
  await storeSet(KEY, JSON.stringify(trimmed));
  return trimmed;
}

export interface DayStat {
  date: string;
  am: boolean;
  pm: boolean;
  count: number;
}

export function statsForToday(sessions: SessionRecord[]): DayStat {
  const today = dateKey();
  const todays = sessions.filter((s) => s.date === today);
  return {
    date: today,
    am: todays.some((s) => s.slot === "am"),
    pm: todays.some((s) => s.slot === "pm"),
    count: todays.length,
  };
}

/** Streak = consecutive days (ending today or yesterday) with at least one session. */
export function streak(sessions: SessionRecord[]): number {
  const days = new Set(sessions.map((s) => s.date));
  let count = 0;
  const cursor = new Date();
  // Allow the streak to "hold" if today isn't done yet but yesterday was.
  if (!days.has(dateKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  while (days.has(dateKey(cursor))) {
    count++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return count;
}

/** Number of days in the last `n` days that hit the 2/day goal. */
export function perfectDays(sessions: SessionRecord[], n = 30): number {
  const byDay = new Map<string, number>();
  for (const s of sessions) byDay.set(s.date, (byDay.get(s.date) ?? 0) + 1);
  let perfect = 0;
  const cursor = new Date();
  for (let i = 0; i < n; i++) {
    if ((byDay.get(dateKey(cursor)) ?? 0) >= 2) perfect++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return perfect;
}

/** Last `n` days as booleans-per-slot, newest last — for the calendar strip. */
export function lastDays(sessions: SessionRecord[], n = 14): DayStat[] {
  const byDay = new Map<string, SessionRecord[]>();
  for (const s of sessions) {
    const list = byDay.get(s.date) ?? [];
    list.push(s);
    byDay.set(s.date, list);
  }
  const out: DayStat[] = [];
  const cursor = new Date();
  cursor.setDate(cursor.getDate() - (n - 1));
  for (let i = 0; i < n; i++) {
    const key = dateKey(cursor);
    const list = byDay.get(key) ?? [];
    out.push({
      date: key,
      am: list.some((s) => s.slot === "am"),
      pm: list.some((s) => s.slot === "pm"),
      count: list.length,
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}
