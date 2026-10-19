// UI text in English and Japanese. Pure module (no Obsidian imports) so key parity is testable.
// The language follows Obsidian's own setting; anything but Japanese falls back to English.

const en = {
  pasteCommand: "Paste clipboard paths and URLs as links",
  pastedBelowProperties: "The cursor was not in the note body, so the links went below the properties.",
  openTitle: (path: string) => `Open: ${path}`,
  opening: (path: string) => `Opening: ${path}`,
  copy: "Copy",
  copied: "Copied",
  copyTitle: "Copy only the original path",
  copyPathLabel: (path: string) => `Copy path: ${path}`,
  pathCopied: "Path copied",
  menuCopyPath: "Copy Windows path",
  copyFailed: (error: string) => `Could not copy: ${error}`,
  openFailed: (path: string, error: string) => `Could not open: ${path}\n${error}`,
  confirm: {
    title: "This file runs as a program",
    body: "Opening this link runs it as a program or script. Open it only if you know where the file came from.",
    cancel: "Cancel",
    open: "Open",
  },
  inputErrors: {
    empty: "The clipboard has no path or URL.",
    notAbsolute: "Copy an absolute Windows path, such as \\\\server\\share or C:\\Users.",
  },
};

export type Strings = typeof en;

const ja: Strings = {
  pasteCommand: "クリップボードのパス・URLをリンクとして貼り付け",
  pastedBelowProperties: "カーソルが本文になかったため、プロパティの下に貼り付けました。",
  openTitle: (path) => `開く：${path}`,
  opening: (path) => `開いています：${path}`,
  copy: "コピー",
  copied: "コピー済み",
  copyTitle: "元のパスだけをコピー",
  copyPathLabel: (path) => `パスをコピー：${path}`,
  pathCopied: "パスをコピーしました",
  menuCopyPath: "Windows のパスをコピー",
  copyFailed: (error) => `コピーできませんでした：${error}`,
  openFailed: (path, error) => `開けませんでした：${path}\n${error}`,
  confirm: {
    title: "プログラムとして実行されるファイルです",
    body: "このリンク先は、開くとプログラムやスクリプトとして実行される種類のファイルです。出どころを確認してから開いてください。",
    cancel: "キャンセル",
    open: "開く",
  },
  inputErrors: {
    empty: "クリップボードにパスやURLがありません。",
    notAbsolute: "Windowsの絶対パスをコピーしてください（例：\\\\server\\share、C:\\Users）。",
  },
};

export const STRINGS = { en, ja };

/** Obsidian language code ("ja", "en", "zh-TW", ...) -> UI strings. */
export function stringsFor(language: string): Strings {
  return language.toLowerCase().startsWith("ja") ? ja : en;
}
