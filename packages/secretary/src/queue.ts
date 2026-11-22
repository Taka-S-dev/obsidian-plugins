// Messages that other programs drop into the queue folder. Pure module (no Obsidian, no fs).
//
// Contract, version 1. One message = one UTF-8 JSON file named <anything>.json, written to a
// temporary name first and renamed into place, so a half-written file is never read:
//
//   { "v": 1, "type": "notify", "text": "The report is ready", "source": "copilot" }
//   { "v": 1, "type": "remind", "text": "Call the dentist", "at": "2026-11-20T15:00" }
//   { "v": 1, "type": "inbox",  "text": "Return the library books" }
//
//   type    notify: announce now and keep it in the panel until marked done
//           remind: add to the reminders note, announced at "at"
//           inbox:  add to the inbox note
//   text    required, 1 to MAX_TEXT characters
//   at      remind only, required: local time "YYYY-MM-DDTHH:MM" (seconds allowed, no time zone)
//   source  optional: who sent it, shown in the panel
//   quiet   optional, notify only: true shows it in the panel without a popup
//
// Unknown fields are ignored so later versions can add some; an unknown "v" is rejected.

export const QUEUE_VERSION = 1;
export const MAX_BYTES = 16 * 1024;
export const MAX_TEXT = 1000;
const MAX_SOURCE = 40;

export type MessageType = "notify" | "remind" | "inbox";

export interface QueueMessage {
  /** The file name; unique per message. */
  id: string;
  type: MessageType;
  text: string;
  /** remind only. */
  at?: { date: string; time: string };
  source?: string;
  quiet: boolean;
}

export type RejectReason = "json" | "version" | "type" | "text" | "at" | "source" | "size";

export type Parsed = { ok: true; message: QueueMessage } | { ok: false; reason: RejectReason };

const TYPES: readonly string[] = ["notify", "remind", "inbox"];
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

/** Files the queue reads: "*.json", not hidden. Temporary files (".tmp" and others) are left alone. */
export function isMessageFile(name: string): boolean {
  return name.toLowerCase().endsWith(".json") && !name.startsWith(".");
}

function parseAt(value: unknown): { date: string; time: string } | null {
  if (typeof value !== "string") return null;
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2})?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  const date = new Date(+y, +mo - 1, +d);
  if (date.getFullYear() !== +y || date.getMonth() !== +mo - 1 || date.getDate() !== +d) return null;
  if (+h > 23 || +mi > 59) return null;
  return { date: `${y}-${mo}-${d}`, time: `${h}:${mi}` };
}

export function parseMessage(id: string, content: string): Parsed {
  if (content.length > MAX_BYTES) return { ok: false, reason: "size" };
  let data: unknown;
  try {
    data = JSON.parse(content.replace(/^﻿/, ""));
  } catch {
    return { ok: false, reason: "json" };
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) return { ok: false, reason: "json" };
  const d = data as Record<string, unknown>;

  if (d.v !== QUEUE_VERSION) return { ok: false, reason: "version" };
  if (typeof d.type !== "string" || !TYPES.includes(d.type)) return { ok: false, reason: "type" };
  const type = d.type as MessageType;

  if (typeof d.text !== "string") return { ok: false, reason: "text" };
  const text = d.text.replace(/\r\n?/g, "\n").trim();
  if (text === "" || text.length > MAX_TEXT || CONTROL.test(text)) return { ok: false, reason: "text" };

  let source: string | undefined;
  if (d.source !== undefined) {
    if (typeof d.source !== "string") return { ok: false, reason: "source" };
    source = d.source.trim();
    if (source.length > MAX_SOURCE || /[\n\r]/.test(source) || CONTROL.test(source)) return { ok: false, reason: "source" };
    if (source === "") source = undefined;
  }

  let at: QueueMessage["at"];
  if (type === "remind") {
    const parsed = parseAt(d.at);
    if (!parsed) return { ok: false, reason: "at" };
    at = parsed;
  }

  return { ok: true, message: { id, type, text, at, source, quiet: type === "notify" && d.quiet === true } };
}
