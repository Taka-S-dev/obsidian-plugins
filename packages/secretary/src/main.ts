import { watch, type FSWatcher } from "node:fs";
import { getLanguage, normalizePath, Notice, Plugin, TAbstractFile, TFile } from "obsidian";
import {
  addBulletin,
  dismiss,
  loadBulletins,
  loadRejected,
  loadStrings,
  markRead,
  PROCESSED_LIMIT,
  REJECTED_LIMIT,
  remember,
  type Bulletin,
  type Rejected,
} from "./bulletins.ts";
import { currentSlot, evaluate, loadAnnounced, pickNew, type Announced, type Report, type Snapshot } from "./checks.ts";
import { checkedLine, DONE_LIMIT, insertLine, lineLabel, loadDone, stillChecked, uncheck, type DoneEntry, type DoneKind } from "./done-today.ts";
import { stringsFor, type Strings } from "./i18n.ts";
import { appendEntry, checkItem, editItem, folderOf, formatEntry, inboxItems, openItems, removeItem, withoutStamp, type InboxItem } from "./inbox.ts";
import { LineModal } from "./line-modal.ts";
import { ReminderModal } from "./reminder-modal.ts";
import { ReminderAlert } from "./reminder-alert.ts";
import { beep, bringToFront } from "./attention.ts";
import { PANEL_VIEW, SecretaryPanel } from "./panel.ts";
import type { QueueMessage } from "./queue.ts";
import { dueReminders, formatReminder, later, markDone, parseReminders, removeReminder, reschedule, tomorrowAt, type Reminder } from "./reminders.ts";
import { DEFAULT_SETTINGS, mergeSettings, SecretarySettingTab, type SecretarySettings } from "./settings.ts";
import { defaultQueueDir, ensureQueueDir, listMessages, messageKey, readMessage, rejectMessage, removeMessage } from "./spool.ts";
import { parseDueTasks, type DueTask } from "./tasks.ts";
import { asNotePath } from "./paths.ts";
import { hm, ymd } from "./time.ts";

const TICK_MS = 60_000;
const NOTICE_MS = 15_000;
const SUMMARY_MS = 10_000;
/** Queue files handled per pass; the rest wait for the next one. */
const QUEUE_BATCH = 50;
/** fs.watch fires several times per file; wait this long after the last event. */
const WATCH_DEBOUNCE_MS = 300;
/**
 * Obsidian saves a note every couple of seconds while it is typed in. A reminder line being typed
 * with a time already past would go off half-written, so none goes off until the reminders note
 * has been left alone this long.
 */
const EDIT_QUIET_MS = 8_000;
/** How long the notice with Undo stays after something is checked off. */
const UNDO_MS = 10_000;

export default class Secretary extends Plugin {
  settings: SecretarySettings = { ...DEFAULT_SETTINGS };
  s: Strings = stringsFor("en");
  /** What the last check read. The panel draws from it. */
  snapshot: Snapshot | null = null;
  private announced: Announced = { date: "", keys: [] };
  /** Reminders and inbox items checked off today from the panel or the alert, for Undo. */
  doneToday: DoneEntry[] = [];
  private bulletins: Bulletin[] = [];
  /**
   * Queue files already handled (name, size and time), so a file that could not be deleted is not
   * handled twice.
   */
  private processed: string[] = [];
  private rejected: Rejected[] = [];
  private report: Report | null = null;
  /** Due tasks per note, kept until the note's modification time changes. */
  private dueCache = new Map<string, { mtime: number; tasks: DueTask[] }>();
  private statusEl: HTMLElement | null = null;
  private watcher: FSWatcher | null = null;
  private watchTimer: number | null = null;
  /** When the reminders note last changed, and the check waiting for it to settle. */
  private remindersEditedAt = 0;
  private settleTimer: number | null = null;
  /** The queue folder being watched and drained; the setting takes effect once it is applied. */
  private queueInUse: string | null = null;
  /** Notes a queued message could not be written to, so the failure is announced once, not every minute. */
  private failedWrites = new Set<string>();
  /** The reminder alert while it is open; reminders that come due meanwhile join it. */
  private alert: ReminderAlert | null = null;
  private running = false;
  private rerun = false;
  private active = true;

  async onload(): Promise<void> {
    this.s = stringsFor(getLanguage());
    const saved = (await this.loadData()) as Record<string, unknown> | null;
    this.settings = mergeSettings(saved);
    this.announced = loadAnnounced(saved?.announced, ymd(new Date()));
    this.doneToday = loadDone(saved?.doneToday, ymd(new Date()));
    this.bulletins = loadBulletins(saved?.bulletins);
    this.processed = loadStrings(saved?.processed, PROCESSED_LIMIT);
    this.rejected = loadRejected(saved?.rejected);
    this.addSettingTab(new SecretarySettingTab(this.app, this));
    this.registerView(PANEL_VIEW, (leaf) => new SecretaryPanel(leaf, this));

    this.statusEl = this.addStatusBarItem();
    this.statusEl.addClass("mod-clickable");
    this.statusEl.setAttr("aria-label", this.s.status.tooltip);
    this.registerDomEvent(this.statusEl, "click", () => void this.openPanel());
    this.addRibbonIcon("bell", this.s.commands.openPanel, () => void this.openPanel());

    const c = this.s.commands;
    this.addCommand({ id: "capture", name: c.capture, callback: () => this.openCaptureModal() });
    this.addCommand({ id: "add-reminder", name: c.addReminder, callback: () => this.openReminderModal() });
    this.addCommand({ id: "open-panel", name: c.openPanel, callback: () => void this.openPanel() });
    this.addCommand({ id: "open-inbox", name: c.openInbox, callback: () => this.openInbox() });
    this.addCommand({ id: "open-reminders", name: c.openReminders, callback: () => this.openReminders() });
    this.addCommand({ id: "mark-all-read", name: c.markAllRead, callback: () => void this.markRead() });
    this.addCommand({
      id: "check-now",
      name: c.checkNow,
      callback: async () => {
        await this.tick();
        this.showSummary();
      },
    });

    // Both notes are cheap to read, so edits (by hand or by an assistant) show up right away.
    const watched = (path: string) => path === this.inboxPath() || path === this.remindersPath();
    // A due date added or changed in any other watched note shows up a moment after it is saved;
    // only that note is read again (see collectDueTasks), and the wait gathers a burst of saves.
    const holdsDueDates = (path: string) =>
      this.settings.tasksEnabled && path.endsWith(".md") && (!this.settings.tasksFolder || path.startsWith(`${this.settings.tasksFolder}/`));
    const onChange = (file: TAbstractFile) => {
      if (file.path === this.remindersPath()) this.remindersEditedAt = Date.now();
      if (watched(file.path)) void this.tick();
      else if (holdsDueDates(file.path)) this.queueSoon();
    };
    this.registerEvent(this.app.vault.on("modify", onChange));
    this.registerEvent(this.app.vault.on("create", onChange));
    this.registerEvent(this.app.vault.on("delete", onChange));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      if (watched(file.path) || watched(oldPath)) void this.tick();
      else if (holdsDueDates(file.path) || holdsDueDates(oldPath)) this.queueSoon();
    }));

    this.app.workspace.onLayoutReady(() => {
      void this.startWatcher().then(() => this.tick());
    });
    // Also the fallback for the queue folder: fs.watch can miss events on Windows.
    this.registerInterval(window.setInterval(() => void this.tick(), TICK_MS));
  }

  onunload(): void {
    this.active = false;
    this.stopWatcher();
    this.alert?.close();
    this.alert = null;
  }

  /** Saves the settings. Called on every key in a text field, so the check that follows waits a moment. */
  async saveSettings(): Promise<void> {
    await this.persist();
    this.queueSoon();
  }

  /**
   * Starts using the queue folder in the settings. Called when its field is left: on every key it
   * would create a folder for each partial path typed.
   */
  async applyQueueDir(): Promise<void> {
    if (this.queueDir() === this.queueInUse) return;
    await this.startWatcher();
    await this.tick();
  }

  private async persist(): Promise<void> {
    await this.saveData({
      ...this.settings,
      announced: this.announced,
      doneToday: this.doneToday,
      bulletins: this.bulletins,
      processed: this.processed,
      rejected: this.rejected,
    });
  }

  // ---- places ----

  private inboxPath(): string {
    return normalizePath(asNotePath(this.settings.inboxPath) || this.s.defaultInboxPath);
  }

  private remindersPath(): string {
    return normalizePath(asNotePath(this.settings.remindersPath) || this.s.defaultRemindersPath);
  }

  queueDir(): string {
    return this.settings.queueDir || defaultQueueDir();
  }

  private async readNote(path: string): Promise<string | null> {
    const file = this.app.vault.getAbstractFileByPath(path);
    return file instanceof TFile ? this.app.vault.cachedRead(file) : null;
  }

  /**
   * Appends one line, creating the note (and its folder) with a header first if needed. A queued
   * message is tried again every minute, so `everyFailure` false announces a failure only once.
   */
  private async appendLine(path: string, header: string, line: string, everyFailure = true): Promise<boolean> {
    try {
      let file = this.app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) {
        const folder = folderOf(path);
        if (folder && !this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder);
        file = await this.app.vault.create(path, "");
      }
      await this.app.vault.process(file as TFile, (content) => appendEntry(content, line, header));
      this.failedWrites.delete(path);
      return true;
    } catch (e) {
      console.error("[secretary] could not write", path, e);
      if (everyFailure || !this.failedWrites.has(path)) new Notice(this.s.capture.failed);
      this.failedWrites.add(path);
      return false;
    }
  }

  // ---- the queue folder ----

  private async startWatcher(): Promise<void> {
    this.stopWatcher();
    const dir = this.queueDir();
    // Taken even if the folder cannot be made now: each pass of the queue tries again.
    this.queueInUse = dir;
    try {
      await ensureQueueDir(dir);
      if (!this.active) return;
      this.watcher = watch(dir, () => this.queueSoon());
      this.watcher.on("error", (e) => console.error("[secretary] queue watcher", e));
    } catch (e) {
      console.error("[secretary] could not watch the queue folder", dir, e);
    }
  }

  private stopWatcher(): void {
    this.watcher?.close();
    this.watcher = null;
    if (this.watchTimer !== null) window.clearTimeout(this.watchTimer);
    this.watchTimer = null;
    if (this.settleTimer !== null) window.clearTimeout(this.settleTimer);
    this.settleTimer = null;
  }

  private queueSoon(): void {
    if (this.watchTimer !== null) window.clearTimeout(this.watchTimer);
    this.watchTimer = window.setTimeout(() => {
      this.watchTimer = null;
      void this.tick();
    }, WATCH_DEBOUNCE_MS);
  }

  /**
   * Handles queued messages oldest first. A message is delivered, recorded as processed and saved
   * before its file is deleted, so a crash in between delivers it at most once more, and the record
   * stops even that. A file that cannot be read now (still being written, locked) waits for the next pass.
   */
  private async drainQueue(): Promise<void> {
    const dir = this.queueInUse;
    if (!dir) return;
    let names: string[];
    try {
      await ensureQueueDir(dir);
      names = await listMessages(dir, QUEUE_BATCH);
    } catch (e) {
      console.error("[secretary] could not read the queue folder", dir, e);
      return;
    }
    for (const name of names) {
      if (!this.active) return;
      let key: string;
      try {
        key = await messageKey(dir, name);
      } catch (e) {
        console.error("[secretary] could not read", name, e);
        continue;
      }
      if (this.processed.includes(key)) {
        await removeMessage(dir, name).catch((e) => console.error("[secretary] could not delete", name, e));
        continue;
      }
      let parsed;
      try {
        parsed = await readMessage(dir, name);
      } catch (e) {
        console.error("[secretary] could not read", name, e);
        continue;
      }
      if (!parsed.ok) {
        try {
          const moved = await rejectMessage(dir, name);
          this.rejected = remember(this.rejected, { name: moved, reason: parsed.reason, at: this.stamp() }, REJECTED_LIMIT);
          await this.persist();
          new Notice(this.s.queue.rejectedNotice(name, this.s.queue.reasons[parsed.reason]), NOTICE_MS);
        } catch (e) {
          console.error("[secretary] could not move a rejected file", name, e);
        }
        continue;
      }
      if (!(await this.deliver(parsed.message, key))) continue;
      this.processed = remember(this.processed, key, PROCESSED_LIMIT);
      await this.persist();
      await removeMessage(dir, name).catch((e) => console.error("[secretary] could not delete", name, e));
    }
  }

  /** `key` tells messages apart when a sender reuses a file name, so each notice stays its own. */
  private async deliver(m: QueueMessage, key: string): Promise<boolean> {
    switch (m.type) {
      case "notify":
        this.bulletins = addBulletin(this.bulletins, { id: key, at: this.stamp(), text: m.text, read: false, ...(m.source ? { source: m.source } : {}) });
        if (!m.quiet) this.announce(this.s.bulletin.title(m.source), m.text);
        return true;
      case "remind":
        return m.at ? this.appendLine(this.remindersPath(), this.s.remindersHeader, formatReminder(m.at.date, m.at.time, m.text), false) : false;
      case "inbox":
        return this.appendLine(this.inboxPath(), this.s.inboxHeader, formatEntry(new Date(), m.text), false);
    }
  }

  private stamp(): string {
    const now = new Date();
    return `${ymd(now)} ${hm(now)}`;
  }

  // ---- the check that runs every minute ----

  private async tick(): Promise<void> {
    if (this.running) {
      this.rerun = true;
      return;
    }
    this.running = true;
    try {
      do {
        this.rerun = false;
        await this.drainQueue();
        await this.check();
      } while (this.rerun && this.active);
    } finally {
      this.running = false;
    }
  }

  private async check(): Promise<void> {
    const now = new Date();
    const today = ymd(now);
    const inboxText = await this.readNote(this.inboxPath());
    const remindersText = await this.readNote(this.remindersPath());
    const dueTasks = await this.collectDueTasks();
    if (!this.active) return;

    const snap: Snapshot = {
      now,
      inbox: inboxText === null ? null : openItems(inboxText),
      reminders: remindersText === null ? null : parseReminders(remindersText),
      bulletins: this.bulletins,
      rejected: this.rejected,
      dueTasks,
    };
    this.snapshot = snap;
    // Yesterday's entries go at midnight, and ones unchecked or deleted in the note by hand at once.
    const done = stillChecked(stillChecked(loadDone(this.doneToday, today), "inbox", inboxText), "reminder", remindersText);
    const doneChanged = done.length !== this.doneToday.length;
    this.doneToday = done;
    this.report = evaluate(snap, currentSlot(this.settings.summaryTimes, now), this.s);
    this.statusEl?.setText(this.report.status);
    this.renderPanels();

    if (this.announced.date !== today) this.announced = { date: today, keys: [] };
    // The panel shows an edit at once; the alert waits until the reminders note has settled.
    const editedAgo = Date.now() - this.remindersEditedAt;
    let fired = false;
    if (editedAgo >= EDIT_QUIET_MS) {
      fired = await this.fireReminders(dueReminders(snap.reminders ?? [], now), today);
    } else {
      if (this.settleTimer !== null) window.clearTimeout(this.settleTimer);
      this.settleTimer = window.setTimeout(() => {
        this.settleTimer = null;
        void this.tick();
      }, EDIT_QUIET_MS - editedAgo + 100);
    }
    const { next, fresh } = pickNew(this.announced, today, this.report.alerts);
    this.announced = next;
    for (const a of fresh) this.announce(a.title, a.body);
    if (fired || fresh.length > 0 || doneChanged) await this.persist();
  }

  /**
   * Open tasks with a due date in the watched folder. Only notes whose modification time changed since
   * the last check are read again, so a large vault costs one full read at start-up and little after.
   * A note that cannot be read keeps no entry and is tried again next time.
   */
  private async collectDueTasks(): Promise<DueTask[] | null> {
    if (!this.settings.tasksEnabled) {
      this.dueCache.clear();
      return null;
    }
    const folder = this.settings.tasksFolder;
    const seen = new Set<string>();
    const out: DueTask[] = [];
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (folder && !file.path.startsWith(`${folder}/`)) continue;
      seen.add(file.path);
      let entry = this.dueCache.get(file.path);
      if (!entry || entry.mtime !== file.stat.mtime) {
        try {
          entry = { mtime: file.stat.mtime, tasks: parseDueTasks(await this.app.vault.cachedRead(file), file.path) };
          this.dueCache.set(file.path, entry);
        } catch (e) {
          console.error("[secretary] could not read for due dates", file.path, e);
          this.dueCache.delete(file.path);
          continue;
        }
      }
      out.push(...entry.tasks);
    }
    for (const path of [...this.dueCache.keys()]) if (!seen.has(path)) this.dueCache.delete(path);
    return out;
  }

  /** Opens the reminders note at the reminder's line. */
  async openReminder(r: Reminder): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(this.remindersPath());
    if (!(file instanceof TFile)) return;
    await this.app.workspace.getLeaf(false).openFile(file, { eState: { line: r.line } });
  }

  /** Opens the inbox note at the first unchecked line with this text (or at the top if it moved). */
  async openInboxItem(text: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(this.inboxPath());
    if (!(file instanceof TFile)) return;
    const item = inboxItems(await this.app.vault.cachedRead(file)).find((i) => i.text === text);
    await this.app.workspace.getLeaf(false).openFile(file, item ? { eState: { line: item.line } } : undefined);
  }

  /** Changes a reminder's date, time or text from the panel, in the reminder modal. */
  editReminder(r: Reminder): void {
    const c = this.s.capture;
    const start = { title: c.editTitle, submit: c.save, text: r.text, date: r.date, time: r.time };
    new ReminderModal(
      this.app,
      c,
      async (date, time, text) => {
        let ok = false;
        try {
          ok = await this.updateReminder(r, (content) => reschedule(content, r, date, time, text));
        } catch (e) {
          console.error("[secretary] could not change a reminder", e);
        }
        if (!ok) {
          new Notice(this.s.alert.failed, NOTICE_MS);
          return false;
        }
        await this.tick();
        return true;
      },
      start,
    ).open();
  }

  /** Checks a reminder off before its time, from the panel. */
  async completeReminder(r: Reminder): Promise<void> {
    let ok = false;
    try {
      ok = await this.markReminderDone(r);
    } catch (e) {
      console.error("[secretary] could not check off a reminder", e);
    }
    if (!ok) new Notice(this.s.alert.failed, NOTICE_MS);
    await this.tick();
  }

  /** Checks a reminder off and keeps it for Undo. */
  private async markReminderDone(r: Reminder): Promise<boolean> {
    const ok = await this.updateReminder(r, (content) => markDone(content, r));
    if (ok) await this.recordDone("reminder", r.raw);
    return ok;
  }

  /** Keeps what was just checked off for today, and offers to undo it at once. */
  private async recordDone(kind: DoneKind, raw: string): Promise<void> {
    const entry: DoneEntry = { kind, line: checkedLine(raw), date: ymd(new Date()) };
    this.doneToday = [...this.doneToday, entry].slice(-DONE_LIMIT);
    await this.persist();
    this.offerUndo(this.s.panel.doneNotice(lineLabel(entry.line, entry.date)), () => this.undoDone(entry));
  }

  /** A notice saying what was just done, with Undo, for a few seconds. */
  private offerUndo(text: string, undo: () => Promise<void>): void {
    const body = createFragment((f) => {
      f.createDiv({ text });
      f.createEl("button", { text: this.s.panel.undo, cls: "secretary-undo" }).addEventListener("click", () => void undo());
    });
    new Notice(body, UNDO_MS);
  }

  /** Deletes a reminder's line from the note, from the panel's menu; Undo in the notice puts it back. */
  async deleteReminder(r: Reminder): Promise<void> {
    let ok = false;
    try {
      ok = await this.updateReminder(r, (content) => removeReminder(content, r));
    } catch (e) {
      console.error("[secretary] could not delete a reminder", e);
    }
    if (ok) this.offerRestore(this.remindersPath(), r.line, r.raw);
    else new Notice(this.s.alert.failed, NOTICE_MS);
    await this.tick();
  }

  /** Deletes an inbox item's line from the note, from the panel's menu; Undo in the notice puts it back. */
  async deleteInboxItem(text: string): Promise<void> {
    let removed: InboxItem | null = null;
    const ok = await this.editInboxLine(text, (content, item) => {
      removed = item;
      return removeItem(content, item);
    });
    const item = removed as InboxItem | null;
    if (ok && item) this.offerRestore(this.inboxPath(), item.line, item.raw);
    else new Notice(this.s.capture.inboxChanged, NOTICE_MS);
    await this.tick();
  }

  private offerRestore(path: string, line: number, raw: string): void {
    this.offerUndo(this.s.panel.deletedNotice(lineLabel(raw, ymd(new Date()))), async () => {
      const file = this.app.vault.getAbstractFileByPath(path);
      let ok = false;
      if (file instanceof TFile) {
        try {
          await this.app.vault.process(file, (content) => insertLine(content, line, raw));
          ok = true;
        } catch (e) {
          console.error("[secretary] could not put a deleted line back", e);
        }
      }
      if (!ok) new Notice(this.s.panel.restoreFailed, NOTICE_MS);
      await this.tick();
    });
  }

  /** Unchecks a reminder or inbox item checked off today, from the notice or the panel. */
  async undoDone(entry: DoneEntry): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(entry.kind === "reminder" ? this.remindersPath() : this.inboxPath());
    let ok = false;
    if (file instanceof TFile) {
      try {
        await this.app.vault.process(file, (content) => {
          const next = uncheck(content, entry.line);
          if (next === null) return content;
          ok = true;
          return next;
        });
      } catch (e) {
        console.error("[secretary] could not undo a check", e);
      }
    }
    if (!ok) new Notice(this.s.panel.undoFailed, NOTICE_MS);
    // Undone, or its line is gone: either way there is nothing left to undo.
    this.doneToday = this.doneToday.filter((e) => e !== entry);
    await this.persist();
    await this.tick();
  }

  /**
   * Turns an inbox item into a reminder: the reminder modal opens with its text, and once the
   * reminder is added, the item leaves the inbox.
   */
  remindFromInbox(text: string): void {
    const c = this.s.capture;
    const start = { title: c.fromInboxTitle, text: withoutStamp(text), date: ymd(new Date()), time: "" };
    new ReminderModal(
      this.app,
      c,
      async (date, time, body) => {
        const ok = await this.appendLine(this.remindersPath(), this.s.remindersHeader, formatReminder(date, time, body));
        if (!ok) return false;
        const removed = await this.removeInboxItem(text);
        new Notice(removed ? c.movedToReminder(date, time, body) : c.inboxKept);
        await this.tick();
        return true;
      },
      start,
    ).open();
  }

  /** Changes an inbox item's text from the panel; the date and time it was added stay. */
  editInboxItem(text: string): void {
    const c = this.s.capture;
    const options = { title: c.editInboxTitle, placeholder: c.placeholder, submit: c.save, value: withoutStamp(text) };
    new LineModal(this.app, options, async (next) => {
      if (!(await this.editInboxLine(text, (content, item) => editItem(content, item, next)))) {
        new Notice(c.inboxChanged, NOTICE_MS);
        return false;
      }
      await this.tick();
      return true;
    }).open();
  }

  /** Checks an inbox item off from the panel, once it has been dealt with. */
  async completeInboxItem(text: string): Promise<void> {
    let raw = "";
    const ok = await this.editInboxLine(text, (content, item) => {
      raw = item.raw;
      return checkItem(content, item);
    });
    if (ok) await this.recordDone("inbox", raw);
    else new Notice(this.s.capture.inboxChanged, NOTICE_MS);
    await this.tick();
  }

  /** Removes the first unchecked inbox line with this text; false if it is no longer there as read. */
  private removeInboxItem(text: string): Promise<boolean> {
    return this.editInboxLine(text, removeItem);
  }

  private async editInboxLine(text: string, edit: (content: string, item: InboxItem) => string | null): Promise<boolean> {
    const file = this.app.vault.getAbstractFileByPath(this.inboxPath());
    if (!(file instanceof TFile)) return false;
    let removed = false;
    try {
      await this.app.vault.process(file, (content) => {
        const item = inboxItems(content).find((i) => i.text === text);
        const next = item ? edit(content, item) : null;
        if (next === null) return content;
        removed = true;
        return next;
      });
    } catch (e) {
      console.error("[secretary] could not update an inbox line", e);
    }
    return removed;
  }

  /** Opens the note of a due task at its line. */
  async openTask(task: DueTask): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(task.path);
    if (!(file instanceof TFile)) return;
    await this.app.workspace.getLeaf(false).openFile(file, { eState: { line: task.line } });
  }

  /**
   * Shows each due reminder in the alert, in the middle of the screen, until it is marked done or
   * snoozed; it stays unchecked in the note until then. Each is remembered for today, so it is not
   * shown again every minute.
   */
  private async fireReminders(due: Reminder[], today: string): Promise<boolean> {
    const keys = new Set(this.announced.keys);
    const pending = due.filter((r) => !keys.has(`reminder:${r.date} ${r.time} ${r.text}`));
    if (pending.length === 0) return false;
    for (const r of pending) {
      this.announced.keys.push(`reminder:${r.date} ${r.time} ${r.text}`);
      // The Windows notification still helps when Obsidian could not be brought forward.
      this.notifyWindows(r.date === today ? this.s.reminder.title(r.time) : this.s.reminder.late(r.date, r.time), r.text);
    }
    if (this.settings.reminderFront) bringToFront();
    if (this.settings.reminderSound) beep();
    if (this.alert) {
      this.alert.add(pending);
    } else {
      this.alert = new ReminderAlert(this.app, this.s, today, pending, {
        done: (r) => this.markReminderDone(r),
        snooze: (r, minutes) => {
          const at = later(new Date(), minutes);
          return this.updateReminder(r, (content) => reschedule(content, r, at.date, at.time));
        },
        tomorrow: (r) => {
          const at = tomorrowAt(new Date(), r.time);
          return this.updateReminder(r, (content) => reschedule(content, r, at.date, at.time));
        },
        // The reminder modal opens over the alert, filled with the reminder and an hour from now.
        pick: (r) =>
          new Promise<boolean | null>((resolve) => {
            const start = { title: this.s.alert.pickTitle, submit: this.s.capture.save, text: r.text, ...later(new Date(), 60) };
            new ReminderModal(
              this.app,
              this.s.capture,
              async (date, time, text) => {
                const ok = await this.updateReminder(r, (content) => reschedule(content, r, date, time, text));
                resolve(ok);
                return true;
              },
              start,
              () => resolve(null),
            ).open();
          }),
        // Closing the alert leaves what is left unchecked: it stays in the panel, marked overdue,
        // to be checked off there once it is done.
        closed: () => {
          this.alert = null;
        },
      });
      this.alert.open();
    }
    return true;
  }

  /** Rewrites a reminder's line in the note. False when the line changed since it was read. */
  private async updateReminder(r: Reminder, edit: (content: string) => string | null): Promise<boolean> {
    const file = this.app.vault.getAbstractFileByPath(this.remindersPath());
    if (!(file instanceof TFile)) return false;
    let changed = false;
    await this.app.vault.process(file, (content) => {
      const next = edit(content);
      if (next === null) return content;
      changed = true;
      return next;
    });
    return changed;
  }

  // ---- showing things ----

  private announce(title: string, body: string): void {
    new Notice(body ? `${title}\n${body}` : title, NOTICE_MS);
    this.notifyWindows(title, body);
  }

  private notifyWindows(title: string, body: string): void {
    if (!this.settings.desktopNotify || typeof Notification === "undefined") return;
    try {
      new Notification(title, { body });
    } catch (e) {
      console.error("[secretary] Windows notification failed", e);
    }
  }

  private showSummary(): void {
    const lines = this.report?.details ?? [this.s.summary.nothing];
    new Notice(lines.join("\n"), SUMMARY_MS);
  }

  private renderPanels(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(PANEL_VIEW)) {
      if (leaf.view instanceof SecretaryPanel) leaf.view.render();
    }
  }

  /** Marks one notice as read, or all of them when id is omitted. */
  async markRead(id?: string): Promise<void> {
    this.bulletins = markRead(this.bulletins, id);
    await this.persist();
    await this.tick();
  }

  /** Takes a notice off the panel once it has been dealt with, or every read one when id is omitted. */
  async dismiss(id?: string): Promise<void> {
    this.bulletins = dismiss(this.bulletins, id);
    await this.persist();
    await this.tick();
  }

  /** Forgets the rejected files shown in the panel. The files stay in the rejected folder. */
  async clearRejected(): Promise<void> {
    this.rejected = [];
    await this.persist();
    await this.tick();
  }

  async openPanel(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(PANEL_VIEW)[0];
    const leaf = existing ?? this.app.workspace.getRightLeaf(false);
    if (!leaf) return;
    if (!existing) await leaf.setViewState({ type: PANEL_VIEW, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }

  openInbox(): void {
    void this.app.workspace.openLinkText(this.inboxPath(), "", false);
  }

  openReminders(): void {
    void this.app.workspace.openLinkText(this.remindersPath(), "", false);
  }

  openCaptureModal(): void {
    const c = this.s.capture;
    new LineModal(this.app, { title: c.title, hint: c.hint, placeholder: c.placeholder, submit: c.submit }, async (text) => {
      const ok = await this.appendLine(this.inboxPath(), this.s.inboxHeader, formatEntry(new Date(), text));
      if (ok) new Notice(c.added(text));
      return ok;
    }).open();
  }

  openReminderModal(): void {
    const c = this.s.capture;
    new ReminderModal(this.app, c, async (date, time, text) => {
      const ok = await this.appendLine(this.remindersPath(), this.s.remindersHeader, formatReminder(date, time, text));
      if (ok) new Notice(c.reminderAdded(date, time, text));
      return ok;
    }).open();
  }
}
