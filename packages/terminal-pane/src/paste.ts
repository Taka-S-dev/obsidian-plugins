// What a paste sends. Pure module (no Obsidian imports) so it is testable.

/**
 * Control characters other than tab and line breaks are removed: an ESC or CSI in pasted text
 * could otherwise act as a key sequence, or end a bracketed paste early and run what follows.
 */
export function cleanPaste(text: string): string {
  return text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g, "");
}

/**
 * How many lines a shell would run on its own when the text is pasted: one per line break,
 * counting a final one, which a shell reads as Enter. Zero for text with no line break.
 */
export function linesRun(text: string): number {
  return (text.match(/\r\n|\r|\n/g) ?? []).length;
}
