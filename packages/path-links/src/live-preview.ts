import { RangeSetBuilder } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";
import { editorLivePreviewField, setIcon } from "obsidian";
import { findFileLinks, type FileLinkRange } from "./links.ts";

class CopyButton extends WidgetType {
  constructor(private path: string, private onCopy: (path: string) => void, private label: (path: string) => string) {
    super();
  }

  eq(other: CopyButton): boolean {
    return other.path === this.path;
  }

  toDOM(): HTMLElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "path-links-inline-copy path-links-lp-copy";
    button.title = this.label(this.path);
    button.setAttribute("aria-label", this.label(this.path));
    setIcon(button, "copy");
    // mousedown would otherwise move the cursor into the link and reveal its source.
    button.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    button.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.onCopy(this.path);
    });
    return button;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

function isLivePreview(view: EditorView): boolean {
  return view.state.field(editorLivePreviewField, false) === true;
}

/** File links on the document line at pos, with offsets converted to document positions. */
export function fileLinksAround(view: EditorView, pos: number): FileLinkRange[] {
  const line = view.state.doc.lineAt(pos);
  return findFileLinks(line.text).map((l) => ({ ...l, from: line.from + l.from, to: line.from + l.to }));
}

/**
 * Live Preview only: a copy button after every Markdown link to a file:// target.
 * Source mode stays untouched so the raw Markdown is exactly what is on disk.
 */
export function copyButtons(onCopy: (path: string) => void, label: (path: string) => string) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = this.build(view);
      }

      update(u: ViewUpdate): void {
        if (
          u.docChanged ||
          u.viewportChanged ||
          u.selectionSet ||
          u.startState.field(editorLivePreviewField, false) !== u.state.field(editorLivePreviewField, false)
        ) {
          this.decorations = this.build(u.view);
        }
      }

      build(view: EditorView): DecorationSet {
        const builder = new RangeSetBuilder<Decoration>();
        if (!isLivePreview(view)) return builder.finish();
        const { selection, doc } = view.state;
        // The whole rendered viewport, not just visibleRanges: lines in the scroll margin are
        // already in the DOM, and scrolling within that margin does not trigger an update.
        const { from, to } = view.viewport;
        let pos = from;
        while (pos <= to) {
          const line = doc.lineAt(pos);
          for (const link of findFileLinks(line.text)) {
            const start = line.from + link.from;
            const end = line.from + link.to;
            // While the cursor is inside a link its source is being edited; stay out of the way.
            if (selection.ranges.some((r) => r.from <= end && r.to >= start)) continue;
            builder.add(end, end, Decoration.widget({ widget: new CopyButton(link.path, onCopy, label), side: 1 }));
          }
          pos = line.to + 1;
        }
        return builder.finish();
      }
    },
    { decorations: (v) => v.decorations },
  );
}

/**
 * The file:// target behind a rendered Live Preview link element, or null.
 * The rendered link hides its URL, so map the element back to its source line.
 */
export function fileLinkTarget(target: HTMLElement): string | null {
  const link = target.closest(".markdown-source-view.is-live-preview .cm-link");
  if (!(link instanceof HTMLElement)) return null;
  const view = EditorView.findFromDOM(link);
  if (view === null || !isLivePreview(view)) return null;
  const pos = view.posAtDOM(link);
  const hit = fileLinksAround(view, pos).find((l) => l.from <= pos && pos <= l.to);
  return hit?.path ?? null;
}
