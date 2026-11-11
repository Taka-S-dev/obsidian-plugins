// Runs under Node.js, one process per terminal, started by the plugin with its stdin and stdout
// as the message channel (see protocol.ts). node-pty cannot run inside Obsidian itself: on
// Windows it reads the console output on a worker thread, and Obsidian's renderer cannot start
// Node workers.
import { spawn, type IPty } from "node-pty";
import { encode, LineDecoder, parse, type FromHost, type ToHost } from "./protocol.ts";

let term: IPty | undefined;
let pending = "";
let flushTimer: NodeJS.Timeout | undefined;

function send(message: FromHost, then?: () => void): void {
  process.stdout.write(encode(message), then);
}

/** Output arrives in many small pieces; sending them together keeps the message count down. */
function flush(): void {
  flushTimer = undefined;
  if (pending === "") return;
  send({ t: "output", data: pending });
  pending = "";
}

function quit(code: number): void {
  flush();
  process.stdout.write("", () => process.exit(code));
}

function handle(message: ToHost): void {
  switch (message.t) {
    case "spawn": {
      if (term) return;
      try {
        term = spawn(message.file, message.args, {
          name: "xterm-256color",
          cols: message.cols,
          rows: message.rows,
          cwd: message.cwd,
          env: message.env,
          useConptyDll: message.useConptyDll,
        });
      } catch (error) {
        send({ t: "error", message: error instanceof Error ? error.message : String(error) }, () => process.exit(1));
        return;
      }
      send({ t: "ready", pid: term.pid });
      term.onData((data) => {
        pending += data;
        flushTimer ??= setTimeout(flush, 4);
      });
      term.onExit(({ exitCode }) => {
        flush();
        send({ t: "exit", code: exitCode }, () => process.exit(0));
      });
      return;
    }
    case "input":
      term?.write(message.data);
      return;
    case "resize":
      if (Number.isInteger(message.cols) && Number.isInteger(message.rows) && message.cols > 0 && message.rows > 0) {
        term?.resize(message.cols, message.rows);
      }
      return;
    case "pause":
      term?.pause();
      return;
    case "resume":
      term?.resume();
      return;
    case "kill":
      shutDown();
      return;
  }
}

/** Ends the program; if it does not report its exit soon, the host leaves anyway. */
function shutDown(): void {
  if (!term) return quit(0);
  try { term.kill(); } catch { /* already gone */ }
  setTimeout(() => quit(0), 2000).unref();
}

const decoder = new LineDecoder();
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  for (const line of decoder.push(chunk)) {
    const message = parse<ToHost>(line);
    if (message) handle(message);
  }
});
// The plugin closes stdin when the terminal closes, and the system closes it if Obsidian exits,
// so the program never outlives Obsidian.
process.stdin.on("end", shutDown);
process.on("uncaughtException", (error) => {
  send({ t: "error", message: error.message }, () => process.exit(1));
});
