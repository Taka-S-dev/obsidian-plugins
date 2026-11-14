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

/** file:///C:/a/b.md for C:\a\b.md, with each path segment percent-encoded. */
export function fileUrl(path: string): string {
  const slashed = path.replace(/\\/g, "/");
  const encoded = slashed.split("/").map((part, i) => (i === 0 && /^[a-z]:$/i.test(part) ? part : encodeURIComponent(part))).join("/");
  return `file://${encoded.startsWith("/") ? "" : "/"}${encoded}`;
}

/**
 * The tools Claude Code calls on its own, answered so that it carries on as without an editor:
 * no diagnostics to compare before and after an edit, and no diff tabs. Showing an edit as a diff
 * (openDiff) is declined; Claude Code then keeps to the approval prompt in the terminal.
 */
const TOOLS = [
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
