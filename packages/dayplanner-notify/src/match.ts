// Day Planner (ivan-lednev) fires: new Notification(`Task started: ${task}\n${timeRange}`)
export const TITLE_PREFIX = "Task started: ";

export interface TaskStart {
  task: string;
  time: string;
}

export function parseTaskStartTitle(title: unknown): TaskStart | null {
  if (typeof title !== "string" || !title.startsWith(TITLE_PREFIX)) return null;
  const rest = title.slice(TITLE_PREFIX.length);
  const newline = rest.indexOf("\n");
  const task = (newline < 0 ? rest : rest.slice(0, newline)).trim();
  const time = newline < 0 ? "" : rest.slice(newline + 1).trim();
  if (task === "") return null;
  return { task, time };
}

export function formatTaskStartTitle(start: TaskStart): string {
  return start.time === "" ? `${TITLE_PREFIX}${start.task}` : `${TITLE_PREFIX}${start.task}\n${start.time}`;
}
