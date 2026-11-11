// Terminal colors and font taken from the current Obsidian theme.
import type { ITheme } from "@xterm/xterm";

/** ANSI colors readable on a light background (Windows Terminal's One Half Light). */
const LIGHT_ANSI: ITheme = {
  black: "#383a42", red: "#e45649", green: "#50a14f", yellow: "#c18301",
  blue: "#0184bc", magenta: "#a626a4", cyan: "#0997b3", white: "#fafafa",
  brightBlack: "#4f525e", brightRed: "#e06c75", brightGreen: "#98c379", brightYellow: "#e5c07b",
  brightBlue: "#61afef", brightMagenta: "#c678dd", brightCyan: "#56b6c2", brightWhite: "#ffffff",
};

const isTransparent = (color: string) => color === "transparent" || /^rgba\(.*,\s*0\)$/.test(color);

/** The first background actually painted at or above the element. */
function paintedBackground(el: HTMLElement): string {
  for (let node: HTMLElement | null = el; node; node = node.parentElement) {
    const color = getComputedStyle(node).backgroundColor;
    if (!isTransparent(color)) return color;
  }
  return "#000000";
}

export function themeFor(el: HTMLElement): ITheme {
  const style = getComputedStyle(el);
  const background = paintedBackground(el);
  const selection = style.getPropertyValue("--text-selection").trim();
  return {
    ...(document.body.hasClass("theme-light") ? LIGHT_ANSI : {}),
    background,
    foreground: style.color,
    cursor: style.color,
    cursorAccent: background,
    ...(selection ? { selectionBackground: selection } : {}),
  };
}

/** The chosen font, then Obsidian's monospace font, so missing glyphs still have somewhere to come from. */
export function fontFor(el: HTMLElement, chosen: string): string {
  const obsidian = getComputedStyle(el).getPropertyValue("--font-monospace").trim();
  return [chosen, obsidian].filter(Boolean).join(", ") || "Consolas, monospace";
}
