// Getting the user's attention for a reminder: the Obsidian window to the front, and a short sound.

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

/** Brings the Obsidian window to the front, restoring it if it was minimized. */
export function bringToFront(): void {
  try {
    // Obsidian exposes @electron/remote as electron.remote.
    const win = (require("electron") as { remote: { getCurrentWindow(): ElectronWindow } }).remote.getCurrentWindow();
    if (win.isMinimized()) win.restore();
    if (!win.isVisible()) win.show();
    // Windows blocks focus stealing; a brief always-on-top lifts the window regardless.
    win.setAlwaysOnTop(true);
    win.show();
    win.focus();
    win.moveTop?.();
    window.setTimeout(() => win.setAlwaysOnTop(false), 500);
    // In case the system still refused the focus; it stops once the window is focused.
    win.flashFrame(true);
  } catch (e) {
    console.error("[secretary] could not bring Obsidian to the front", e);
  }
}

/** Three short tones, made on the spot so the plugin ships no sound file. */
export function beep(volume = 0.2): void {
  try {
    const ctx = new AudioContext();
    const t0 = ctx.currentTime;
    for (const [offset, freq] of [[0, 880], [0.22, 880], [0.44, 1320]]) {
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
    console.error("[secretary] could not play the sound", e);
  }
}
