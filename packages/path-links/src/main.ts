import { getLanguage, MarkdownRenderChild, Notice, Plugin, setIcon } from "obsidian";
import { clipboard } from "electron";
import { confirmRiskyOpen } from "./confirm.ts";
import { stringsFor, type Strings } from "./i18n.ts";
import { buildLinks } from "./links.ts";
import { copyButtons, fileLinkTarget } from "./live-preview.ts";
import { openPath } from "./open-path.ts";
import { filePath, InputError, insertion, parseEntries } from "./paths.ts";

/** Message for a caught error in the user's language. */
function describe(error: unknown, s: Strings): string {
  if (error instanceof InputError) return s.inputErrors[error.code];
  return error instanceof Error ? error.message : String(error);
}

class PathLinksBlock extends MarkdownRenderChild {
  constructor(
    container: HTMLElement,
    private source: string,
    private s: Strings,
    private open: (path: string) => Promise<void>,
  ) {
    super(container);
  }

  onload(): void {
    const { s } = this;
    this.containerEl.empty();
    this.containerEl.addClass("path-links-container");
    let paths: { path: string; label: string }[];
    try { paths = parseEntries(this.source); }
    catch (error) {
      this.containerEl.createEl("div", { text: describe(error, s), cls: "path-links-error" });
      this.containerEl.createEl("pre", { text: this.source });
      return;
    }
    for (const { path, label } of paths) {
      const row = this.containerEl.createDiv({ cls: "path-links-row" });
      const icon = row.createSpan({ cls: "path-links-icon" });
      setIcon(icon, "folder-open");
      icon.setAttribute("aria-hidden", "true");
      // Buttons avoid Markdown/URL normalization entirely; pass the raw path to Windows.
      const open = row.createEl("button", { text: label, cls: "path-links-open" });
      open.type = "button";
      open.title = s.openTitle(path);
      this.registerDomEvent(open, "click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        open.disabled = true;
        try { await this.open(path); }
        finally { open.disabled = false; }
      });
      const copy = row.createEl("button", { text: s.copy, cls: "path-links-copy" });
      copy.type = "button";
      copy.title = s.copyTitle;
      copy.setAttribute("aria-label", s.copyPathLabel(path));
      copy.setAttribute("aria-live", "polite");
      let timer: ReturnType<typeof setTimeout> | undefined;
      this.register(() => { if (timer) clearTimeout(timer); });
      this.registerDomEvent(copy, "click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        try {
          clipboard.writeText(path);
          copy.textContent = s.copied;
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => { copy.textContent = s.copy; }, 1400);
        } catch (error) { new Notice(s.copyFailed(String(error))); }
      });
    }
  }
}

export default class PathLinksPlugin extends Plugin {
  private s: Strings = stringsFor("en");

  onload(): void {
    const s = (this.s = stringsFor(getLanguage()));
    const copyPath = (path: string) => this.copyPath(path);

    this.registerMarkdownCodeBlockProcessor("path-links", (source, el, ctx) => {
      ctx.addChild(new PathLinksBlock(el, source, s, (path) => this.openAndReport(path)));
    });
    this.registerMarkdownPostProcessor((el, ctx) => {
      for (const link of Array.from(el.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
        const path = filePath(link.getAttribute("href") ?? "");
        if (!path || link.closest(".path-links-inline")) continue;
        const wrapper = document.createElement("span");
        wrapper.className = "path-links-inline";
        link.replaceWith(wrapper);
        wrapper.appendChild(link);
        const child = new MarkdownRenderChild(wrapper);
        ctx.addChild(child);
        child.registerDomEvent(link, "click", event => {
          event.preventDefault();
          event.stopPropagation();
          void this.openAndReport(path);
        });
        const label = s.copyPathLabel(path);
        const copy = wrapper.createEl("button", { cls: "path-links-inline-copy", attr: { title: label, "aria-label": label } });
        setIcon(copy, "copy");
        child.registerDomEvent(copy, "click", event => {
          event.preventDefault();
          event.stopPropagation();
          copyPath(path);
        });
      }
    });

    // Live Preview: same copy button and foreground Explorer as in Reading view.
    this.registerEditorExtension(copyButtons(copyPath, s.copyPathLabel));
    // Capture phase, so Obsidian's own link handling (which opens folders behind the window) never runs.
    const interceptLinkClick = (event: MouseEvent) => {
      if (event.button !== 0 || !(event.target instanceof HTMLElement)) return;
      const path = fileLinkTarget(event.target);
      if (path === null) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.type === "click") void this.openAndReport(path);
    };
    this.registerDomEvent(document, "mousedown", interceptLinkClick, { capture: true });
    this.registerDomEvent(document, "click", interceptLinkClick, { capture: true });

    this.addCommand({
      id: "paste-path-links",
      name: s.pasteCommand,
      editorCallback: (editor) => {
        try {
          const { text, multiline } = buildLinks(clipboard.readText(), editor.getSelection());
          if (!multiline) {
            editor.replaceSelection(text);
            return;
          }
          const from = editor.getCursor("from");
          const to = editor.getCursor("to");
          const before = editor.getLine(from.line).slice(0, from.ch);
          const after = editor.getLine(to.line).slice(to.ch);
          editor.replaceSelection(insertion(text, before, after));
        } catch (error) { new Notice(describe(error, s)); }
      }
    });
  }

  /** Every open goes through here, so files Windows would execute always ask first. */
  private async openAndReport(path: string): Promise<void> {
    try {
      const error = await openPath(path, (p) => confirmRiskyOpen(this.app, p, this.s));
      if (error) new Notice(this.s.openFailed(path, error), 8000);
    } catch (error) { new Notice(this.s.openFailed(path, String(error)), 8000); }
  }

  private copyPath(path: string): void {
    try { clipboard.writeText(path); new Notice(this.s.pathCopied, 1400); }
    catch (error) { new Notice(this.s.copyFailed(String(error))); }
  }
}
