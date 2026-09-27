import { App, ButtonComponent, Modal } from "obsidian";
import type { TaskStart } from "./match";

export interface AlertActions {
  /** Minutes offered as "+N" buttons; empty hides the row. */
  shiftOptions: number[];
  /** Resolves to an error message to show in the modal, or null on success. */
  onShift(minutes: number): Promise<string | null>;
  onOpenNote(): void;
  onClosed(): void;
}

export class TaskStartModal extends Modal {
  constructor(app: App, private start: TaskStart, private actions: AlertActions) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    this.setTitle("タスク開始");
    contentEl.addClass("dayplanner-notify-modal");
    contentEl.createEl("div", { text: this.start.task, cls: "dayplanner-notify-task" });
    if (this.start.time !== "") contentEl.createEl("div", { text: this.start.time, cls: "dayplanner-notify-time" });

    if (this.actions.shiftOptions.length > 0) {
      const row = contentEl.createDiv({ cls: "dayplanner-notify-shift" });
      row.createSpan({ text: "ずらす", cls: "dayplanner-notify-shift-label" });
      const error = contentEl.createDiv({ cls: "dayplanner-notify-error" });
      const shiftButtons: ButtonComponent[] = [];
      for (const minutes of this.actions.shiftOptions) {
        const button = new ButtonComponent(row)
          .setButtonText(`+${minutes}`)
          .setTooltip(`${minutes}分後ろへずらす`)
          .onClick(async () => {
            shiftButtons.forEach((b) => b.setDisabled(true));
            error.setText("");
            const message = await this.actions.onShift(minutes);
            if (message === null) {
              this.close();
              return;
            }
            // Keep the modal open so the user can fall back to editing the note.
            error.setText(message);
            shiftButtons.forEach((b) => b.setDisabled(false));
          });
        shiftButtons.push(button);
      }
    }

    const footer = contentEl.createDiv({ cls: "modal-button-container" });
    new ButtonComponent(footer).setButtonText("ノートを開く").onClick(() => {
      this.actions.onOpenNote();
      this.close();
    });
    new ButtonComponent(footer).setButtonText("OK").setCta().onClick(() => this.close());
  }

  onClose(): void {
    this.contentEl.empty();
    this.actions.onClosed();
  }
}
