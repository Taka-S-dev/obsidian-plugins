// Asks before pasting several lines into a program that would run each of them.
import { type App, ButtonComponent, Modal } from "obsidian";
import type { Strings } from "./i18n.ts";

class PasteConfirmModal extends Modal {
  private answered = false;

  constructor(app: App, private readonly s: Strings, private readonly lines: number, private readonly done: (ok: boolean) => void) {
    super(app);
  }

  onOpen(): void {
    const t = this.s.pasteConfirm;
    this.setTitle(t.title(this.lines));
    this.contentEl.createEl("p", { text: t.desc });
    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    new ButtonComponent(buttons).setButtonText(t.cancel).onClick(() => this.close());
    new ButtonComponent(buttons).setButtonText(t.paste).setCta().onClick(() => {
      this.answer(true);
      this.close();
    });
  }

  onClose(): void {
    this.answer(false);
  }

  private answer(ok: boolean): void {
    if (this.answered) return;
    this.answered = true;
    this.done(ok);
  }
}

/** Resolves to true when the user chooses to paste. Esc, Cancel and closing the dialog say no. */
export function confirmPaste(app: App, s: Strings, lines: number): Promise<boolean> {
  return new Promise((resolve) => new PasteConfirmModal(app, s, lines, resolve).open());
}
