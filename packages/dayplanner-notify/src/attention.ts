import type { FrontMode } from "./settings";

interface ElectronWindow {
  isMinimized(): boolean;
  isVisible(): boolean;
  restore(): void;
  show(): void;
  focus(): void;
  moveTop?(): void;
  setAlwaysOnTop(flag: boolean): void;
  flashFrame(flag: boolean): void;
}

function currentWindow(): ElectronWindow {
  // Obsidian exposes @electron/remote as electron.remote.
  return require("electron").remote.getCurrentWindow();
}

export function bringToFront(mode: FrontMode): void {
  if (mode === "off") return;
  try {
    const win = currentWindow();
    if (mode === "flash") {
      win.flashFrame(true);
      return;
    }
    if (win.isMinimized()) win.restore();
    if (!win.isVisible()) win.show();
    // Windows blocks focus stealing; a brief always-on-top lifts the window regardless.
    win.setAlwaysOnTop(true);
    win.show();
    win.focus();
    win.moveTop?.();
    window.setTimeout(() => win.setAlwaysOnTop(false), 500);
    // Fallback in case the OS still refused focus; stops once the window is focused.
    win.flashFrame(true);
  } catch (e) {
    console.error("[dayplanner-notify] bringToFront failed", e);
  }
}

export function beep(volume: number): void {
  try {
    const ctx = new AudioContext();
    const t0 = ctx.currentTime;
    const tones: Array<[number, number]> = [[0, 880], [0.22, 880], [0.44, 1320]];
    for (const [offset, freq] of tones) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, t0 + offset);
      gain.gain.linearRampToValueAtTime(volume, t0 + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + offset + 0.18);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0 + offset);
      osc.stop(t0 + offset + 0.2);
    }
    window.setTimeout(() => void ctx.close(), 1500);
  } catch (e) {
    console.error("[dayplanner-notify] beep failed", e);
  }
}
