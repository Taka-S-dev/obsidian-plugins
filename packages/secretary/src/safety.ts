// Which links open without asking. Pure module (no Obsidian imports).
//
// Notices and inbox items can come from other programs through the queue, so one click on a link
// in them must not run a program or reach a server unasked. Only documents, pictures and media of
// known kinds open directly; any other file (a program, a script, a shortcut, a macro document, a
// disk image, or a kind not on the list) is opened only after a confirmation.

const OPENS_DIRECTLY = new Set([
  // text and data
  "txt", "md", "csv", "tsv", "log", "json", "yaml", "yml",
  // documents that cannot hold macros. Not listed: the older Office formats (.doc, .xls, .ppt,
  // .vsd, .mpp), which can, and files that carry other content (.rtf, .one, .xml, .msg, .eml).
  "pdf", "docx", "xlsx", "pptx", "odt", "ods", "odp", "vsdx",
  // pictures
  "png", "jpg", "jpeg", "gif", "bmp", "webp", "tif", "tiff", "heic",
  // audio and video
  "mp3", "wav", "m4a", "mp4", "mov", "avi", "wmv", "mkv",
  // archives Explorer shows as folders
  "zip",
]);

/** A document, picture or media file of a known kind, which opens in its viewer rather than running. */
export function opensDirectly(path: string): boolean {
  // Windows ignores trailing dots and spaces: "setup.exe. " runs as setup.exe.
  const name = (path.split(/[\\/]+/).pop() ?? "").replace(/[. ]+$/, "");
  // A colon in the file name means an alternate data stream (e.g. "a.txt:b.exe").
  if (name.includes(":")) return false;
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return false;
  return OPENS_DIRECTLY.has(name.slice(dot + 1).toLowerCase());
}

/**
 * The server of a share path (\\server\share\... -> "server", lower case), or null for a local
 * path. Opening a path on a server signs in to it with the Windows account, so a server not seen
 * before is confirmed first.
 */
export function shareHost(path: string): string | null {
  const m = /^\\\\([^\\/]+)/.exec(path);
  return m ? m[1].toLowerCase() : null;
}

/** Schemes other than these stay text: a protocol handler (ms-msdt:, search-ms:) can run programs. */
export function isOpenableScheme(url: string): boolean {
  return /^(?:https?|mailto):/i.test(url);
}
