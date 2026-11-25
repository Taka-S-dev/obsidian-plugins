import { Scope, setIcon, setTooltip, type App } from "obsidian";
import { minuteChoices } from "./time.ts";

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * The time field's list of hours and minutes, in place of the system's own. That one goes round
 * (scrolling past 23 brings back 0), which reads as the value running over; this one is a plain
 * list that stops at its ends. Minutes come in steps of five; any minute can still be typed in the
 * field. A click on an hour sets it; a click on a minute sets it and closes the list. Esc (in a key
 * scope above the dialog's, so the dialog stays), a click outside, or the dialog closing closes it too.
 * Returns what removes the list, for the dialog's close.
 */
export function attachTimePicker(app: App, input: HTMLInputElement, label: string, parent: Scope): () => void {
  input.addClass("secretary-time-input");
  // The field looks like the date field: the same box, with the clock inside it on the left.
  const field = createSpan({ cls: "secretary-time-field" });
  input.insertAdjacentElement("beforebegin", field);
  field.appendChild(input);
  const button = field.createDiv({ cls: "clickable-icon secretary-time-button", attr: { "aria-label": label, role: "button", tabindex: "0" } });
  setIcon(button, "clock");
  setTooltip(button, label);

  let popup: HTMLElement | null = null;
  // While the list is open its own keys sit on top of the dialog's, as a menu's do, so Esc reaches
  // the list first; every other key falls through to the dialog.
  let keys: Scope | null = null;
  const close = () => {
    popup?.remove();
    popup = null;
    document.removeEventListener("pointerdown", outside, true);
    if (keys) app.keymap.popScope(keys);
    keys = null;
  };
  const outside = (e: Event) => {
    if (popup && !popup.contains(e.target as Node) && !button.contains(e.target as Node)) close();
  };
  const set = (h: number, m: number) => {
    input.value = `${pad(h)}:${pad(m)}`;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const open = () => {
    const m = /^(\d{2}):(\d{2})/.exec(input.value);
    const hour = m ? Number(m[1]) : null;
    const minute = m ? Number(m[2]) : null;
    popup = document.body.createDiv({ cls: "secretary-time-popup" });
    const column = (values: number[], selected: number | null, pick: (v: number) => void) => {
      const col = popup!.createDiv({ cls: "secretary-time-column" });
      for (const v of values) {
        const item = col.createDiv({ cls: ["secretary-time-item", ...(v === selected ? ["is-selected"] : [])], text: pad(v) });
        item.addEventListener("click", () => pick(v));
      }
      return col;
    };
    const hours = column(Array.from({ length: 24 }, (_, i) => i), hour, (h) => {
      set(h, minute ?? 0);
      close();
      open();
    });
    const minutes = column(minuteChoices(minute), minute, (mm) => {
      set(hour ?? new Date().getHours(), mm);
      close();
      input.focus();
    });
    // Below the field, or above it when there is no room below.
    const r = input.getBoundingClientRect();
    const height = popup.offsetHeight;
    popup.style.left = `${r.left}px`;
    popup.style.top = `${r.bottom + 4 + height > window.innerHeight ? Math.max(4, r.top - 4 - height) : r.bottom + 4}px`;
    // The chosen value in the middle of each column; with none yet, the current time.
    const now = new Date();
    const center = (col: HTMLElement, value: number) => {
      const items = Array.from(col.children) as HTMLElement[];
      const item = items.find((e) => Number(e.textContent) >= value) ?? items[items.length - 1];
      col.scrollTop = item.offsetTop - col.clientHeight / 2 + item.offsetHeight / 2;
    };
    center(hours, hour ?? now.getHours());
    center(minutes, minute ?? now.getMinutes());
    document.addEventListener("pointerdown", outside, true);
    keys = new Scope(parent);
    keys.register([], "Escape", () => {
      close();
      input.focus();
      return false;
    });
    app.keymap.pushScope(keys);
  };
  const toggle = () => (popup ? close() : open());
  button.addEventListener("click", toggle);
  button.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    toggle();
  });
  return close;
}
