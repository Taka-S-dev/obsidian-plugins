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
import { type AssistantBridge, type DiffViewer, newDiffKey } from "./ide-bridge.ts";
import { type EditorSelection, type Mention, parseRpc, type RpcMessage, selectionChanged } from "./ide-protocol.ts";

/** A larger request is refused: an edit to a note is far smaller. */
const MAX_BODY = 32 * 1024 * 1024;

interface PendingDiff {
  /** The session that asked, from its Mcp-Session-Id header. */
  session: string | undefined;
  tabName: string;
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
  /** open_diff calls left open while their diff is on screen, by key. */
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
    for (const key of [...this.diffs.keys()]) this.endDiff(key);
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
      const message = parseRpc(Buffer.concat(chunks).toString("utf-8"));
      if (!message) return this.status(response, 400);
      const session = request.headers["mcp-session-id"];
      this.receive(message, response, typeof session === "string" ? session : undefined);
    });
  }

  private receive(message: RpcMessage, response: ServerResponse, session: string | undefined): void {
    const diff = copilotDiffRequest(message);
    if (diff && message.id !== undefined && message.id !== null) {
      // Answered when the edit is decided in Obsidian, or when Copilot CLI closes the diff after it
      // was decided in the terminal.
      // The same name again from the same session replaces its earlier diff.
      const earlier = this.keyOf(session, diff.tabName);
      if (earlier) this.endDiff(earlier);
      const key = newDiffKey();
      this.diffs.set(key, { session, tabName: diff.tabName, id: message.id, response });
      response.on("close", () => {
        if (this.diffs.delete(key)) this.viewer.close(key);
      });
      this.viewer.show(key, diff, "Copilot CLI", (approve) => this.decide(key, approve));
      return;
    }
    const closed = copilotClosedDiff(message);
    if (closed !== null) {
      const key = this.keyOf(session, closed);
      const wasOpen = key !== undefined && this.endDiff(key);
      return this.json(response, { jsonrpc: "2.0", id: message.id, result: closeDiffResult(closed, wasOpen) });
    }
    const reply = copilotReply(message, this.version, this.selection && selectionChanged(this.selection).params);
    if (!reply) return this.status(response, 202);
    const headers: Record<string, string> = message.method === "initialize" ? { "Mcp-Session-Id": randomUUID() } : {};
    this.json(response, reply, headers);
  }

  /** The diff a session knows by this name. */
  private keyOf(session: string | undefined, tabName: string): string | undefined {
    for (const [key, diff] of this.diffs) if (diff.session === session && diff.tabName === tabName) return key;
    return undefined;
  }

  /** Closes a diff and answers its open_diff call without deciding the edit. */
  private endDiff(key: string): boolean {
    return this.answerDiff(key, DIFF_CLOSED_RESULT);
  }

  private decide(key: string, approve: boolean): void {
    this.answerDiff(key, diffDecisionResult(approve));
  }

  private answerDiff(key: string, result: unknown): boolean {
    const pending = this.diffs.get(key);
    if (!pending) return false;
    this.diffs.delete(key);
    this.viewer.close(key);
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
