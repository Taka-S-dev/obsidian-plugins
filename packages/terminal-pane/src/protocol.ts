// Messages between the plugin and the pty host, one JSON object per line over stdin/stdout.
// Pure module (no Obsidian or Node imports) so both sides and the tests share it.

export interface SpawnRequest {
  t: "spawn";
  file: string;
  /** Raw Windows command line after the program, passed to node-pty unchanged. */
  args: string;
  cwd: string;
  env: Record<string, string>;
  cols: number;
  rows: number;
  /** Use the newer ConPTY that ships with node-pty instead of the one built into Windows. */
  useConptyDll: boolean;
}

export type ToHost =
  | SpawnRequest
  | { t: "input"; data: string }
  | { t: "resize"; cols: number; rows: number }
  | { t: "pause" }
  | { t: "resume" }
  | { t: "kill" };

export type FromHost =
  | { t: "ready"; pid: number }
  | { t: "output"; data: string }
  | { t: "exit"; code: number }
  | { t: "error"; message: string };

export function encode(message: ToHost | FromHost): string {
  return JSON.stringify(message) + "\n";
}

/** Splits a text stream into complete lines; a partial last line waits for the next chunk. */
export class LineDecoder {
  private rest = "";

  push(chunk: string): string[] {
    const parts = (this.rest + chunk).split("\n");
    this.rest = parts.pop() ?? "";
    return parts.filter((line) => line.trim() !== "");
  }
}

/** Parses one line, or returns null for anything that is not a message object. */
export function parse<T extends { t: string }>(line: string): T | null {
  try {
    const value: unknown = JSON.parse(line);
    return value && typeof value === "object" && typeof (value as { t?: unknown }).t === "string" ? (value as T) : null;
  } catch {
    return null;
  }
}
