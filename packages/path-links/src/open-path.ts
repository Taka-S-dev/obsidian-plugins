import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { win32 } from "node:path";
import { shell } from "electron";
import { isRiskyFile } from "./safety.ts";

/**
 * Opens a folder in Explorer or a file with its registered application.
 * Files Windows would execute are opened only after confirmRisky resolves true.
 * Resolves to an error message, "" on success, or null when the user cancelled.
 */
export async function openPath(path: string, confirmRisky: (path: string) => Promise<boolean>): Promise<string | null> {
  let isDirectory = false;
  try {
    isDirectory = (await stat(path)).isDirectory();
  } catch {
    // Unreachable share or missing file: let Windows report it (and prompt for credentials).
  }
  if (!isDirectory) {
    if (isRiskyFile(path) && !(await confirmRisky(path))) return null;
    return shell.openPath(path);
  }
  if (process.platform !== "win32") return shell.openPath(path);

  // Launch Explorer directly so the click's foreground activation carries over to it;
  // shell.openPath opens folders behind the Obsidian window.
  const explorer = win32.join(process.env.SystemRoot || "C:\\Windows", "explorer.exe");
  try {
    await new Promise<void>((resolve, reject) => {
      // Pass the path as one argument; never build a shell command.
      const child = spawn(explorer, [path], { shell: false, windowsHide: false, stdio: "ignore" });
      child.once("error", reject);
      child.once("spawn", () => { child.unref(); resolve(); });
    });
    return "";
  } catch {
    return shell.openPath(path);
  }
}
