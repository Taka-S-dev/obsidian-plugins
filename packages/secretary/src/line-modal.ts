import { App, Modal } from "obsidian";

export interface LineModalOptions {
  title: string;
  placeholder: string;
  /** What to type, shown above the field. */
  hint?: string;
  /** The button's label. */
  submit: string;
}

/**
 * One line of text; Enter or the button submits, Esc closes. Enter while composing (IME) is left
 * to the IME. onSubmit returns false to keep the modal open (for input that could not be used).
 */
export class LineModal extends Modal {
  constructor(
    app: App,
    private options: LineModalOptions,
    private onSubmit: (text: string) => Promise<boolean>,
  ) {
    super(app);
  }

  onOpen(): void {
    const o = this.options;
    this.titleEl.setText(o.title);
    if (o.hint) this.contentEl.createDiv({ cls: "secretary-line-hint", text: o.hint });
    const input = this.contentEl.createEl("input", {
      type: "text",
      cls: "secretary-line-input",
      attr: { placeholder: o.placeholder },
    });
    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    const button = buttons.createEl("button", { cls: "mod-cta", text: o.submit });

    const update = () => {
      button.disabled = !input.value.trim();
    };
    const submit = () => {
      const text = input.value.trim();
      if (!text) return;
      void this.onSubmit(text).then((ok) => {
        if (ok) this.close();
        else input.focus();
      });
    };
    input.addEventListener("input", update);
    input.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" || e.isComposing) return;
      e.preventDefault();
      if (!input.value.trim()) return this.close();
      submit();
    });
    button.addEventListener("click", submit);
    update();
    window.setTimeout(() => input.focus(), 0);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
