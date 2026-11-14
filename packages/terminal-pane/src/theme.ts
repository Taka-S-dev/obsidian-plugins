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

/** The channels of a computed rgb() or rgba() color, alpha from 0 to 1; null for any other form. */
export function parseRgb(color: string): [number, number, number, number] | null {
  const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(color.trim());
  if (!m) return null;
  const alpha = m[4] === undefined ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
  return [Number(m[1]), Number(m[2]), Number(m[3]), alpha];
}

/**
 * A color painted over a background, as #rrggbb: search highlights must be opaque hex. The color's
 * own alpha is multiplied by `opacity`. Null when either color cannot be read.
 */
export function blendOver(color: string, background: string, opacity = 1): string | null {
  const fg = parseRgb(color);
  const bg = parseRgb(background);
  if (!fg || !bg) return null;
  const a = fg[3] * opacity;
  const channel = (i: number) => Math.round(fg[i] * a + bg[i] * (1 - a)).toString(16).padStart(2, "0");
  return `#${channel(0)}${channel(1)}${channel(2)}`;
}

/** A CSS color, such as var(--interactive-accent), as the browser computes it under the element. */
function computed(el: HTMLElement, css: string): string {
  const probe = el.createDiv();
  probe.style.color = css;
  const color = getComputedStyle(probe).color;
  probe.remove();
  return color;
}

export interface SearchColors {
  matchBackground: string;
  activeMatchBackground: string;
  activeMatchBorder: string;
  matchOverviewRuler: string;
  activeMatchColorOverviewRuler: string;
}

/** Search highlights in the theme's colors: text-highlight for matches, the accent for the selected one. */
export function searchColorsFor(el: HTMLElement): SearchColors {
  const background = paintedBackground(el);
  const highlight = blendOver(computed(el, "var(--text-highlight-bg)"), background) ?? "#7a6a1f";
  const accentColor = computed(el, "var(--interactive-accent)");
  const accent = blendOver(accentColor, background) ?? "#7f6df2";
  const active = blendOver(accentColor, background, 0.45) ?? accent;
  return {
    matchBackground: highlight,
    activeMatchBackground: active,
    activeMatchBorder: accent,
    matchOverviewRuler: highlight,
    activeMatchColorOverviewRuler: accent,
  };
}
