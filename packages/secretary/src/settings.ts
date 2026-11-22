import { App, PluginSettingTab, Setting } from "obsidian";
import { parseSlots } from "./checks.ts";
import type Secretary from "./main";
import { PathSuggest } from "./path-suggest.ts";
import { queueDirLabel } from "./paths.ts";

export interface SecretarySettings {
  /** Empty means the default for the interface language (Strings.defaultInboxPath). */
  inboxPath: string;
  /** Empty means the default for the interface language (Strings.defaultRemindersPath). */
  remindersPath: string;
  /** Empty means defaultQueueDir(). */
  queueDir: string;
  summaryTimes: string[];
  /** Watch Tasks plugin due dates (📅) across the vault. */
  tasksEnabled: boolean;
  /** Folder in the vault to watch for due dates; empty means the whole vault. */
  tasksFolder: string;
  desktopNotify: boolean;
  /** Bring the Obsidian window to the front when a reminder is due. */
  reminderFront: boolean;
  /** Play a short sound when a reminder is due. */
  reminderSound: boolean;
}

export const DEFAULT_SETTINGS: SecretarySettings = {
  inboxPath: "",
  remindersPath: "",
  queueDir: "",
  summaryTimes: ["09:00", "16:30"],
  tasksEnabled: true,
  tasksFolder: "",
  desktopNotify: true,
  reminderFront: true,
  reminderSound: true,
};

/** Saved data over defaults. Unknown or mistyped keys are dropped. */
export function mergeSettings(saved: unknown): SecretarySettings {
  const merged: SecretarySettings = { ...DEFAULT_SETTINGS, summaryTimes: [...DEFAULT_SETTINGS.summaryTimes] };
  if (saved === null || typeof saved !== "object") return merged;
  const data = saved as Record<string, unknown>;
  const target = merged as unknown as Record<string, unknown>;
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (key === "summaryTimes") continue;
    if (typeof data[key] === typeof target[key]) target[key] = data[key];
  }
  merged.inboxPath = merged.inboxPath.trim();
  merged.remindersPath = merged.remindersPath.trim();
  merged.queueDir = merged.queueDir.trim();
  merged.tasksFolder = merged.tasksFolder.trim().replace(/^\/+|\/+$/g, "");
  if (Array.isArray(data.summaryTimes)) merged.summaryTimes = parseSlots(data.summaryTimes.join(","));
  return merged;
}

export class SecretarySettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: Secretary) {
    super(app, plugin);
  }

  hide(): void {
    void this.plugin.applyQueueDir();
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const s = this.plugin.settings;
    const strings = this.plugin.s;
    const t = strings.settings;
    const save = () => this.plugin.saveSettings();

    new Setting(containerEl)
      .setName(t.inboxPath)
      .setDesc(t.inboxPathDesc(strings.defaultInboxPath))
      .addText((c) =>
        {
          c.setPlaceholder(strings.defaultInboxPath).setValue(s.inboxPath).onChange(async (v) => {
            s.inboxPath = v.trim();
            await save();
          });
          new PathSuggest(this.app, c.inputEl, strings.defaultInboxPath);
        },
      );

    new Setting(containerEl)
      .setName(t.remindersPath)
      .setDesc(t.remindersPathDesc(strings.defaultRemindersPath))
      .addText((c) =>
        {
          c.setPlaceholder(strings.defaultRemindersPath).setValue(s.remindersPath).onChange(async (v) => {
            s.remindersPath = v.trim();
            await save();
          });
          new PathSuggest(this.app, c.inputEl, strings.defaultRemindersPath);
        },
      );

    new Setting(containerEl)
      .setName(t.queueDir)
      // Shown as %LOCALAPPDATA%, so the user's own folder name stays out of screenshots.
      .setDesc(t.queueDirDesc(queueDirLabel(process.env)))
      .addText((c) =>
        {
          c.setPlaceholder(queueDirLabel(process.env)).setValue(s.queueDir).onChange(async (v) => {
            s.queueDir = v.trim();
            await save();
          });
          // Used once the field is left (or Enter is pressed), not while the path is half typed.
          c.inputEl.addEventListener("blur", () => void this.plugin.applyQueueDir());
          c.inputEl.addEventListener("keydown", (e) => {
            if (e.key === "Enter") void this.plugin.applyQueueDir();
          });
        },
      );

    new Setting(containerEl)
      .setName(t.summaryTimes)
      .setDesc(t.summaryTimesDesc)
      .addText((c) =>
        c.setPlaceholder("09:00, 16:30").setValue(s.summaryTimes.join(", ")).onChange(async (v) => {
          s.summaryTimes = parseSlots(v);
          await save();
        }),
      );

    new Setting(containerEl)
      .setName(t.tasksEnabled)
      .setDesc(t.tasksEnabledDesc)
      .addToggle((c) => c.setValue(s.tasksEnabled).onChange(async (v) => { s.tasksEnabled = v; await save(); }));

    new Setting(containerEl)
      .setName(t.tasksFolder)
      .setDesc(t.tasksFolderDesc)
      .addText((c) =>
        {
          c.setValue(s.tasksFolder).onChange(async (v) => {
            s.tasksFolder = v.trim().replace(/^\/+|\/+$/g, "");
            await save();
          });
          new PathSuggest(this.app, c.inputEl);
        },
      );

    new Setting(containerEl)
      .setName(t.desktopNotify)
      .setDesc(t.desktopNotifyDesc)
      .addToggle((c) => c.setValue(s.desktopNotify).onChange(async (v) => { s.desktopNotify = v; await save(); }));

    new Setting(containerEl)
      .setName(t.reminderFront)
      .setDesc(t.reminderFrontDesc)
      .addToggle((c) => c.setValue(s.reminderFront).onChange(async (v) => { s.reminderFront = v; await save(); }));

    new Setting(containerEl)
      .setName(t.reminderSound)
      .setDesc(t.reminderSoundDesc)
      .addToggle((c) => c.setValue(s.reminderSound).onChange(async (v) => { s.reminderSound = v; await save(); }));
  }
}
