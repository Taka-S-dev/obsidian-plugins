// The queue folder on disk. Node fs only (no Obsidian), so it runs under node --test.
// Lives outside the vault: senders need not know where the vault is, and messages never show up
// in search, Tasks queries or the vault's git history.

import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { isMessageFile, MAX_BYTES, parseMessage, type Parsed } from "./queue.ts";

export const REJECTED_DIR = "rejected";

/** %LOCALAPPDATA%\Secretary\queue on Windows; ~/.secretary/queue elsewhere. */
export function defaultQueueDir(env: Record<string, string | undefined> = process.env, home: string = homedir()): string {
  return env.LOCALAPPDATA ? join(env.LOCALAPPDATA, "Secretary", "queue") : join(home, ".secretary", "queue");
}

export async function ensureQueueDir(dir: string): Promise<void> {
  await fs.mkdir(join(dir, REJECTED_DIR), { recursive: true });
}

/** Message file names, oldest name first (senders start names with a timestamp), at most limit. */
export async function listMessages(dir: string, limit: number): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && isMessageFile(e.name))
    .map((e) => e.name)
    .sort()
    .slice(0, limit);
}

/** Reads and checks one message. A file over the size limit is rejected without being read. */
export async function readMessage(dir: string, name: string): Promise<Parsed> {
  const path = join(dir, name);
  const stat = await fs.stat(path);
  if (stat.size > MAX_BYTES) return { ok: false, reason: "size" };
  return parseMessage(name, await fs.readFile(path, "utf8"));
}

/**
 * What marks a message as handled: its name with its size and modification time, so a sender that
 * reuses a name for a new message is not taken for one already handled.
 */
export async function messageKey(dir: string, name: string): Promise<string> {
  const stat = await fs.stat(join(dir, name));
  return `${name}|${stat.size}|${Math.trunc(stat.mtimeMs)}`;
}

export async function removeMessage(dir: string, name: string): Promise<void> {
  await fs.rm(join(dir, name), { force: true });
}

/** Moves the file into rejected/, keeping any earlier file with the same name. Returns the new name. */
export async function rejectMessage(dir: string, name: string): Promise<string> {
  const target = join(dir, REJECTED_DIR);
  await fs.mkdir(target, { recursive: true });
  let candidate = name;
  for (let i = 1; ; i++) {
    try {
      await fs.access(join(target, candidate));
      candidate = name.replace(/(\.json)?$/i, `-${i}$1`);
    } catch {
      break;
    }
  }
  await fs.rename(join(dir, name), join(target, candidate));
  return candidate;
}
