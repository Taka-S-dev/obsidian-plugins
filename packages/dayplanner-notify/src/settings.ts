import { App, PluginSettingTab, Setting } from "obsidian";
import type DayPlannerNotify from "./main";
import { parseShiftOptions } from "./reschedule";

export type FrontMode = "off" | "flash" | "front";

export interface NotifySettings {
  enabled: boolean;
  frontMode: FrontMode;
  sound: boolean;
  volume: number;
  repeatSeconds: number;
  maxRepeats: number;
  shiftOptions: number[];
}

export const DEFAULT_SETTINGS: NotifySettings = {
  enabled: true,
  frontMode: "front",
  sound: true,
  volume: 0.3,
  repeatSeconds: 60,
  maxRepeats: 10,
  shiftOptions: [15, 30, 45, 60],
};

/** Saved data over defaults. Unknown or mistyped keys (e.g. the old snoozeMinutes) are dropped. */
export function mergeSettings(saved: unknown): NotifySettings {
  const merged: NotifySettings = { ...DEFAULT_SETTINGS, shiftOptions: [...DEFAULT_SETTINGS.shiftOptions] };
  if (saved === null || typeof saved !== "object") return merged;
  const data = saved as Record<string, unknown>;
  const target = merged as unknown as Record<string, unknown>;
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (key === "shiftOptions") continue;
    if (typeof data[key] === typeof target[key]) target[key] = data[key];
  }
  if (Array.isArray(data.shiftOptions)) {
    const opts = parseShiftOptions(data.shiftOptions.join(","));
    if (opts.length > 0) merged.shiftOptions = opts;
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
    const save = () => this.plugin.saveSettings();
    const numberField = (min: number, apply: (n: number) => void) => (v: string) => {
      const n = Number(v);
      if (v.trim() === "" || !Number.isFinite(n) || n < min) return;
      apply(n);
      void save();
    };

    new Setting(containerEl)
      .setName("有効")
      .setDesc("Day Planner のタスク開始通知に合わせてアラートを出す。")
      .addToggle((t) => t.setValue(s.enabled).onChange(async (v) => { s.enabled = v; await save(); }));

    new Setting(containerEl)
      .setName("ウィンドウの前面化")
      .setDesc("off: 何もしない / flash: タスクバーを点滅 / front: 最小化・トレイ格納から前面に出す")
      .addDropdown((d) =>
        d
          .addOptions({ off: "off", flash: "flash", front: "front" })
          .setValue(s.frontMode)
          .onChange(async (v) => { s.frontMode = v as FrontMode; await save(); }),
      );

    new Setting(containerEl)
      .setName("音を鳴らす")
      .addToggle((t) => t.setValue(s.sound).onChange(async (v) => { s.sound = v; await save(); }));

    new Setting(containerEl)
      .setName("音量")
      .addSlider((sl) =>
        sl.setLimits(0.05, 1, 0.05).setValue(s.volume).setDynamicTooltip()
          .onChange(async (v) => { s.volume = v; await save(); }),
      );

    new Setting(containerEl)
      .setName("再通知の間隔（秒）")
      .setDesc("アラートを閉じるまで、この間隔で音とタスクバー点滅を繰り返す。0 で無効。")
      .addText((t) => t.setValue(String(s.repeatSeconds))
        .onChange(numberField(0, (n) => { s.repeatSeconds = Math.floor(n); })));

    new Setting(containerEl)
      .setName("再通知の最大回数")
      .addText((t) => t.setValue(String(s.maxRepeats))
        .onChange(numberField(0, (n) => { s.maxRepeats = Math.floor(n); })));

    new Setting(containerEl)
      .setName("ずらす時間の選択肢（分）")
      .setDesc("アラートに並べるボタン。カンマ区切りで 1〜720。押すと今日のデイリーノートのそのブロックを後ろへずらし、Day Planner が新しい時刻で再通知する。")
      .addText((t) =>
        t.setPlaceholder("15, 30, 45, 60").setValue(s.shiftOptions.join(", ")).onChange(async (v) => {
          const opts = parseShiftOptions(v);
          if (opts.length === 0) return;
          s.shiftOptions = opts;
          await save();
        }),
      );
  }
}
