// Dialogs that ask before an action: pasting several lines into a program that would run each of
// them, and undoing a change a terminal program made.
import { type App, ButtonComponent, Modal } from "obsidian";
import type { Strings } from "./i18n.ts";

interface Question {
  title: string;
  desc: string;
  confirm: string;
  cancel: string;
  /** Marks the confirm button as one that discards something. */
  warning?: boolean;
}

class ConfirmModal extends Modal {
  private answered = false;

  constructor(app: App, private readonly question: Question, private readonly done: (ok: boolean) => void) {
    super(app);
  }

  onOpen(): void {
    const q = this.question;
    this.setTitle(q.title);
    this.contentEl.createEl("p", { text: q.desc });
    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    new ButtonComponent(buttons).setButtonText(q.cancel).onClick(() => this.close());
    const confirm = new ButtonComponent(buttons).setButtonText(q.confirm).onClick(() => {
      this.answer(true);
      this.close();
    });
    if (q.warning) confirm.setWarning();
    else confirm.setCta();
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

/** Resolves to true when the user confirms. Esc, Cancel and closing the dialog say no. */
export function confirmAction(app: App, question: Question): Promise<boolean> {
  return new Promise((resolve) => new ConfirmModal(app, question, resolve).open());
}

/** Resolves to true when the user chooses to paste. */
export function confirmPaste(app: App, s: Strings, lines: number): Promise<boolean> {
  const t = s.pasteConfirm;
  return confirmAction(app, { title: t.title(lines), desc: t.desc, confirm: t.paste, cancel: t.cancel });
}
