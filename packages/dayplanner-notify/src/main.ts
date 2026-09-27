import { getLanguage, normalizePath, Notice, Plugin, TFile } from "obsidian";
import { TaskStartModal } from "./alert-modal";
import { beep, bringToFront } from "./attention";
import { stringsFor, type Strings } from "./i18n";
import { formatTaskStartTitle, parseTaskStartTitle, type TaskStart } from "./match";
import { rescheduleBlock, restoreLine, startMinutesOf } from "./reschedule";
import { DEFAULT_SETTINGS, mergeSettings, NotifySettingTab, type NotifySettings } from "./settings";

const DAY_PLANNER_ID = "obsidian-day-planner";
const UNDO_NOTICE_MS = 8_000;
const SUPPRESS_AFTER_UNDO_MS = 15_000;

interface DailyNoteOptions {
  folder?: string;
  format?: string;
}

export default class DayPlannerNotify extends Plugin {
  settings: NotifySettings = { ...DEFAULT_SETTINGS };
  s: Strings = stringsFor("en");
  private timers = new Set<number>();
  private modals = new Set<TaskStartModal>();
  /** Task name -> time (ms) until which Day Planner's notification for it is ignored. */
  private suppressed = new Map<string, number>();

  async onload(): Promise<void> {
    this.s = stringsFor(getLanguage());
    await this.loadSettings();
    this.addSettingTab(new NotifySettingTab(this.app, this));
    this.hookNotification();

    this.addCommand({
      id: "test-now",
      name: this.s.commands.testNow,
      callback: () => this.sendTest(),
    });
    this.addCommand({
      id: "test-delayed",
      name: this.s.commands.testDelayed,
      callback: () => {
        new Notice(this.s.testScheduled);
        this.later(10_000, () => this.sendTest());
      },
    });

    this.app.workspace.onLayoutReady(() => this.checkDayPlanner());
  }

  onunload(): void {
    for (const id of this.timers) window.clearTimeout(id);
    this.timers.clear();
    for (const m of [...this.modals]) m.close();
  }

  async loadSettings(): Promise<void> {
    this.settings = mergeSettings(await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  // Day Planner decides when a task starts; we only react to the notification it creates.
  private hookNotification(): void {
    const original = window.Notification;
    const onCreated = (title: unknown, n: Notification) => this.onNotificationCreated(title, n);
    const hooked = new Proxy(original, {
      construct(target, args) {
        const n = Reflect.construct(target, args) as Notification;
        try {
          onCreated(args[0], n);
        } catch (e) {
          console.error("[dayplanner-notify] handler failed", e);
        }
        return n;
      },
    });
    window.Notification = hooked;
    this.register(() => {
      if (window.Notification === hooked) window.Notification = original;
    });
  }

  private onNotificationCreated(title: unknown, n: Notification): void {
    if (!this.settings.enabled) return;
    const start = parseTaskStartTitle(title);
    if (start === null) return;
    const until = this.suppressed.get(start.task);
    if (until !== undefined) {
      this.suppressed.delete(start.task);
      if (Date.now() < until) {
        // Day Planner re-announcing a block we just moved back; the modal is already reopened.
        n.close();
        return;
      }
    }
    n.addEventListener("click", () => bringToFront("front"));
    this.alert(start);
  }

  /** quiet: reopen the modal only, without sound, focus stealing or repeats (used after undo). */
  private alert(start: TaskStart, options: { quiet?: boolean; firedOn?: moment.Moment } = {}): void {
    const s = this.settings;
    const quiet = options.quiet === true;
    // The block lives in the note of the day it fired, even if the button is pressed after midnight.
    const firedOn = options.firedOn ?? window.moment();
    if (!quiet) {
      bringToFront(s.frontMode);
      if (s.sound) beep(s.volume);
    }

    let repeatTimer: number | null = null;
    const stopRepeat = () => {
      if (repeatTimer === null) return;
      window.clearInterval(repeatTimer);
      this.timers.delete(repeatTimer);
      repeatTimer = null;
    };

    const modal = new TaskStartModal(this.app, start, this.s, {
      postponeOptions: startMinutesOf(start.time) === null ? [] : s.postponeOptions,
      onPostpone: (minutes) => this.postponeBlock(start, firedOn, minutes),
      onOpenNote: () => this.openTodayNote(),
      onClosed: () => {
        stopRepeat();
        this.modals.delete(modal);
      },
    });
    this.modals.add(modal);
    modal.open();

    if (!quiet && s.repeatSeconds > 0 && s.maxRepeats > 0) {
      let count = 0;
      repeatTimer = window.setInterval(() => {
        count++;
        // Re-stealing focus on every repeat would be hostile while typing elsewhere; flash instead.
        if (s.frontMode !== "off") bringToFront("flash");
        if (s.sound) beep(s.volume);
        if (count >= s.maxRepeats) stopRepeat();
      }, s.repeatSeconds * 1000);
      this.timers.add(repeatTimer);
    }
  }

  private later(ms: number, fn: () => void): void {
    const id = window.setTimeout(() => {
      this.timers.delete(id);
      fn();
    }, ms);
    this.timers.add(id);
  }

  /** Moves the block later in the daily note; Day Planner then notifies again at the new time. */
  private async postponeBlock(start: TaskStart, day: moment.Moment, minutes: number): Promise<string | null> {
    const file = this.dailyNoteFile(day);
    if (file === null) return this.s.errors.noDailyNote;
    return this.postponeBlockInFile(file, start, minutes, () => this.alert(start, { quiet: true, firedOn: day }));
  }

  private async postponeBlockInFile(
    file: TFile,
    start: TaskStart,
    minutes: number,
    onUndone?: () => void,
  ): Promise<string | null> {
    const startMinutes = startMinutesOf(start.time);
    if (startMinutes === null) return this.s.errors.noStartTime;

    const result = await this.writeNote(file, (data) => rescheduleBlock(data, start.task, startMinutes, minutes));
    if (!result.ok) return this.s.errors[result.reason];

    const notice = new Notice(
      createFragment((f) => {
        f.createSpan({ text: this.s.postponed(start.task, result.from, result.to) });
        const undo = f.createEl("button", { text: this.s.undo, cls: "dayplanner-notify-undo" });
        undo.addEventListener("click", (event) => {
          event.stopPropagation();
          undo.disabled = true;
          notice.hide();
          void this.undoPostpone(file, start, result, onUndone);
        });
      }),
      UNDO_NOTICE_MS,
    );
    return null;
  }

  private async undoPostpone(
    file: TFile,
    start: TaskStart,
    moved: { before: string; after: string; from: string },
    onUndone?: () => void,
  ): Promise<void> {
    // Moving the block back makes it "just started" again, so Day Planner will announce it once more.
    this.suppressed.set(start.task, Date.now() + SUPPRESS_AFTER_UNDO_MS);
    const result = await this.writeNote(file, (data) => restoreLine(data, moved.after, moved.before));
    if (!result.ok) {
      this.suppressed.delete(start.task);
      new Notice(result.reason === "ambiguous" ? this.s.errors.ambiguous : this.s.errors.undoLineChanged, 8000);
      return;
    }
    new Notice(this.s.restored(start.task, moved.from));
    onUndone?.();
  }

  /** Runs the edit on the latest content; a failed edit never rewrites the note. */
  private async writeNote<R extends { ok: true; content: string } | { ok: false }>(
    file: TFile,
    edit: (data: string) => R,
  ): Promise<R> {
    const precheck = edit(await this.app.vault.read(file));
    if (!precheck.ok) return precheck;
    const latest = { result: precheck };
    await this.app.vault.process(file, (data) => {
      // Recompute in case the note changed between the read and the write.
      latest.result = edit(data);
      return latest.result.ok ? (latest.result as { content: string }).content : data;
    });
    return latest.result;
  }

  private dailyNoteFile(day: moment.Moment): TFile | null {
    const internal = (this.app as unknown as {
      internalPlugins?: { getPluginById(id: string): { instance?: { options?: DailyNoteOptions } } | null };
    }).internalPlugins;
    const options = internal?.getPluginById("daily-notes")?.instance?.options ?? {};
    const name = day.format(options.format || "YYYY-MM-DD");
    const path = normalizePath(options.folder ? `${options.folder}/${name}.md` : `${name}.md`);
    const file = this.app.vault.getAbstractFileByPath(path);
    return file instanceof TFile ? file : null;
  }

  private openTodayNote(): void {
    // The core "Daily notes" command resolves folder and date format itself.
    const commands = (this.app as unknown as { commands: { executeCommandById(id: string): boolean } }).commands;
    if (!commands.executeCommandById("daily-notes")) new Notice(this.s.errors.openDailyNote);
  }

  private sendTest(): void {
    const now = window.moment();
    const title = formatTaskStartTitle({
      task: this.s.testTask,
      time: `${now.format("HH:mm")} - ${now.clone().add(30, "minutes").format("HH:mm")}`,
    });
    // Goes through the same hook as Day Planner, so this exercises the real path.
    new Notification(title);
  }

  private checkDayPlanner(): void {
    const plugins = (this.app as unknown as { plugins: { plugins: Record<string, unknown> } }).plugins.plugins;
    const dp = plugins[DAY_PLANNER_ID] as { getSettings?: () => { showTaskNotification?: boolean } } | undefined;
    if (dp === undefined) {
      new Notice(this.s.dayPlannerMissing, 10_000);
      return;
    }
    if (dp.getSettings?.().showTaskNotification === false) new Notice(this.s.dayPlannerNotifyOff, 10_000);
  }
}
