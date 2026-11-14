// The last known contents of the vault's text files, so that a change a terminal program makes can
// be compared with what was there before, and undone. Pure module (no Obsidian imports).

const TEXT_EXTENSIONS = new Set(["md", "canvas", "base", "txt"]);

/** Whether files with this extension are remembered. */
export function isTextFile(extension: string): boolean {
  return TEXT_EXTENSIONS.has(extension.toLowerCase());
}

export class TextHistory {
  private readonly texts = new Map<string, string>();
  private total = 0;
  private readonly fileLimit: number;
  private readonly totalLimit: number;

  /** Files longer than `fileLimit` characters, or past `totalLimit` in all, are not remembered. */
  constructor(fileLimit = 1_000_000, totalLimit = 32_000_000) {
    this.fileLimit = fileLimit;
    this.totalLimit = totalLimit;
  }

  get(path: string): string | undefined {
    return this.texts.get(path);
  }

  set(path: string, text: string): void {
    this.delete(path);
    if (text.length > this.fileLimit || this.total + text.length > this.totalLimit) return;
    this.texts.set(path, text);
    this.total += text.length;
  }

  delete(path: string): void {
    const text = this.texts.get(path);
    if (text === undefined) return;
    this.texts.delete(path);
    this.total -= text.length;
  }

  rename(from: string, to: string): void {
    const text = this.texts.get(from);
    this.delete(from);
    if (text !== undefined) this.set(to, text);
  }
}
