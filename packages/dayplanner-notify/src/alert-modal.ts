import { App, ButtonComponent, Modal } from "obsidian";
import type { Strings } from "./i18n";
import type { TaskStart } from "./match";

export interface AlertActions {
  /** Minutes offered as "+N" buttons for a task; empty hides its row. */
  postponeOptions(start: TaskStart): number[];
  /** Resolves to an error message to show in the modal, or null on success. */
  onPostpone(start: TaskStart, minutes: number): Promise<string | null>;
  onOpenNote(): void;
  onClosed(): void;
}

/** One alert for every task that started at once; each can be postponed on its own. */
export class TaskStartModal extends Modal {
  private remaining: number;

  constructor(app: App, private starts: TaskStart[], private s: Strings, private actions: AlertActions) {
    super(app);
    this.remaining = starts.length;
  }

  onOpen(): void {
    const { contentEl, s } = this;
    contentEl.addClass("dayplanner-notify-modal");
    this.keepOpenOnOutsideClick();
    // The task is what matters; the status is a small label above it.
    contentEl.createDiv({ text: s.starting, cls: "dayplanner-notify-label" });
    for (const start of this.starts) this.renderTask(contentEl.createDiv({ cls: "dayplanner-notify-item" }), start);

    const footer = contentEl.createDiv({ cls: "modal-button-container" });
    new ButtonComponent(footer).setButtonText(s.openNote).onClick(() => {
      this.actions.onOpenNote();
      this.close();
    });
    new ButtonComponent(footer).setButtonText(s.ok).setCta().onClick(() => this.close());
  }

  onClose(): void {
    this.contentEl.empty();
    this.actions.onClosed();
  }

  /**
   * Obsidian closes a modal when its backdrop is clicked, so a stray click would dismiss the alert
   * unseen. It closes only with OK, the close button or Esc; a click outside nudges it instead.
   */
  private keepOpenOnOutsideClick(): void {
    const backdrop = this.containerEl.querySelector(".modal-bg");
    if (!backdrop) return;
    const stop = (event: Event) => {
      if (event.target !== backdrop) return;
      event.stopPropagation();
      if (event.type !== "click") return;
      this.modalEl.removeClass("dayplanner-notify-nudge");
      // Reading offsetWidth restarts the animation when the backdrop is clicked again.
      void this.modalEl.offsetWidth;
      this.modalEl.addClass("dayplanner-notify-nudge");
    };
    // Capture on the container runs before the backdrop's own listener.
    for (const type of ["pointerdown", "mousedown", "click"]) this.containerEl.addEventListener(type, stop, true);
  }

  private renderTask(el: HTMLElement, start: TaskStart): void {
    const { s } = this;
    el.createDiv({ text: start.task, cls: "dayplanner-notify-task" });
    if (start.time !== "") el.createDiv({ text: start.time, cls: "dayplanner-notify-time" });

    const options = this.actions.postponeOptions(start);
    if (options.length === 0) return;
    const row = el.createDiv({ cls: "dayplanner-notify-postpone" });
    row.createSpan({ text: s.postpone, cls: "dayplanner-notify-postpone-label" });
    const error = el.createDiv({ cls: "dayplanner-notify-error" });
    const buttons: ButtonComponent[] = [];
    for (const minutes of options) {
      const button = new ButtonComponent(row)
        .setButtonText(s.postponeButton(minutes))
        .setTooltip(s.postponeTooltip(minutes))
        .onClick(async () => {
          buttons.forEach((b) => b.setDisabled(true));
          error.setText("");
          let message: string | null;
          try {
            message = await this.actions.onPostpone(start, minutes);
          } catch (e) {
            // Reading or writing the note failed; the buttons must not stay disabled.
            console.error("[dayplanner-notify] postpone failed", e);
            message = s.errors.writeFailed;
          }
          if (message === null) {
            // A postponed task leaves the alert; the alert closes with the last one.
            el.remove();
            if (--this.remaining === 0) this.close();
            return;
          }
          // Keep the task in the alert so the user can try again or edit the note.
          error.setText(message);
          buttons.forEach((b) => b.setDisabled(false));
        });
      buttons.push(button);
    }
  }
}
