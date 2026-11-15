// The WebGL renderer's glyph atlas. It is not part of xterm.js's public API, so it lives here in
// one place, and every lookup tolerates its absence.
import type { Terminal } from "@xterm/xterm";

interface Atlas {
  _tmpCanvas?: unknown;
  pages?: { canvas?: unknown }[];
}

interface Internals {
  _core?: { _renderService?: { _renderer?: { value?: { _charAtlas?: Atlas } } } };
}

/**
 * The 2D canvases of the WebGL renderer's glyph atlas: the one each new glyph is drawn on, and the
 * pages it is copied to before going to the GPU. The atlas is shared by every terminal with the
 * same font and colors.
 */
export function glyphCanvases(term: Terminal): HTMLCanvasElement[] {
  const atlas = (term as unknown as Internals)._core?._renderService?._renderer?.value?._charAtlas;
  if (!atlas) return [];
  return [atlas._tmpCanvas, ...(atlas.pages ?? []).map((page) => page.canvas)]
    .filter((canvas): canvas is HTMLCanvasElement => canvas instanceof HTMLCanvasElement);
}
