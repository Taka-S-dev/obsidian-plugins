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
  closedTab, type DiffRequest, diffRequest, type EditorSelection, lockFile, reply, type RpcMessage, selectionChanged,
} from "./ide-protocol.ts";

const TOKEN_HEADER = "x-claude-code-ide-authorization";

/** Where proposed edits are shown. */
export interface DiffViewer {
  show(request: DiffRequest): void;
  close(tabName: string): void;
}

export class IdeBridge {
  private server: WebSocketServer | null = null;
  private lockPath: string | null = null;
  private port = 0;
  private readonly token = randomBytes(32).toString("hex");
  private readonly clients = new Set<WebSocket>();
  private selection: RpcMessage | null = null;
  /** Diffs on screen, by Claude Code's name for them, with the connection that asked. */
  private readonly diffs = new Map<string, WebSocket>();

  constructor(
    private readonly workspaceFolder: string,
    private readonly version: string,
    private readonly viewer: DiffViewer,
  ) {}

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

  stop(): void {
    for (const tabName of this.diffs.keys()) this.viewer.close(tabName);
    this.diffs.clear();
    for (const socket of this.clients) socket.terminate();
    this.clients.clear();
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
    const gone = () => {
      this.clients.delete(socket);
      for (const [tabName, owner] of this.diffs) if (owner === socket) this.closeDiff(tabName);
    };
    socket.on("close", gone);
    socket.on("error", gone);
    socket.on("message", (data) => {
      let message: RpcMessage;
      try {
        message = JSON.parse(data.toString()) as RpcMessage;
      } catch {
        return;
      }
      // The edit is approved or rejected in the terminal, after which Claude Code closes the diff.
      // The openDiff call is left unanswered: answering it would decide the edit from here.
      const diff = diffRequest(message);
      if (diff) {
        this.diffs.set(diff.tabName, socket);
        this.viewer.show(diff);
        return;
      }
      const closed = closedTab(message);
      if (closed !== null) this.closeDiff(closed);
      if (message.method === "tools/call" && (message.params as { name?: unknown } | undefined)?.name === "closeAllDiffTabs") {
        for (const [tabName, owner] of this.diffs) if (owner === socket) this.closeDiff(tabName);
      }
      const response = reply(message, this.version);
      if (response) this.send(socket, response);
      // Claude Code says it is ready once it has set up the connection.
      if (message.method === "ide_connected" && this.selection) this.send(socket, this.selection);
    });
  }

  private closeDiff(tabName: string): void {
    if (this.diffs.delete(tabName)) this.viewer.close(tabName);
  }

  private send(socket: WebSocket, message: RpcMessage): void {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
  }
}
