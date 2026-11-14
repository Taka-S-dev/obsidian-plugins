// The messages GitHub Copilot CLI exchanges with an editor it is connected to, as the VS Code
// extension does: MCP over HTTP on a named pipe, found through a lock file in ~/.copilot/ide.
// Pure module (no Obsidian or Node imports) so it is testable.
import type { DiffRequest, RpcMessage } from "./ide-protocol.ts";

export interface CopilotLock {
  socketPath: string;
  scheme: "pipe";
  headers: Record<string, string>;
  pid: number;
  timestamp: number;
  workspaceFolders: string[];
  ideName: string;
  isTrusted: boolean;
}

/** Copilot CLI connects to a lock file whose workspace folder holds the folder it was started in. */
export function copilotLock(socketPath: string, nonce: string, pid: number, workspaceFolder: string, now: number): CopilotLock {
  return {
    socketPath,
    scheme: "pipe",
    headers: { Authorization: `Nonce ${nonce}` },
    pid,
    timestamp: now,
    workspaceFolders: [workspaceFolder],
    ideName: "Obsidian",
    isTrusted: true,
  };
}

/**
 * Tools Copilot CLI calls. get_selection and get_diagnostics are also offered to the model;
 * open_diff and close_diff show a proposed edit while Copilot CLI asks for approval.
 */
const TOOLS = [
  {
    name: "get_selection",
    // Copilot CLI attaches only a non-empty selection to the prompt, so with nothing selected the
    // model learns which note is open only by calling this.
    description: "Returns the path of the note the user has open in Obsidian, their editor, and the text "
      + "selected in it (empty when nothing is selected). Call this first whenever the user refers to "
      + "\"this note\", \"this file\", \"the current file\", \"the open note\" or \"the selection\" "
      + "without naming a file.",
    inputSchema: { type: "object", properties: {} },
  },
  { name: "get_diagnostics", description: "Diagnostics for a file. Obsidian has none.", inputSchema: { type: "object", properties: { uri: { type: "string" } } } },
  {
    name: "open_diff",
    description: "Show a proposed edit to a file as a diff.",
    inputSchema: {
      type: "object",
      properties: { original_file_path: { type: "string" }, new_file_contents: { type: "string" }, tab_name: { type: "string" } },
    },
  },
  { name: "close_diff", description: "Close a diff.", inputSchema: { type: "object", properties: { tab_name: { type: "string" } } } },
  { name: "update_session_name", description: "The name of the Copilot CLI session.", inputSchema: { type: "object", properties: { name: { type: "string" } } } },
];

const text = (value: string) => ({ content: [{ type: "text", text: value }] });

const toolArgs = (message: RpcMessage, name: string): Record<string, unknown> | null => {
  if (message.method !== "tools/call" || message.id === undefined || message.id === null) return null;
  const params = (message.params ?? {}) as { name?: unknown; arguments?: unknown };
  return params.name === name ? ((params.arguments ?? {}) as Record<string, unknown>) : null;
};

/** The edit an open_diff call asks to show, or null for any other message. */
export function copilotDiffRequest(message: RpcMessage): DiffRequest | null {
  const args = toolArgs(message, "open_diff");
  if (!args) return null;
  const { original_file_path: path, new_file_contents: contents, tab_name: tabName } = args;
  if (typeof path !== "string" || typeof contents !== "string" || typeof tabName !== "string") return null;
  return { path, contents, tabName };
}

/** The diff a close_diff call closes, or null for any other message. */
export function copilotClosedDiff(message: RpcMessage): string | null {
  const args = toolArgs(message, "close_diff");
  return typeof args?.tab_name === "string" ? args.tab_name : null;
}

/** The answer to close_diff, in the form Copilot CLI reads. */
export function closeDiffResult(tabName: string, wasOpen: boolean): unknown {
  return text(JSON.stringify({
    success: true,
    already_closed: !wasOpen,
    tab_name: tabName,
    message: wasOpen ? "Closed" : "Already closed",
  }));
}

/**
 * The answer to an open_diff call whose diff closed because the edit was decided in the terminal.
 * It is deliberately not a SAVED or REJECTED result, which Copilot CLI would take as the decision.
 */
export const DIFF_CLOSED_RESULT = text("Closed: the edit was decided in the terminal.");

/** The answer to an open_diff call when the edit is approved or rejected in Obsidian. */
export function diffDecisionResult(approve: boolean): unknown {
  return text(JSON.stringify({
    success: true,
    result: approve ? "SAVED" : "REJECTED",
    trigger: approve ? "approved_in_obsidian" : "rejected_in_obsidian",
    message: approve ? "Approved in Obsidian" : "Rejected in Obsidian",
  }));
}

/**
 * The reply to a request, or null for a notification. open_diff is not answered here: the caller
 * keeps the request open while the diff is on screen.
 */
export function copilotReply(message: RpcMessage, version: string, selection: unknown): RpcMessage | null {
  if (message.id === undefined || message.id === null || typeof message.method !== "string") return null;
  const id = message.id;
  const params = (message.params ?? {}) as Record<string, unknown>;
  switch (message.method) {
    case "initialize":
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: typeof params.protocolVersion === "string" ? params.protocolVersion : "2025-06-18",
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "Obsidian Terminal Pane", version },
        },
      };
    case "ping":
      return { jsonrpc: "2.0", id, result: {} };
    case "tools/list":
      return { jsonrpc: "2.0", id, result: { tools: TOOLS } };
    case "tools/call": {
      const name = params.name;
      if (name === "get_selection") return { jsonrpc: "2.0", id, result: text(JSON.stringify(selection ?? null)) };
      if (name === "get_diagnostics") return { jsonrpc: "2.0", id, result: text("[]") };
      if (name === "update_session_name") return { jsonrpc: "2.0", id, result: text("OK") };
      return { jsonrpc: "2.0", id, result: { ...text(`Not supported in Obsidian: ${String(name)}`), isError: true } };
    }
    default:
      return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${message.method}` } };
  }
}
