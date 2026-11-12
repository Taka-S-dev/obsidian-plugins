// Escape sequences a program sends to ask for the user's attention. Pure module (no Obsidian imports).

/**
 * OSC 9 is a notification (iTerm2, Windows Terminal), except 9;4, which sets the taskbar progress:
 * programs such as Copilot CLI set it while they work and clear it (state 0) when they finish.
 */
export type Osc9 = { kind: "notify" } | { kind: "progress"; busy: boolean };

export function readOsc9(data: string): Osc9 {
  const progress = /^4(?:;(\d*))?(?:;|$)/.exec(data);
  if (!progress) return { kind: "notify" };
  const state = progress[1] ?? "";
  return { kind: "progress", busy: state !== "" && state !== "0" };
}

/** OSC 777 is a notification when it starts with `notify;` (it has other uses too). */
export function isOsc777Notify(data: string): boolean {
  return data.split(";")[0] === "notify";
}
