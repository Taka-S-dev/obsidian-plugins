import { getLanguage, MarkdownRenderChild, Notice, Plugin, setIcon } from "obsidian";
import { clipboard } from "electron";
import { confirmRiskyOpen } from "./confirm.ts";
import { stringsFor, type Strings } from "./i18n.ts";
import { buildLinks } from "./links.ts";
import { copyButtons, fileLinkTarget, showSpinner, spinners } from "./live-preview.ts";
import { openPath } from "./open-path.ts";
import { filePath, frontmatterEnd, InputError, insertion, parseEntries } from "./paths.ts";

/**
 * The file:// target of a property link (Properties panel or Bases), or null.
 * Obsidian renders these as a div carrying the URL in data-href rather than as an <a>.
 */
function propertyLinkTarget(target: HTMLElement): string | null {
  const link = target.closest(".metadata-link-inner.external-link");
  const href = link?.getAttribute("data-href");
  return href ? filePath(href) : null;
}

/**
 * Spinner on a clicked link until the returned function runs. Live Preview links get an editor
 * widget instead of a class, since the editor reverts class changes on the links it renders.
 */
function spinnerOn(el: HTMLElement): () => void {
  const stop = showSpinner(el);
  if (stop) return stop;
  el.addClass("path-links-opening");
  return () => el.removeClass("path-links-opening");
}

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
    private open: (path: string, button: HTMLElement) => Promise<void>,
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
        try { await this.open(path, open); }
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
  private opening = new Set<string>();

  onload(): void {
    const s = (this.s = stringsFor(getLanguage()));
    const copyPath = (path: string) => this.copyPath(path);

    this.registerMarkdownCodeBlockProcessor("path-links", (source, el, ctx) => {
      ctx.addChild(new PathLinksBlock(el, source, s, (path, button) => this.openAndReport(path, button)));
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
          void this.openAndReport(path, link);
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
    this.registerEditorExtension([copyButtons(copyPath, s.copyPathLabel), spinners]);
    // Capture phase, so Obsidian's own link handling (which opens folders behind the window and
    // skips the executable check) never runs. Covers Live Preview links and property links,
    // which Obsidian renders the same way in the Properties panel and in Bases.
    const interceptLinkClick = (event: MouseEvent) => {
      if (event.button !== 0 || !(event.target instanceof HTMLElement)) return;
      const path = fileLinkTarget(event.target) ?? propertyLinkTarget(event.target);
      if (path === null) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.type !== "click") return;
      const link = event.target.closest<HTMLElement>(".cm-link, .metadata-link-inner") ?? undefined;
      void this.openAndReport(path, link);
    };
    this.registerDomEvent(document, "mousedown", interceptLinkClick, { capture: true });
    this.registerDomEvent(document, "click", interceptLinkClick, { capture: true });

    // Right-click menu on any external link: body, Properties panel and Bases alike.
    this.registerEvent(
      this.app.workspace.on("url-menu", (menu, url) => {
        const path = filePath(url);
        if (path === null) return;
        menu.addItem((item) => item.setTitle(s.menuCopyPath).setIcon("copy").onClick(() => copyPath(path)));
      }),
    );

    this.addCommand({
      id: "paste-path-links",
      name: s.pasteCommand,
      editorCallback: (editor) => {
        try {
          // A freshly opened note keeps its cursor at the very top, hidden behind the Properties
          // panel in Live Preview. Writing there would break the frontmatter, so put the links
          // on their own line right below it instead.
          const end = frontmatterEnd(editor.lineCount(), (line) => editor.getLine(line));
          if (end >= 0 && editor.getCursor("from").line <= end) {
            const { text } = buildLinks(clipboard.readText());
            const line = end + 1;
            if (line < editor.lineCount()) editor.replaceRange(insertion(text, "", editor.getLine(line)), { line, ch: 0 });
            else editor.replaceRange(`\n${text}`, { line: end, ch: editor.getLine(end).length });
            const added = text.split("\n");
            editor.setCursor({ line: line + added.length - 1, ch: added[added.length - 1].length });
            new Notice(s.pastedBelowProperties);
            return;
          }
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

  /**
   * Every open goes through here, so files Windows would execute always ask first.
   * Repeat clicks on a path that is still opening are ignored, and the clicked element
   * shows a spinner meanwhile; an unreachable share can take many seconds to answer.
   * Cancelling the confirmation or failing to open releases the link at once.
   */
  private async openAndReport(path: string, el?: HTMLElement): Promise<void> {
    if (this.opening.has(path)) return;
    this.opening.add(path);
    const stopSpinner = el ? spinnerOn(el) : () => {};
    let notice: Notice | undefined;
    const slow = window.setTimeout(() => { notice = new Notice(this.s.opening(path), 0); }, 1500);
    let launched = false;
    try {
      const error = await openPath(path, (p) => confirmRiskyOpen(this.app, p, this.s));
      if (error) new Notice(this.s.openFailed(path, error), 8000);
      launched = error === "";
    } catch (error) { new Notice(this.s.openFailed(path, String(error)), 8000); }
    finally {
      window.clearTimeout(slow);
      notice?.hide();
      // Explorer shows its window a moment after it starts. Until then keep the spinner and
      // ignore clicks, or the spinner flashes unseen and a click in that gap opens a second window.
      const settle = () => { stopSpinner(); this.opening.delete(path); };
      if (launched) window.setTimeout(settle, 1000);
      else settle();
    }
  }

  private copyPath(path: string): void {
    try { clipboard.writeText(path); new Notice(this.s.pathCopied, 1400); }
    catch (error) { new Notice(this.s.copyFailed(String(error))); }
  }
}
