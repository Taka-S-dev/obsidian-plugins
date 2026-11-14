// Lets GitHub Copilot CLI started in the vault folder see the note open in Obsidian and show the
// edits it proposes, the way the VS Code extension does: MCP over HTTP on a named pipe, announced
// by a lock file in ~/.copilot/ide that carries a nonce. Copilot CLI connects to a lock file whose
// workspace folder holds the folder it runs in.
import { randomUUID } from "node:crypto";
import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
  closeDiffResult, copilotClosedDiff, copilotDiffRequest, copilotLock, copilotReply, DIFF_CLOSED_RESULT, diffDecisionResult, fileReference,
} from "./copilot-protocol.ts";
import type { AssistantBridge, DiffViewer } from "./ide-bridge.ts";
import { type EditorSelection, type Mention, type RpcMessage, selectionChanged } from "./ide-protocol.ts";

/** A larger request is refused: an edit to a note is far smaller. */
const MAX_BODY = 32 * 1024 * 1024;

interface PendingDiff {
  id: string | number;
  response: ServerResponse;
}

export class CopilotBridge implements AssistantBridge {
  readonly name = "Copilot CLI";
  private server: Server | null = null;
  private lockPath: string | null = null;
  private readonly nonce = randomUUID();
  /** Event streams Copilot CLI keeps open for notifications such as selection_changed. */
  private readonly streams = new Set<ServerResponse>();
  private selection: EditorSelection | null = null;
  /** open_diff calls left open while their diff is on screen, by Copilot CLI's name for the diff. */
  private readonly diffs = new Map<string, PendingDiff>();

  constructor(
    private readonly workspaceFolder: string,
    private readonly version: string,
    private readonly viewer: DiffViewer,
    /** Called when a session connects or disconnects. */
    private readonly onConnections: () => void,
  ) {}

  /** A connected session keeps an event stream open. */
  connected(): boolean { return this.streams.size > 0; }

  start(): Promise<void> {
    const pipe = process.platform === "win32"
      ? `\\\\.\\pipe\\mcp-${randomUUID()}.sock`
      : join(tmpdir(), `mcp-${randomUUID()}.sock`);
    return new Promise((resolve, reject) => {
      const server = createServer((request, response) => this.handle(request, response));
      // An open_diff call waits for as long as the edit is undecided.
      server.requestTimeout = 0;
      server.once("error", reject);
      server.listen(pipe, () => {
        try {
          this.writeLock(pipe);
          resolve();
        } catch (error) {
          server.close();
          reject(error);
        }
      });
      this.server = server;
    });
  }

  /** Copilot CLI finds the lock file by folder, so programs need nothing extra. */
  environment(): Record<string, string> { return {}; }

  setSelection(selection: EditorSelection): void {
    this.selection = selection;
    const message = selectionChanged(selection);
    for (const stream of this.streams) this.event(stream, message);
  }

  mention(mention: Mention): void {
    const message = fileReference(mention);
    for (const stream of this.streams) this.event(stream, message);
  }

  stop(): void {
    for (const tabName of [...this.diffs.keys()]) this.endDiff(tabName);
    for (const stream of this.streams) stream.end();
    this.streams.clear();
    this.onConnections();
    this.server?.close();
    this.server = null;
    if (this.lockPath) {
      try {
        unlinkSync(this.lockPath);
      } catch {
        // Already gone.
      }
      this.lockPath = null;
    }
  }

  private writeLock(pipe: string): void {
    const dir = join(process.env.COPILOT_HOME || join(homedir(), ".copilot"), "ide");
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `${randomUUID()}.lock`);
    const content = copilotLock(pipe, this.nonce, process.pid, this.workspaceFolder, Date.now());
    writeFileSync(path, JSON.stringify(content), { encoding: "utf-8", mode: 0o600 });
    this.lockPath = path;
  }

  private handle(request: IncomingMessage, response: ServerResponse): void {
    if (request.headers.authorization !== `Nonce ${this.nonce}`) return this.status(response, 401);
    if (!request.url?.startsWith("/mcp")) return this.status(response, 404);
    if (request.method === "GET") return this.openStream(response);
    if (request.method === "DELETE") return this.status(response, 200);
    if (request.method !== "POST") return this.status(response, 405);

    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) request.destroy();
      else chunks.push(chunk);
    });
    request.on("end", () => {
      let message: RpcMessage;
      try {
        message = JSON.parse(Buffer.concat(chunks).toString("utf-8")) as RpcMessage;
      } catch {
        return this.status(response, 400);
      }
      this.receive(message, response);
    });
  }

  private receive(message: RpcMessage, response: ServerResponse): void {
    const diff = copilotDiffRequest(message);
    if (diff && message.id !== undefined && message.id !== null) {
      // Answered when the edit is decided in Obsidian, or when Copilot CLI closes the diff after it
      // was decided in the terminal.
      this.endDiff(diff.tabName);
      this.diffs.set(diff.tabName, { id: message.id, response });
      response.on("close", () => {
        if (this.diffs.get(diff.tabName)?.response === response) {
          this.diffs.delete(diff.tabName);
          this.viewer.close(diff.tabName);
        }
      });
      this.viewer.show(diff, "Copilot CLI", (approve) => this.decide(diff.tabName, approve));
      return;
    }
    const closed = copilotClosedDiff(message);
    if (closed !== null) {
      const wasOpen = this.endDiff(closed);
      return this.json(response, { jsonrpc: "2.0", id: message.id, result: closeDiffResult(closed, wasOpen) });
    }
    const reply = copilotReply(message, this.version, this.selection && selectionChanged(this.selection).params);
    if (!reply) return this.status(response, 202);
    const headers: Record<string, string> = message.method === "initialize" ? { "Mcp-Session-Id": randomUUID() } : {};
    this.json(response, reply, headers);
  }

  /** Closes a diff and answers its open_diff call without deciding the edit. */
  private endDiff(tabName: string): boolean {
    return this.answerDiff(tabName, DIFF_CLOSED_RESULT);
  }

  private decide(tabName: string, approve: boolean): void {
    this.answerDiff(tabName, diffDecisionResult(approve));
  }

  private answerDiff(tabName: string, result: unknown): boolean {
    const pending = this.diffs.get(tabName);
    if (!pending) return false;
    this.diffs.delete(tabName);
    this.viewer.close(tabName);
    if (!pending.response.writableEnded) this.json(pending.response, { jsonrpc: "2.0", id: pending.id, result });
    return true;
  }

  private openStream(response: ServerResponse): void {
    response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    response.flushHeaders();
    this.streams.add(response);
    this.onConnections();
    response.on("close", () => {
      if (this.streams.delete(response)) this.onConnections();
    });
    if (this.selection) this.event(response, selectionChanged(this.selection));
  }

  private event(stream: ServerResponse, message: RpcMessage): void {
    if (!stream.writableEnded) stream.write(`event: message\ndata: ${JSON.stringify(message)}\n\n`);
  }

  private json(response: ServerResponse, body: unknown, headers: Record<string, string> = {}): void {
    response.writeHead(200, { "Content-Type": "application/json", ...headers });
    response.end(JSON.stringify(body));
  }

  private status(response: ServerResponse, code: number): void {
    response.writeHead(code);
    response.end();
  }
}
