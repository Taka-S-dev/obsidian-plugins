import { App, Modal } from "obsidian";

/**
 * One date, picked from the system's calendar; Enter or the button saves, Esc closes. onSubmit
 * returns false to keep the modal open.
 */
export class DateModal extends Modal {
  constructor(
    app: App,
    private options: { title: string; submit: string; value: string },
    private onSubmit: (date: string) => Promise<boolean>,
  ) {
    super(app);
  }

  onOpen(): void {
    const o = this.options;
    this.titleEl.setText(o.title);
    const input = this.contentEl.createEl("input", { type: "date", value: o.value });
    const button = this.contentEl.createDiv({ cls: "modal-button-container" }).createEl("button", { cls: "mod-cta", text: o.submit });
    const update = () => {
      button.disabled = !/^\d{4}-\d{2}-\d{2}$/.test(input.value);
    };
    const submit = () => {
      if (button.disabled) return;
      void this.onSubmit(input.value).then((ok) => {
        if (ok) this.close();
      });
    };
    input.addEventListener("input", update);
    input.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
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
