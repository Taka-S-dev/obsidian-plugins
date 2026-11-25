// Local date and time formatting. Pure module (no Obsidian imports).

const pad = (n: number) => String(n).padStart(2, "0");

/** YYYY-MM-DD in local time. */
export function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** HH:MM in local time. */
export function hm(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * The minutes the list offers: every five, plus the field's own minute when it falls between, so
 * the value it has is always there to see. Pure.
 */
export function minuteChoices(current: number | null): number[] {
  const out = Array.from({ length: 12 }, (_, i) => i * 5);
  if (current !== null && current % 5 !== 0) out.push(current);
  return out.sort((a, b) => a - b);
}
