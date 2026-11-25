import { pastedLink } from "./links.ts";

/**
 * A Windows path or web address pasted into the field goes in as a link, as the panel and the
 * alert can open it; the selection, if any, becomes its label. Anything else pastes as it is.
 */
export function linkOnPaste(input: HTMLInputElement): void {
  input.addEventListener("paste", (event) => {
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? start;
    const link = pastedLink(event.clipboardData?.getData("text/plain") ?? "", input.value.slice(start, end));
    if (link === null) return;
    event.preventDefault();
    // insertText keeps Ctrl+Z working. It can report success and insert nothing (when the window
    // is not focused), so the field is checked and setRangeText used instead.
    const before = input.value;
    if (!document.execCommand("insertText", false, link) || input.value === before) {
      input.setRangeText(link, start, end, "end");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
}
