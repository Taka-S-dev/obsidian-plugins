import { normalizePath, Notice, Plugin, TFile } from "obsidian";
import { TaskStartModal } from "./alert-modal";
import { beep, bringToFront } from "./attention";
import { formatTaskStartTitle, parseTaskStartTitle, type TaskStart } from "./match";
import { rescheduleBlock, restoreLine, startMinutesOf } from "./reschedule";
import { DEFAULT_SETTINGS, mergeSettings, NotifySettingTab, type NotifySettings } from "./settings";

const DAY_PLANNER_ID = "obsidian-day-planner";

const SHIFT_ERRORS = {
  "not-found": "ノートに該当するブロックが見つかりません。完了済みか、時刻や名前が変わった可能性があります。",
  ambiguous: "同じ時刻・同じ名前のブロックが複数あるため、ずらせません。ノートを開いて調整してください。",
  "past-midnight": "日付をまたぐため、ずらせません。",
} as const;

const UNDO_NOTICE_MS = 8_000;
const SUPPRESS_AFTER_UNDO_MS = 15_000;

interface DailyNoteOptions {
  folder?: string;
  format?: string;
}

export default class DayPlannerNotify extends Plugin {
  settings: NotifySettings = { ...DEFAULT_SETTINGS };
  private timers = new Set<number>();
  private modals = new Set<TaskStartModal>();
  /** Task name -> time (ms) until which Day Planner's notification for it is ignored. */
  private suppressed = new Map<string, number>();

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new NotifySettingTab(this.app, this));
    this.hookNotification();

    this.addCommand({
      id: "test-now",
      name: "テスト通知を送る",
      callback: () => this.sendTest(),
    });
    this.addCommand({
      id: "test-delayed",
      name: "10秒後にテスト通知を送る（最小化して前面化を確認）",
      callback: () => {
        new Notice("10秒後にテスト通知を送ります");
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

    const modal = new TaskStartModal(this.app, start, {
      shiftOptions: startMinutesOf(start.time) === null ? [] : s.shiftOptions,
      onShift: (minutes) => this.shiftBlock(start, firedOn, minutes),
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
  private async shiftBlock(start: TaskStart, day: moment.Moment, minutes: number): Promise<string | null> {
    const file = this.dailyNoteFile(day);
    if (file === null) return "デイリーノートが見つかりません。";
    return this.shiftBlockInFile(file, start, minutes, () => this.alert(start, { quiet: true, firedOn: day }));
  }

  private async shiftBlockInFile(
    file: TFile,
    start: TaskStart,
    minutes: number,
    onUndone?: () => void,
  ): Promise<string | null> {
    const startMinutes = startMinutesOf(start.time);
    if (startMinutes === null) return "開始時刻が分からないため、ずらせません。";

    const result = await this.writeNote(file, (data) => rescheduleBlock(data, start.task, startMinutes, minutes));
    if (!result.ok) return SHIFT_ERRORS[result.reason];

    const notice = new Notice(
      createFragment((f) => {
        f.createSpan({ text: `「${start.task}」を ${result.from} → ${result.to} にずらしました` });
        const undo = f.createEl("button", { text: "Undo", cls: "dayplanner-notify-undo" });
        undo.addEventListener("click", (event) => {
          event.stopPropagation();
          undo.disabled = true;
          notice.hide();
          void this.undoShift(file, start, result, onUndone);
        });
      }),
      UNDO_NOTICE_MS,
    );
    return null;
  }

  private async undoShift(
    file: TFile,
    start: TaskStart,
    shift: { before: string; after: string; from: string },
    onUndone?: () => void,
  ): Promise<void> {
    // Moving the block back makes it "just started" again, so Day Planner will announce it once more.
    this.suppressed.set(start.task, Date.now() + SUPPRESS_AFTER_UNDO_MS);
    const result = await this.writeNote(file, (data) => restoreLine(data, shift.after, shift.before));
    if (!result.ok) {
      this.suppressed.delete(start.task);
      const reason = result.reason === "ambiguous" ? SHIFT_ERRORS.ambiguous : "ずらした行が変更されたため、戻せませんでした。";
      new Notice(reason, 8000);
      return;
    }
    new Notice(`「${start.task}」を ${shift.from} に戻しました`);
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
    if (!commands.executeCommandById("daily-notes")) {
      new Notice("デイリーノートを開けませんでした（コアプラグイン「デイリーノート」を確認してください）");
    }
  }

  private sendTest(): void {
    const now = window.moment();
    const title = formatTaskStartTitle({
      task: "テストタスク",
      time: `${now.format("HH:mm")} - ${now.clone().add(30, "minutes").format("HH:mm")}`,
    });
    // Goes through the same hook as Day Planner, so this exercises the real path.
    new Notification(title);
  }

  private checkDayPlanner(): void {
    const plugins = (this.app as unknown as { plugins: { plugins: Record<string, unknown> } }).plugins.plugins;
    const dp = plugins[DAY_PLANNER_ID] as { getSettings?: () => { showTaskNotification?: boolean } } | undefined;
    if (dp === undefined) {
      new Notice("Day Planner Notify: Day Planner が有効になっていません", 10_000);
      return;
    }
    if (dp.getSettings?.().showTaskNotification === false) {
      new Notice("Day Planner Notify: Day Planner の設定で Task Notification をオンにしてください", 10_000);
    }
  }
}
