import { getLinkpath, TFile, TFolder, type App } from "obsidian";
import { fileLinks } from "./file-links.ts";
import { canvasFiles, emptyFolders, findMention, inboundCounts, isBlankNote, isFileTarget, isIgnored, unusedFiles } from "./vault-scan.ts";

/** Files other than notes whose text is searched for names: canvases, bases, scripts, styles, data. */
const TEXT = new Set(["canvas", "base", "js", "css", "json", "txt"]);
/** Larger files are not read for names. */
const TEXT_LIMIT = 1_000_000;
/**
 * Outside the vault's files, a file can be named by a CSS snippet or a plugin's settings; deleting
 * it would break them. Those are searched too, under the config folder.
 */
const CONFIG_TEXTS = ["snippets", "plugins"];

export interface LinkAt {
  /** The note the link is in. */
  source: string;
  /** 0-based line; 0 for a link in the properties. */
  line: number;
  /** What the link points to, as written (a link path, or a Windows path outside the vault). */
  target: string;
}

export interface Report {
  brokenFiles: LinkAt[];
  missingNotes: LinkAt[];
  external: LinkAt[];
  /** `mentionedIn`: a note or script that writes the file's name though it does not link to it. */
  unused: { path: string; size: number; mtime: number; mentionedIn: string | null }[];
  empty: string[];
  /** Notes with nothing written in them; `linkedFrom`: how many links point to each. */
  blankNotes: { path: string; mtime: number; linkedFrom: number }[];
}

/** Reads the whole vault once, when asked to. Links to files outside it are collected here and checked on request. */
export async function scanVault(app: App, ignore: string[]): Promise<Report> {
  const { metadataCache, vault } = app;
  const used = new Set<string>();
  for (const targets of Object.values(metadataCache.resolvedLinks)) for (const t of Object.keys(targets)) used.add(t);

  const brokenFiles: LinkAt[] = [];
  const missingNotes: LinkAt[] = [];
  const external: LinkAt[] = [];
  const resolves = (target: string, from: string) => {
    if (metadataCache.getFirstLinkpathDest(target, from)) return true;
    // A Markdown link may hold its path percent-encoded (my%20image.png).
    try {
      const decoded = decodeURIComponent(target);
      return decoded !== target && metadataCache.getFirstLinkpathDest(decoded, from) !== null;
    } catch {
      return false;
    }
  };

  // Every note's text, and that of scripts, styles and data in the vault, is searched for the names
  // of unused files; ignored folders included, since a template can name a file too.
  const texts: [string, string][] = [];
  const inbound = inboundCounts(metadataCache.resolvedLinks);
  const blankNotes: Report["blankNotes"] = [];
  for (const file of vault.getMarkdownFiles()) {
    const text = await vault.cachedRead(file);
    texts.push([file.path, text]);
    if (isIgnored(file.path, ignore)) continue;
    if (isBlankNote(text)) blankNotes.push({ path: file.path, mtime: file.stat.mtime, linkedFrom: inbound.get(file.path) ?? 0 });
    const cache = metadataCache.getFileCache(file);
    const refs = [
      ...(cache?.embeds ?? []).map((r) => ({ link: r.link, line: r.position.start.line, embed: true })),
      ...(cache?.links ?? []).map((r) => ({ link: r.link, line: r.position.start.line, embed: false })),
      ...(cache?.frontmatterLinks ?? []).map((r) => ({ link: r.link, line: 0, embed: false })),
    ];
    for (const r of refs) {
      const target = getLinkpath(r.link);
      // [[#Heading]] points into the same note.
      if (!target || resolves(target, file.path)) continue;
      (isFileTarget(target, r.embed) ? brokenFiles : missingNotes).push({ source: file.path, line: r.line, target });
    }
    for (const l of fileLinks(text)) external.push({ source: file.path, line: l.line, target: l.path });
  }

  const files = vault.getFiles();
  for (const f of files) {
    if (!TEXT.has(f.extension) || f.stat.size > TEXT_LIMIT) continue;
    const text = await vault.cachedRead(f);
    texts.push([f.path, text]);
    if (f.extension === "canvas") for (const p of canvasFiles(text)) used.add(p);
  }
  texts.push(...(await configTexts(app)));
  const stats = new Map(files.map((f) => [f.path, f.stat]));
  const unused = unusedFiles([...stats.keys()], used, ignore).map((path) => ({
    path,
    size: stats.get(path)?.size ?? 0,
    mtime: stats.get(path)?.mtime ?? 0,
    mentionedIn: findMention(path, texts.filter(([source]) => source !== path)),
  }));
  const folders = vault.getAllLoadedFiles().flatMap((f) => (f instanceof TFolder && !f.isRoot() ? [f.path] : []));
  return {
    brokenFiles,
    missingNotes,
    external,
    unused,
    empty: emptyFolders(folders, [...stats.keys()], ignore),
    blankNotes: blankNotes.sort((a, b) => a.path.localeCompare(b.path)),
  };
}

/** CSS snippets and plugin settings: `.obsidian/snippets/*.css` and `.obsidian/plugins/<id>/data.json`. */
async function configTexts(app: App): Promise<[string, string][]> {
  const { adapter, configDir } = app.vault;
  const out: [string, string][] = [];
  const read = async (path: string) => {
    try {
      const stat = await adapter.stat(path);
      if (stat && stat.size <= TEXT_LIMIT) out.push([path, await adapter.read(path)]);
    } catch {
      // A file that cannot be read names nothing.
    }
  };
  for (const dir of CONFIG_TEXTS) {
    const base = `${configDir}/${dir}`;
    let listed: { files: string[]; folders: string[] };
    try {
      if (!(await adapter.exists(base))) continue;
      listed = await adapter.list(base);
    } catch {
      continue;
    }
    if (dir === "snippets") for (const f of listed.files) if (f.endsWith(".css")) await read(f);
    if (dir === "plugins") for (const d of listed.folders) await read(`${d}/data.json`);
  }
  return out;
}

/** Still nothing links to the file: checked again right before it goes to the trash. */
export function stillUnused(app: App, path: string): boolean {
  for (const targets of Object.values(app.metadataCache.resolvedLinks)) if (path in targets) return false;
  return app.vault.getAbstractFileByPath(path) instanceof TFile;
}

/** Still a note with nothing written in it: checked again right before it goes to the trash. */
export async function stillBlank(app: App, path: string): Promise<boolean> {
  const file = app.vault.getAbstractFileByPath(path);
  return file instanceof TFile && file.extension === "md" && isBlankNote(await app.vault.read(file));
}

/** Still a folder with no file at any depth. */
export function stillEmpty(app: App, path: string): boolean {
  const folder = app.vault.getAbstractFileByPath(path);
  if (!(folder instanceof TFolder)) return false;
  const walk = (f: TFolder): boolean => f.children.every((c) => c instanceof TFolder && walk(c));
  return walk(folder);
}
