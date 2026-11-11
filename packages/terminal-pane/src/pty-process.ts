// The plugin's side of one pty host process (see pty-host.ts).
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { encode, LineDecoder, parse, type FromHost, type SpawnRequest, type ToHost } from "./protocol.ts";

export type StartError = { kind: "node"; message: string } | { kind: "host"; message: string };

export interface PtyEvents {
  output(data: string): void;
  exit(code: number): void;
  error(error: StartError): void;
}

export class PtyProcess {
  private readonly child: ChildProcessWithoutNullStreams;
  private done = false;
  private stderr = "";
  private killTimer: number | undefined;

  constructor(nodePath: string, hostScript: string, request: SpawnRequest, private events: PtyEvents) {
    this.child = spawn(nodePath, [hostScript], { windowsHide: true, stdio: "pipe" });
    const decoder = new LineDecoder();
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => {
      for (const line of decoder.push(chunk)) {
        const message = parse<FromHost>(line);
        if (message) this.receive(message);
      }
    });
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk: string) => { this.stderr = (this.stderr + chunk).slice(-2000); });
    // Writes after the host has gone fail with EPIPE; the close handler reports what happened.
    this.child.stdin.on("error", () => {});
    this.child.on("error", (error: NodeJS.ErrnoException) => {
      this.finish(() => this.events.error({ kind: error.code === "ENOENT" ? "node" : "host", message: error.message }));
    });
    // "close" rather than "exit": it fires only after stdout has been read to the end.
    this.child.on("close", (code) => {
      if (this.killTimer !== undefined) window.clearTimeout(this.killTimer);
      this.finish(() => this.events.error({ kind: "host", message: this.stderr.trim() || `pty host exited with code ${code}` }));
    });
    this.send(request);
  }

  write(data: string): void { this.send({ t: "input", data }); }
  resize(cols: number, rows: number): void { this.send({ t: "resize", cols, rows }); }
  pause(): void { this.send({ t: "pause" }); }
  resume(): void { this.send({ t: "resume" }); }

  /** Stops the program and the host. No events are delivered afterwards. */
  kill(): void {
    if (this.done) return;
    this.done = true;
    this.send({ t: "kill" }, true);
    this.child.stdin.end();
    this.killTimer = window.setTimeout(() => this.child.kill(), 3000);
  }

  private receive(message: FromHost): void {
    if (this.done) return;
    switch (message.t) {
      case "output": this.events.output(message.data); return;
      case "exit": this.finish(() => this.events.exit(message.code)); return;
      case "error": this.finish(() => this.events.error({ kind: "host", message: message.message })); return;
      case "ready": return;
    }
  }

  private finish(report: () => void): void {
    if (this.done) return;
    this.done = true;
    report();
  }

  private send(message: ToHost, evenIfDone = false): void {
    if ((this.done && !evenIfDone) || !this.child.stdin.writable) return;
    this.child.stdin.write(encode(message));
  }
}
