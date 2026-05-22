// Thin typed wrapper around the Telegram WebApp SDK loaded in index.html.
// Falls back gracefully when opened in a plain browser (for local dev).

interface CloudStorage {
  setItem(key: string, value: string, cb?: (err: string | null, ok?: boolean) => void): void;
  getItem(key: string, cb: (err: string | null, value?: string) => void): void;
  removeItem(key: string, cb?: (err: string | null, ok?: boolean) => void): void;
}

interface HapticFeedback {
  impactOccurred(style: "light" | "medium" | "heavy" | "rigid" | "soft"): void;
  notificationOccurred(type: "error" | "success" | "warning"): void;
}

interface TgWebApp {
  ready(): void;
  expand(): void;
  setHeaderColor?(color: string): void;
  setBackgroundColor?(color: string): void;
  colorScheme: "light" | "dark";
  themeParams: Record<string, string>;
  CloudStorage?: CloudStorage;
  HapticFeedback?: HapticFeedback;
  BackButton: { show(): void; hide(): void; onClick(cb: () => void): void; offClick(cb: () => void): void };
  onEvent(event: string, cb: () => void): void;
}

export const tg: TgWebApp | undefined = (window as unknown as { Telegram?: { WebApp: TgWebApp } }).Telegram
  ?.WebApp;

export const inTelegram = !!tg && !!tg.CloudStorage;

export function haptic(kind: "light" | "success" | "warning") {
  if (!tg?.HapticFeedback) return;
  if (kind === "success" || kind === "warning") tg.HapticFeedback.notificationOccurred(kind);
  else tg.HapticFeedback.impactOccurred("light");
}

// Storage: CloudStorage in Telegram, localStorage otherwise.
export function storeGet(key: string): Promise<string | null> {
  if (tg?.CloudStorage) {
    return new Promise((resolve) => {
      tg.CloudStorage!.getItem(key, (err, val) => resolve(err ? null : (val ?? null)));
    });
  }
  return Promise.resolve(localStorage.getItem(key));
}

export function storeSet(key: string, value: string): Promise<void> {
  if (tg?.CloudStorage) {
    return new Promise((resolve) => {
      tg.CloudStorage!.setItem(key, value, () => resolve());
    });
  }
  localStorage.setItem(key, value);
  return Promise.resolve();
}
