import { App, PluginSettingTab, Setting } from "obsidian";
import type DayPlannerNotify from "./main";
import { parsePostponeOptions } from "./reschedule";

export type FrontMode = "off" | "flash" | "front";

export interface NotifySettings {
  enabled: boolean;
  frontMode: FrontMode;
  sound: boolean;
  volume: number;
  repeatSeconds: number;
  maxRepeats: number;
  postponeOptions: number[];
}

export const DEFAULT_SETTINGS: NotifySettings = {
  enabled: true,
  frontMode: "front",
  sound: true,
  volume: 0.3,
  repeatSeconds: 60,
  maxRepeats: 10,
  postponeOptions: [15, 30, 45, 60],
};

/** Saved data over defaults. Unknown or mistyped keys are dropped. */
export function mergeSettings(saved: unknown): NotifySettings {
  const merged: NotifySettings = { ...DEFAULT_SETTINGS, postponeOptions: [...DEFAULT_SETTINGS.postponeOptions] };
  if (saved === null || typeof saved !== "object") return merged;
  const data = saved as Record<string, unknown>;
  const target = merged as unknown as Record<string, unknown>;
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (key === "postponeOptions") continue;
    if (typeof data[key] === typeof target[key]) target[key] = data[key];
  }
  if (Array.isArray(data.postponeOptions)) {
    const opts = parsePostponeOptions(data.postponeOptions.join(","));
    if (opts.length > 0) merged.postponeOptions = opts;
  }
  return merged;
}

export class NotifySettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: DayPlannerNotify) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const s = this.plugin.settings;
    const t = this.plugin.s.settings;
    const save = () => this.plugin.saveSettings();
    const numberField = (min: number, apply: (n: number) => void) => (v: string) => {
      const n = Number(v);
      if (v.trim() === "" || !Number.isFinite(n) || n < min) return;
      apply(n);
      void save();
    };

    new Setting(containerEl)
      .setName(t.enabled)
      .setDesc(t.enabledDesc)
      .addToggle((c) => c.setValue(s.enabled).onChange(async (v) => { s.enabled = v; await save(); }));

    new Setting(containerEl)
      .setName(t.frontMode)
      .setDesc(t.frontModeDesc)
      .addDropdown((d) =>
        d
          .addOptions({ off: "off", flash: "flash", front: "front" })
          .setValue(s.frontMode)
          .onChange(async (v) => { s.frontMode = v as FrontMode; await save(); }),
      );

    new Setting(containerEl)
      .setName(t.sound)
      .addToggle((c) => c.setValue(s.sound).onChange(async (v) => { s.sound = v; await save(); }));

    new Setting(containerEl)
      .setName(t.volume)
      .addSlider((sl) =>
        sl.setLimits(0.05, 1, 0.05).setValue(s.volume).setDynamicTooltip()
          .onChange(async (v) => { s.volume = v; await save(); }),
      );

    new Setting(containerEl)
      .setName(t.repeatSeconds)
      .setDesc(t.repeatSecondsDesc)
      .addText((c) => c.setValue(String(s.repeatSeconds))
        .onChange(numberField(0, (n) => { s.repeatSeconds = Math.floor(n); })));

    new Setting(containerEl)
      .setName(t.maxRepeats)
      .addText((c) => c.setValue(String(s.maxRepeats))
        .onChange(numberField(0, (n) => { s.maxRepeats = Math.floor(n); })));

    new Setting(containerEl)
      .setName(t.postponeOptions)
      .setDesc(t.postponeOptionsDesc)
      .addText((c) =>
        c.setPlaceholder("15, 30, 45, 60").setValue(s.postponeOptions.join(", ")).onChange(async (v) => {
          const opts = parsePostponeOptions(v);
          if (opts.length === 0) return;
          s.postponeOptions = opts;
          await save();
        }),
      );
  }
}
