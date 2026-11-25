import { App, Modal, Setting } from "obsidian";
import { linkOnPaste } from "./paste-link.ts";
import { checkReminder, daysFrom, parseReminderInput } from "./reminders.ts";
import type { Strings } from "./i18n.ts";
import { ymd } from "./time.ts";

/**
 * What to be reminded of, with the date and time picked from the system's calendar and clock.
 * Text that starts with a time ("15:00 Call the dentist") fills them in, so the keyboard alone
 * still works. Enter or the button adds it; the preview under the fields says when it will go off.
 */
export interface ReminderModalStart {
  title: string;
  /** The button's label: "Save" when an existing reminder is changed. Defaults to "Add". */
  submit?: string;
  text: string;
  date: string;
  time: string;
}

export class ReminderModal extends Modal {
  private submitted = false;

  /** `start` fills the fields, to move an existing reminder; `onCancel` runs if nothing was added. */
  constructor(
    app: App,
    private s: Strings["capture"],
    private onSubmit: (date: string, time: string, text: string) => Promise<boolean>,
    private start?: ReminderModalStart,
    private onCancel?: () => void,
  ) {
    super(app);
  }

  onOpen(): void {
    const c = this.s;
    this.titleEl.setText(this.start?.title ?? c.reminderTitle);
    this.contentEl.createDiv({ cls: "secretary-line-hint", text: c.reminderHint });

    let textEl!: HTMLInputElement;
    let dateEl!: HTMLInputElement;
    let timeEl!: HTMLInputElement;
    new Setting(this.contentEl).setName(c.reminderText).addText((t) => {
      textEl = t.inputEl;
      t.setPlaceholder(c.reminderPlaceholder).setValue(this.start?.text ?? "");
      textEl.addClass("secretary-reminder-text");
      linkOnPaste(textEl);
    });
    new Setting(this.contentEl).setName(c.reminderDate).then((row) => {
      dateEl = row.controlEl.createEl("input", { type: "date", value: this.start?.date ?? ymd(new Date()) });
    });
    new Setting(this.contentEl).setName(c.reminderTime).then((row) => {
      timeEl = row.controlEl.createEl("input", { type: "time", value: this.start?.time ?? "" });
    });
    const preview = this.contentEl.createDiv({ cls: "secretary-line-preview" });
    const button = this.contentEl.createDiv({ cls: "modal-button-container" }).createEl("button", { cls: "mod-cta", text: this.start?.submit ?? c.submit });

    const check = () => checkReminder(textEl.value, dateEl.value, timeEl.value, new Date());
    const update = () => {
      const r = check();
      if (r.ok) preview.setText(c.reminderPreview(c.reminderWhen(daysFrom(r.date, new Date()), r.date, r.time), r.text));
      else preview.setText(textEl.value.trim() || timeEl.value ? c.reminderProblem[r.reason] : "");
      preview.toggleClass("is-invalid", !r.ok);
      button.disabled = !r.ok;
    };
    const submit = () => {
      const r = check();
      if (!r.ok) return;
      void this.onSubmit(r.date, r.time, r.text).then((ok) => {
        if (!ok) return;
        this.submitted = true;
        this.close();
      });
    };

    // A time typed at the start of the text moves into the pickers. Not while an IME is composing:
    // rewriting the field then would break the word being converted.
    const fillFromText = () => {
      const parsed = parseReminderInput(textEl.value, new Date());
      if (parsed && parsed.text !== textEl.value.trim()) {
        dateEl.value = parsed.date;
        timeEl.value = parsed.time;
        textEl.value = parsed.text;
      }
    };
    textEl.addEventListener("input", (e) => {
      if (!(e as InputEvent).isComposing) fillFromText();
      update();
    });
    textEl.addEventListener("compositionend", () => {
      fillFromText();
      update();
    });
    dateEl.addEventListener("input", update);
    timeEl.addEventListener("input", update);
    for (const el of [textEl, dateEl, timeEl]) {
      el.addEventListener("keydown", (e) => {
        if (e.key !== "Enter" || e.isComposing) return;
        e.preventDefault();
        submit();
      });
    }
    button.addEventListener("click", submit);
    update();
    window.setTimeout(() => textEl.focus(), 0);
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.submitted) this.onCancel?.();
  }
}
