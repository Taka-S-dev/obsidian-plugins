// Dialogs that ask before an action, such as pasting several lines into a program that would run
// each of them or undoing a change a terminal program made, and one that asks for a line of text.
import { type App, ButtonComponent, Modal, TextComponent } from "obsidian";
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

interface TextQuestion {
  title: string;
  value: string;
  placeholder: string;
  confirm: string;
  cancel: string;
}

class TextModal extends Modal {
  private answered = false;

  constructor(app: App, private readonly question: TextQuestion, private readonly done: (text: string | null) => void) {
    super(app);
  }

  onOpen(): void {
    const q = this.question;
    this.setTitle(q.title);
    const input = new TextComponent(this.contentEl).setValue(q.value).setPlaceholder(q.placeholder);
    input.inputEl.addClass("terminal-pane-text-input");
    const submit = () => {
      this.answer(input.getValue());
      this.close();
    };
    input.inputEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.isComposing) {
        event.preventDefault();
        submit();
      }
    });
    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    new ButtonComponent(buttons).setButtonText(q.cancel).onClick(() => this.close());
    new ButtonComponent(buttons).setButtonText(q.confirm).setCta().onClick(submit);
    window.setTimeout(() => input.inputEl.select(), 0);
  }

  onClose(): void {
    this.answer(null);
  }

  private answer(text: string | null): void {
    if (this.answered) return;
    this.answered = true;
    this.done(text);
  }
}

/** Resolves to the text entered, or null when the dialog is cancelled or closed. */
export function askText(app: App, question: TextQuestion): Promise<string | null> {
  return new Promise((resolve) => new TextModal(app, question, resolve).open());
}
