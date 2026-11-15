// What a terminal's tab is called. Pure module (no Obsidian imports) so it is testable.

/**
 * The title a program set for itself (OSC 0 or 2), when it says more than the profile's name.
 * Shells set the path of their executable, which only repeats the profile, so that is left out.
 */
export function programTitle(raw: string): string | null {
  const title = raw.trim();
  if (title === "") return null;
  if (/\.(exe|cmd|bat|com)$/i.test(title) || /^[a-z]:[\\/]/i.test(title) || title.startsWith("/")) return null;
  return title;
}

/** A name the user gave the tab first, then the program's own title, then the profile's name. */
export function tabTitle(custom: string | null, program: string | null, profile: string): string {
  return custom || program || profile;
}
