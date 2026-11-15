// Lets Claude Code started in the terminal see the note open in Obsidian, the way the VS Code
// extension does: a WebSocket server on localhost, announced by a lock file in ~/.claude/ide that
// carries a token, which Claude Code finds through CLAUDE_CODE_SSE_PORT.
import { randomBytes } from "node:crypto";
import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import { type WebSocket, WebSocketServer } from "ws";
import {
  atMentioned, closedTab, parseRpc, diffDecision, type DiffRequest, diffRequest, type EditorSelection, type Mention, lockFile, reply, type RpcMessage, selectionChanged,
} from "./ide-protocol.ts";

const TOKEN_HEADER = "x-claude-code-ide-authorization";

/** When the selection goes to a newly connected Claude Code session, in ms after it says it is connected. */
const RESEND_SELECTION_MS = [0, 1000, 3000];

let diffSerial = 0;

/**
 * A key for one diff request, unique for the plugin's lifetime. The assistant's own name for a diff
 * is only shown: two sessions could use the same one, and a stale button must not decide a newer
 * request that reuses it.
 */
export function newDiffKey(): string {
  return `diff-${++diffSerial}`;
}

/** Where proposed edits are shown, by a key from newDiffKey. */
export interface DiffViewer {
  /**
   * `assistant` names the program that proposes the edit. `decide` approves or rejects it from
   * Obsidian; the edit can also be decided in the terminal, after which the diff is closed.
   */
  show(key: string, request: DiffRequest, assistant: string, decide: (approve: boolean) => void): void;
  close(key: string): void;
}

/** A connection a terminal assistant uses to see what is open in Obsidian. */
export interface AssistantBridge {
  /** The assistant's name, such as Claude Code. */
  readonly name: string;
  /** Whether a session of the assistant is connected now. */
  connected(): boolean;
  /** Starts listening and announces the connection. Rejects if either fails. */
  start(): Promise<void>;
  stop(): void;
  /** Variables for programs started in the terminal. */
  environment(): Record<string, string>;
  setSelection(selection: EditorSelection): void;
  /** Adds a file, or lines of it, to the prompt being typed in each connected session. */
  mention(mention: Mention): void;
}

export class IdeBridge implements AssistantBridge {
  readonly name = "Claude Code";
  private server: WebSocketServer | null = null;
  private lockPath: string | null = null;
  private port = 0;
  private readonly token = randomBytes(32).toString("hex");
  private readonly clients = new Set<WebSocket>();
  private selection: RpcMessage | null = null;
  /** Diffs on screen, by key, with the connection and openDiff call that asked. */
  private readonly diffs = new Map<string, { socket: WebSocket; id: string | number; request: DiffRequest }>();

  private readonly workspaceFolder: string;
  private readonly version: string;
  private readonly viewer: DiffViewer;
  /** Called when a session connects or disconnects. */
  private readonly onConnections: () => void;

  // Fields are assigned here rather than declared as parameters, so tests run the file as it is.
  constructor(workspaceFolder: string, version: string, viewer: DiffViewer, onConnections: () => void) {
    this.workspaceFolder = workspaceFolder;
    this.version = version;
    this.viewer = viewer;
    this.onConnections = onConnections;
  }

  connected(): boolean { return this.clients.size > 0; }

  /** Listens on a free port on localhost and writes the lock file. Rejects if either fails. */
  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = new WebSocketServer({
        host: "127.0.0.1",
        port: 0,
        handleProtocols: (protocols) => (protocols.has("mcp") ? "mcp" : false),
        verifyClient: ({ req }: { req: IncomingMessage }) => req.headers[TOKEN_HEADER] === this.token,
      });
      server.once("error", reject);
      server.once("listening", () => {
        try {
          const address = server.address();
          if (typeof address !== "object" || address === null) throw new Error("no port");
          this.port = address.port;
          this.writeLock();
          resolve();
        } catch (error) {
          server.close();
          reject(error);
        }
      });
      server.on("connection", (socket) => this.accept(socket));
      this.server = server;
    });
  }

  /** Variables for programs started in the terminal, so Claude Code connects without /ide. */
  environment(): Record<string, string> {
    return this.port ? { CLAUDE_CODE_SSE_PORT: String(this.port) } : {};
  }

  /** Tells connected Claude Code sessions what is open; repeated for sessions that connect later. */
  setSelection(selection: EditorSelection): void {
    const message = selectionChanged(selection);
    if (JSON.stringify(message) === JSON.stringify(this.selection)) return;
    this.selection = message;
    for (const socket of this.clients) this.send(socket, message);
  }

  mention(mention: Mention): void {
    const message = atMentioned(mention);
    for (const socket of this.clients) this.send(socket, message);
  }

  stop(): void {
    for (const key of this.diffs.keys()) this.viewer.close(key);
    this.diffs.clear();
    for (const socket of this.clients) socket.terminate();
    this.clients.clear();
    this.onConnections();
    this.server?.close();
    this.server = null;
    this.port = 0;
    if (this.lockPath) {
      try {
        unlinkSync(this.lockPath);
      } catch {
        // Already gone: Claude Code removes lock files whose process has ended.
      }
      this.lockPath = null;
    }
  }

  private writeLock(): void {
    const dir = join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"), "ide");
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `${this.port}.lock`);
    const content = lockFile(process.pid, this.workspaceFolder, this.token, process.platform === "win32");
    // Only this user can read the token.
    writeFileSync(path, JSON.stringify(content), { encoding: "utf-8", mode: 0o600 });
    this.lockPath = path;
  }

  private accept(socket: WebSocket): void {
    this.clients.add(socket);
    this.onConnections();
    const gone = () => {
      if (this.clients.delete(socket)) this.onConnections();
      for (const [key, diff] of this.diffs) if (diff.socket === socket) this.closeDiff(key);
    };
    socket.on("close", gone);
    socket.on("error", gone);
    socket.on("message", (data) => {
      const message = parseRpc(data.toString());
      if (!message) return;
      // The openDiff call is answered only when the edit is decided in Obsidian. Decided in the
      // terminal instead, Claude Code closes the diff with close_tab.
      const diff = diffRequest(message);
      if (diff && message.id !== undefined && message.id !== null) {
        // The same name again from the same session replaces its earlier diff.
        const earlier = this.keyOf(socket, diff.tabName);
        if (earlier) this.closeDiff(earlier);
        const key = newDiffKey();
        this.diffs.set(key, { socket, id: message.id, request: diff });
        this.viewer.show(key, diff, "Claude Code", (approve) => this.decide(key, approve));
        return;
      }
      const closed = closedTab(message);
      const closedKey = closed === null ? undefined : this.keyOf(socket, closed);
      if (closedKey) this.closeDiff(closedKey);
      if (message.method === "tools/call" && (message.params as { name?: unknown } | undefined)?.name === "closeAllDiffTabs") {
        for (const [key, diff] of this.diffs) if (diff.socket === socket) this.closeDiff(key);
      }
      const response = reply(message, this.version);
      if (response) this.send(socket, response);
      // Claude Code says it is connected before its prompt listens for the selection, which drops
      // one sent at once; it is sent again shortly after, so the open note shows without a change.
      if (message.method === "ide_connected") {
        for (const delay of RESEND_SELECTION_MS) {
          setTimeout(() => {
            if (this.selection && this.clients.has(socket)) this.send(socket, this.selection);
          }, delay);
        }
      }
    });
  }

  /** The diff a session knows by this name. */
  private keyOf(socket: WebSocket, tabName: string): string | undefined {
    for (const [key, diff] of this.diffs) if (diff.socket === socket && diff.request.tabName === tabName) return key;
    return undefined;
  }

  private decide(key: string, approve: boolean): void {
    const diff = this.diffs.get(key);
    if (!diff) return;
    this.send(diff.socket, diffDecision(diff.id, diff.request, approve));
    this.closeDiff(key);
  }

  private closeDiff(key: string): void {
    if (this.diffs.delete(key)) this.viewer.close(key);
  }

  private send(socket: WebSocket, message: RpcMessage): void {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
  }
}
