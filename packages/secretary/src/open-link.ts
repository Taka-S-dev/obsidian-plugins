import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { win32 } from "node:path";
import { App, ButtonComponent, Keymap, Menu, Modal, Notice, setIcon, setTooltip } from "obsidian";
import type { Strings } from "./i18n.ts";
import { segments, type Segment } from "./links.ts";
import { opensDirectly, shareHost } from "./safety.ts";

/** Servers whose share links have been allowed to open, kept with the plugin's data. */
export interface KnownHosts {
  has(host: string): boolean;
  add(host: string): Promise<void>;
}

type Link = Exclude<Segment, { kind: "text" }>;

const NOTICE_MS = 15_000;
/** An unreachable share can take a while; past this, a notice says it is being opened. */
const SLOW_MS = 1_500;

interface Shell {
  openPath(path: string): Promise<string>;
}

function shell(): Shell {
  return (require("electron") as { shell: Shell }).shell;
}

/**
 * Opens the links in reminders, inbox items and notices: web pages in the browser, notes in
 * Obsidian, folders in Explorer (in front) and files with their application.
 */
export class LinkOpener {
  /** One open at a time, so a double click does not open two Explorer windows. */
  private opening = false;

  constructor(private app: App, private s: Strings, private hosts: KnownHosts) {}

  /**
   * Writes the text into el, with each link as something to click. A click on a link opens it and
   * goes no further, so the row under it is not edited; right-click offers Open and Copy.
   */
  render(el: HTMLElement, text: string): void {
    for (const part of segments(text)) {
      if (part.kind === "text") {
        el.appendText(part.text);
        continue;
      }
      const a = el.createEl("a", { cls: "secretary-link", text: part.text, href: "#" });
      setTooltip(a, this.address(part));
      a.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        void this.open(part, Keymap.isModEvent(event) === "tab");
      });
      a.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.menu(part).showAtMouseEvent(event);
      });
      if (part.kind === "file") {
        // As in a note's file links: the path can be copied without opening it.
        const copy = el.createSpan({ cls: "secretary-link-copy clickable-icon", attr: { "aria-label": this.s.links.copyPath } });
        setIcon(copy, "copy");
        copy.addEventListener("click", (event) => {
          event.stopPropagation();
          void this.copy(part.path, this.s.links.pathCopied);
        });
      }
    }
  }

  private address(link: Link): string {
    return link.kind === "web" ? link.url : link.kind === "file" ? link.path : link.target;
  }

  private menu(link: Link): Menu {
    const t = this.s.links;
    const menu = new Menu();
    menu.addItem((i) => i.setTitle(t.open).setIcon("external-link").onClick(() => void this.open(link, false)));
    if (link.kind === "file") menu.addItem((i) => i.setTitle(t.copyPath).setIcon("copy").onClick(() => void this.copy(link.path, t.pathCopied)));
    if (link.kind === "web") menu.addItem((i) => i.setTitle(t.copyUrl).setIcon("copy").onClick(() => void this.copy(link.url, t.urlCopied)));
    return menu;
  }

  async open(link: Link, newTab: boolean): Promise<void> {
    if (link.kind === "web") {
      window.open(link.url);
      return;
    }
    if (link.kind === "note") {
      await this.app.workspace.openLinkText(link.target, "", newTab);
      return;
    }
    if (this.opening) return;
    this.opening = true;
    let notice: Notice | null = null;
    const slow = window.setTimeout(() => (notice = new Notice(this.s.links.opening(link.path), 0)), SLOW_MS);
    try {
      const error = await this.openPath(link.path);
      if (error) new Notice(this.s.links.openFailed(link.path, error), NOTICE_MS);
    } catch (e) {
      new Notice(this.s.links.openFailed(link.path, String(e)), NOTICE_MS);
    } finally {
      window.clearTimeout(slow);
      (notice as Notice | null)?.hide();
      this.opening = false;
    }
  }

  /**
   * A folder in Explorer, a file with its application. A server not opened before, and a file that
   * is not a known kind of document, are opened only once confirmed. Resolves to an error message,
   * or "" when it opened or was cancelled.
   */
  private async openPath(path: string): Promise<string> {
    // Asked before anything touches the path: even reading whether it is a folder signs in to the
    // server with the Windows account.
    const host = shareHost(path);
    if (host !== null && !this.hosts.has(host)) {
      const c = this.s.links.confirmHost;
      if (!(await confirmOpen(this.app, { title: c.title(host), body: c.body, detail: path, cancel: c.cancel, open: c.open }))) return "";
      await this.hosts.add(host);
    }
    let isDirectory = false;
    try {
      isDirectory = (await stat(path)).isDirectory();
    } catch {
      // Unreachable share or missing file: Windows reports it (and asks for credentials).
    }
    if (!isDirectory) {
      const c = this.s.links.confirm;
      if (!opensDirectly(path) && !(await confirmOpen(this.app, { title: c.title, body: c.body, detail: path, cancel: c.cancel, open: c.open }))) return "";
      return shell().openPath(path);
    }
    if (process.platform !== "win32") return shell().openPath(path);
    // Explorer started directly comes to the front; the system's default opens it behind Obsidian.
    const explorer = win32.join(process.env.SystemRoot || "C:\\Windows", "explorer.exe");
    try {
      await new Promise<void>((resolve, reject) => {
        // The path is one argument; no shell command is built.
        const child = spawn(explorer, [path], { shell: false, windowsHide: false, stdio: "ignore" });
        child.once("error", reject);
        child.once("spawn", () => {
          child.unref();
          resolve();
        });
      });
      return "";
    } catch {
      return shell().openPath(path);
    }
  }

  private async copy(text: string, done: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      new Notice(done);
    } catch (e) {
      new Notice(this.s.links.copyFailed(String(e)), NOTICE_MS);
    }
  }
}

interface ConfirmText {
  title: string;
  body: string;
  /** The path, shown as it is. */
  detail: string;
  cancel: string;
  open: string;
}

/** Asks before a link is opened; Cancel is the default, and closing the dialog cancels too. */
class ConfirmOpen extends Modal {
  private decided = false;

  constructor(app: App, private t: ConfirmText, private resolve: (ok: boolean) => void) {
    super(app);
  }

  onOpen(): void {
    const t = this.t;
    this.titleEl.setText(t.title);
    this.contentEl.createEl("p", { text: t.body });
    this.contentEl.createEl("code", { text: t.detail, cls: "secretary-confirm-path" });
    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    const cancel = new ButtonComponent(buttons).setButtonText(t.cancel).setCta().onClick(() => this.finish(false));
    new ButtonComponent(buttons).setButtonText(t.open).setWarning().onClick(() => this.finish(true));
    // Enter must not run the file by accident.
    window.setTimeout(() => cancel.buttonEl.focus(), 0);
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.decided) this.resolve(false);
  }

  private finish(ok: boolean): void {
    this.decided = true;
    this.resolve(ok);
    this.close();
  }
}

function confirmOpen(app: App, t: ConfirmText): Promise<boolean> {
  return new Promise((resolve) => new ConfirmOpen(app, t, resolve).open());
}
