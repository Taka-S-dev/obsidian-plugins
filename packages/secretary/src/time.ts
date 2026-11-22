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
