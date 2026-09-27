import { MarkdownRenderChild, Notice, Plugin, setIcon } from "obsidian";
import { clipboard } from "electron";
import { confirmRiskyOpen } from "./confirm.ts";
import { buildLinks } from "./links.ts";
import { copyButtons, fileLinkTarget } from "./live-preview.ts";
import { openPath } from "./open-path.ts";
import { filePath, insertion, parseEntries } from "./paths.ts";

class PathLinksBlock extends MarkdownRenderChild {
  constructor(container: HTMLElement, private source: string, private open: (path: string) => Promise<void>) { super(container); }

  onload(): void {
    this.containerEl.empty();
    this.containerEl.addClass("path-links-container");
    let paths: { path: string; label: string }[];
    try { paths = parseEntries(this.source); }
    catch (error) {
      this.containerEl.createEl("div", { text: String(error), cls: "path-links-error" });
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
      open.title = `開く：${path}`;
      this.registerDomEvent(open, "click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        open.disabled = true;
        try { await this.open(path); }
        finally { open.disabled = false; }
      });
      const copy = row.createEl("button", { text: "コピー", cls: "path-links-copy" });
      copy.type = "button";
      copy.title = "元のパスだけをコピー";
      copy.setAttribute("aria-label", `パスをコピー：${path}`);
      copy.setAttribute("aria-live", "polite");
      let timer: ReturnType<typeof setTimeout> | undefined;
      this.register(() => { if (timer) clearTimeout(timer); });
      this.registerDomEvent(copy, "click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        try {
          clipboard.writeText(path);
          copy.textContent = "コピー済み";
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => { copy.textContent = "コピー"; }, 1400);
        } catch (error) { new Notice(`コピーできませんでした：${String(error)}`); }
      });
    }
  }
}

export default class PathLinksPlugin extends Plugin {
  onload(): void {
    this.registerMarkdownCodeBlockProcessor("path-links", (source, el, ctx) => {
      ctx.addChild(new PathLinksBlock(el, source, (path) => this.openAndReport(path)));
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
        const copy = wrapper.createEl("button", { cls: "path-links-inline-copy", attr: { title: `パスをコピー：${path}`, "aria-label": `パスをコピー：${path}` } });
        setIcon(copy, "copy");
        child.registerDomEvent(copy, "click", event => {
          event.preventDefault();
          event.stopPropagation();
          copyPath(path);
        });
      }
    });

    // Live Preview: same copy button and foreground Explorer as in Reading view.
    this.registerEditorExtension(copyButtons(copyPath));
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
      name: "クリップボードのパス・URLをリンクとして貼り付け",
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
        } catch (error) { new Notice(error instanceof Error ? error.message : String(error)); }
      }
    });
  }

  /** Every open goes through here, so files Windows would execute always ask first. */
  private async openAndReport(path: string): Promise<void> {
    try {
      const error = await openPath(path, (p) => confirmRiskyOpen(this.app, p));
      if (error) new Notice(`開けませんでした：${path}\n${error}`, 8000);
    } catch (error) { new Notice(`開けませんでした：${String(error)}`, 8000); }
  }
}

function copyPath(path: string): void {
  try { clipboard.writeText(path); new Notice("パスをコピーしました", 1400); }
  catch (error) { new Notice(`コピーできませんでした：${String(error)}`); }
}
