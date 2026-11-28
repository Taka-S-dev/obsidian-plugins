import { App, ButtonComponent, Modal } from "obsidian";
import type { Strings } from "./i18n.ts";
import type { Reminder } from "./reminders.ts";

export const SNOOZE_MINUTES = [10, 60] as const;

/**
 * The alert comes up over whatever was being clicked or typed. Its buttons wait this long after a
 * reminder appears, so a click or key meant for something else does not mark it done.
 */
export const ARM_MS = 1_000;

export interface ReminderAlertActions {
  /** Writes a reminder's text with its links. */
  renderText(el: HTMLElement, text: string): void;
  /** Checks the reminder off. Resolves to false when its line could not be updated. */
  done(r: Reminder): Promise<boolean>;
  /** Moves the reminder later by that many minutes. Resolves to false when its line could not be updated. */
  snooze(r: Reminder, minutes: number): Promise<boolean>;
  /** Moves the reminder to the same time tomorrow. */
  tomorrow(r: Reminder): Promise<boolean>;
  /** Asks for a date and time (and the text) in the reminder modal; null when that is cancelled. */
  pick(r: Reminder): Promise<boolean | null>;
  /** The alert closed, possibly with reminders still in it; they stay unchecked. */
  closed(): void;
}

/**
 * The reminders that are due, in the middle of the screen until each is dealt with: done, or
 * snoozed. Reminders that come due while it is open join it. Closing it (Close, Esc, ×) leaves the
 * ones left unchecked; the panel lists them as overdue until they are checked off there.
 */
export class ReminderAlert extends Modal {
  private readonly left = new Map<Reminder, HTMLElement>();
  /** Each row's time, relabelled when the day changes while the alert is open. */
  private readonly times = new Map<Reminder, HTMLElement>();
  private listEl!: HTMLElement;
  /** Reminders handed in before the alert was drawn. */
  private pending: Reminder[];

  constructor(
    app: App,
    private s: Strings,
    private today: string,
    first: Reminder[],
    private actions: ReminderAlertActions,
  ) {
    super(app);
    this.pending = first;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("secretary-alert");
    this.titleEl.setText(this.s.alert.title);
    this.keepOpenOnOutsideClick();
    this.listEl = contentEl.createDiv();
    for (const r of this.pending) this.addRow(r);
    this.pending = [];
    const footer = contentEl.createDiv({ cls: "modal-button-container" });
    new ButtonComponent(footer).setButtonText(this.s.alert.ok).setCta().onClick(() => this.close());
    // Keys being typed when the alert comes up go to the alert itself, not to a button: Enter or
    // Space would otherwise press it. Esc still closes the alert.
    this.modalEl.tabIndex = -1;
    window.setTimeout(() => this.modalEl.focus(), 0);
  }

  /**
   * Adds reminders that came due while the alert is open. One already in it is left as it is: past
   * midnight the reminders still unchecked come due again, and the alert may have been open since.
   */
  add(reminders: Reminder[], today: string): void {
    const shown = [...this.pending, ...this.left.keys()];
    const fresh = reminders.filter((r) => !shown.some((s) => s.date === r.date && s.time === r.time && s.text === r.text));
    if (today !== this.today) {
      this.today = today;
      for (const [r, el] of this.times) el.setText(this.timeLabel(r));
    }
    if (!this.listEl) {
      this.pending.push(...fresh);
      return;
    }
    for (const r of fresh) this.addRow(r);
  }

  onClose(): void {
    this.contentEl.empty();
    this.actions.closed();
  }

  private addRow(r: Reminder): void {
    const a = this.s.alert;
    const row = this.listEl.createDiv({ cls: "secretary-alert-item" });
    this.times.set(r, row.createDiv({ cls: "secretary-alert-time", text: this.timeLabel(r) }));
    this.actions.renderText(row.createDiv({ cls: "secretary-alert-text" }), r.text);
    const buttons = row.createDiv({ cls: "secretary-alert-buttons" });
    const error = row.createDiv({ cls: "secretary-alert-error" });
    const all: ButtonComponent[] = [];
    // A press that began before the buttons were ready does not count when it is released after.
    const readyAt = Date.now() + ARM_MS;
    let pressedAt = 0;
    buttons.addEventListener("pointerdown", () => (pressedAt = Date.now()), true);
    const ready = (event: MouseEvent) => Date.now() >= readyAt && (event.detail === 0 || pressedAt >= readyAt);
    const act = async (event: MouseEvent, run: () => Promise<boolean | null>) => {
      if (!ready(event)) return;
      all.forEach((b) => b.setDisabled(true));
      error.setText("");
      let ok: boolean | null = false;
      try {
        ok = await run();
      } catch (e) {
        console.error("[secretary] could not update a reminder", e);
      }
      if (ok === null) {
        all.forEach((b) => b.setDisabled(false));
        return;
      }
      if (!ok) {
        // Kept in the alert so it can be tried again, or the note edited by hand.
        error.setText(a.failed);
        all.forEach((b) => b.setDisabled(false));
        return;
      }
      row.remove();
      this.left.delete(r);
      this.times.delete(r);
      if (this.left.size === 0) this.close();
    };
    all.push(new ButtonComponent(buttons).setButtonText(a.done).setCta().onClick((e) => void act(e, () => this.actions.done(r))));
    for (const minutes of SNOOZE_MINUTES) {
      all.push(new ButtonComponent(buttons).setButtonText(a.snooze(minutes)).onClick((e) => void act(e, () => this.actions.snooze(r, minutes))));
    }
    all.push(new ButtonComponent(buttons).setButtonText(a.tomorrow).setTooltip(a.tomorrowTooltip(r.time)).onClick((e) => void act(e, () => this.actions.tomorrow(r))));
    all.push(new ButtonComponent(buttons).setButtonText(a.pick).onClick((e) => void act(e, () => this.actions.pick(r))));
    // Greyed out until ready, so the wait is visible rather than a click that does nothing.
    all.forEach((b) => b.setDisabled(true));
    window.setTimeout(() => {
      if (row.isConnected) all.forEach((b) => b.setDisabled(false));
    }, ARM_MS);
    this.left.set(r, row);
  }

  /** The time alone for today's reminders; the date too, marked as passed, for earlier ones. */
  private timeLabel(r: Reminder): string {
    return r.date === this.today ? r.time : this.s.alert.late(r.date, r.time);
  }

  /**
   * Obsidian closes a modal when its backdrop is clicked, so a stray click would dismiss the alert
   * unseen. A click outside shakes it instead; it closes with Close, × or Esc.
   */
  private keepOpenOnOutsideClick(): void {
    const backdrop = this.containerEl.querySelector(".modal-bg");
    if (!backdrop) return;
    const stop = (event: Event) => {
      if (event.target !== backdrop) return;
      event.stopPropagation();
      if (event.type !== "click") return;
      this.modalEl.removeClass("secretary-nudge");
      // Reading offsetWidth restarts the animation when the backdrop is clicked again.
      void this.modalEl.offsetWidth;
      this.modalEl.addClass("secretary-nudge");
    };
    // Capture on the container runs before the backdrop's own listener.
    for (const type of ["pointerdown", "mousedown", "click"]) this.containerEl.addEventListener(type, stop, true);
  }
}
