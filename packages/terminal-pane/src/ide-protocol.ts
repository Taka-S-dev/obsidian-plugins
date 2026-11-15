// The messages Claude Code exchanges with an editor it is connected to, as the VS Code extension
// does: JSON-RPC (MCP) over a WebSocket. Pure module (no Obsidian or Node imports) so it is testable.

export interface RpcMessage {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
}

/**
 * A JSON-RPC message from its text, or null when the text is not JSON or not a message object:
 * `null`, a number or an array would otherwise fail later, where the message is read.
 */
export function parseRpc(text: string): RpcMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const { method, id } = value as { method?: unknown; id?: unknown };
  if (method !== undefined && typeof method !== "string") return null;
  if (id !== undefined && id !== null && typeof id !== "string" && typeof id !== "number") return null;
  return value as RpcMessage;
}

/** What Claude Code reads from ~/.claude/ide/<port>.lock to find and authenticate to the editor. */
export function lockFile(pid: number, workspaceFolder: string, authToken: string, windows: boolean): Record<string, unknown> {
  return {
    pid,
    workspaceFolders: [workspaceFolder],
    ideName: "Obsidian",
    transport: "ws",
    runningInWindows: windows,
    authToken,
  };
}

export interface Position {
  line: number;
  character: number;
}

export interface EditorSelection {
  /** Absolute path of the open file. */
  filePath: string;
  /** The selected text; empty when nothing is selected. */
  text: string;
  start: Position;
  end: Position;
}

/** Tells Claude Code which file is open and what is selected in it. */
export function selectionChanged(selection: EditorSelection): RpcMessage {
  const { filePath, text, start, end } = selection;
  const isEmpty = start.line === end.line && start.character === end.character;
  return {
    jsonrpc: "2.0",
    method: "selection_changed",
    params: { text, filePath, fileUrl: fileUrl(filePath), selection: { start, end, isEmpty } },
  };
}

/** A file, or lines of it, to add to the prompt being typed. Lines are 0-based. */
export interface Mention {
  filePath: string;
  lines?: { start: number; end: number };
}

/** Asks Claude Code to add a file to the prompt being typed, as @path or @path#L1-2. */
export function atMentioned(mention: Mention): RpcMessage {
  const { filePath, lines } = mention;
  return {
    jsonrpc: "2.0",
    method: "at_mentioned",
    params: lines ? { filePath, lineStart: lines.start, lineEnd: lines.end } : { filePath },
  };
}

/** file:///C:/a/b.md for C:\a\b.md, with each path segment percent-encoded. */
export function fileUrl(path: string): string {
  const slashed = path.replace(/\\/g, "/");
  const encoded = slashed.split("/").map((part, i) => (i === 0 && /^[a-z]:$/i.test(part) ? part : encodeURIComponent(part))).join("/");
  return `file://${encoded.startsWith("/") ? "" : "/"}${encoded}`;
}

/**
 * The tools Claude Code calls on its own. There are no diagnostics to compare before and after an
 * edit. openDiff shows a proposed edit; the editor answers it (see diffRequest), and without one
 * it is declined, so Claude Code keeps to the approval prompt in the terminal.
 */
const TOOLS = [
  {
    name: "openDiff",
    description: "Show a proposed edit to a file as a diff.",
    inputSchema: {
      type: "object",
      properties: {
        old_file_path: { type: "string" },
        new_file_path: { type: "string" },
        new_file_contents: { type: "string" },
        tab_name: { type: "string" },
      },
    },
  },
  { name: "getDiagnostics", description: "Diagnostics for a file or the workspace. Obsidian has none.", inputSchema: { type: "object", properties: { uri: { type: "string" } } } },
  { name: "close_tab", description: "Close a diff tab.", inputSchema: { type: "object", properties: { tab_name: { type: "string" } } } },
  { name: "closeAllDiffTabs", description: "Close all diff tabs.", inputSchema: { type: "object", properties: {} } },
];

const text = (value: string) => ({ content: [{ type: "text", text: value }] });

function callTool(name: unknown): unknown {
  switch (name) {
    case "getDiagnostics": return text("[]");
    case "close_tab": return text("TAB_CLOSED");
    case "closeAllDiffTabs": return text("OK");
    default: return { ...text(`Not supported in Obsidian: ${String(name)}`), isError: true };
  }
}

export interface DiffRequest {
  /** Absolute path of the file the edit is for. */
  path: string;
  /** The whole file as it would be after the edit. */
  contents: string;
  /** Claude Code's name for the diff, which it later closes it by. */
  tabName: string;
}

const toolCall = (message: RpcMessage, name: string): Record<string, unknown> | null => {
  if (message.method !== "tools/call" || message.id === undefined || message.id === null) return null;
  const params = (message.params ?? {}) as { name?: unknown; arguments?: unknown };
  return params.name === name ? ((params.arguments ?? {}) as Record<string, unknown>) : null;
};

/** The edit an openDiff call asks to show, or null for any other message. */
export function diffRequest(message: RpcMessage): DiffRequest | null {
  const args = toolCall(message, "openDiff");
  if (!args) return null;
  const path = args.new_file_path ?? args.old_file_path;
  const { new_file_contents: contents, tab_name: tabName } = args;
  if (typeof path !== "string" || typeof contents !== "string" || typeof tabName !== "string") return null;
  return { path, contents, tabName };
}

/** The diff a close_tab call closes, or null for any other message. */
export function closedTab(message: RpcMessage): string | null {
  const args = toolCall(message, "close_tab");
  return typeof args?.tab_name === "string" ? args.tab_name : null;
}

/**
 * The answer to an openDiff call when the edit is approved or rejected in Obsidian. Claude Code
 * then dismisses its approval prompt; an approval writes the proposed contents.
 */
export function diffDecision(id: string | number, request: DiffRequest, approve: boolean): RpcMessage {
  const content = approve
    ? [{ type: "text", text: "FILE_SAVED" }, { type: "text", text: request.contents }]
    : [{ type: "text", text: "DIFF_REJECTED" }, { type: "text", text: request.tabName }];
  return { jsonrpc: "2.0", id, result: { content } };
}

/** The reply to a request, or null for a notification, which gets none. */
export function reply(message: RpcMessage, version: string): RpcMessage | null {
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
    case "tools/call":
      return { jsonrpc: "2.0", id, result: callTool(params.name) };
    default:
      return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${message.method}` } };
  }
}
