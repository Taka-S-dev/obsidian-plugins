import { App, ButtonComponent, Modal } from "obsidian";
import type { Strings } from "./i18n";
import type { TaskStart } from "./match";

export interface AlertActions {
  /** Minutes offered as "+N" buttons; empty hides the row. */
  postponeOptions: number[];
  /** Resolves to an error message to show in the modal, or null on success. */
  onPostpone(minutes: number): Promise<string | null>;
  onOpenNote(): void;
  onClosed(): void;
}

export class TaskStartModal extends Modal {
  constructor(app: App, private start: TaskStart, private s: Strings, private actions: AlertActions) {
    super(app);
  }

  onOpen(): void {
    const { contentEl, s } = this;
    contentEl.addClass("dayplanner-notify-modal");
    this.keepOpenOnOutsideClick();
    // The task is what matters; the status is a small label above it.
    contentEl.createDiv({ text: s.starting, cls: "dayplanner-notify-label" });
    contentEl.createDiv({ text: this.start.task, cls: "dayplanner-notify-task" });
    if (this.start.time !== "") contentEl.createDiv({ text: this.start.time, cls: "dayplanner-notify-time" });

    if (this.actions.postponeOptions.length > 0) {
      const row = contentEl.createDiv({ cls: "dayplanner-notify-postpone" });
      row.createSpan({ text: s.postpone, cls: "dayplanner-notify-postpone-label" });
      const error = contentEl.createDiv({ cls: "dayplanner-notify-error" });
      const buttons: ButtonComponent[] = [];
      for (const minutes of this.actions.postponeOptions) {
        const button = new ButtonComponent(row)
          .setButtonText(s.postponeButton(minutes))
          .setTooltip(s.postponeTooltip(minutes))
          .onClick(async () => {
            buttons.forEach((b) => b.setDisabled(true));
            error.setText("");
            const message = await this.actions.onPostpone(minutes);
            if (message === null) {
              this.close();
              return;
            }
            // Keep the modal open so the user can fall back to editing the note.
            error.setText(message);
            buttons.forEach((b) => b.setDisabled(false));
          });
        buttons.push(button);
      }
    }

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
}
