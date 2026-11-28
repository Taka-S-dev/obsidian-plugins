// Whether paths outside the vault still exist. Node fs only (no Obsidian), so it runs under node --test.
import { stat } from "node:fs/promises";

/**
 * found: it is there. missing: its drive or share answered, and it is not there. unreachable: could
 * not tell. skipped: on a server that was not to be contacted.
 */
export type PathStatus = "found" | "missing" | "unreachable" | "skipped";

/** The server of a network path ("\\Server\share" -> "server"); null for a drive path. */
export function hostOf(path: string): string | null {
  const m = /^\\\\([^\\]+)/.exec(path);
  return m ? m[1].toLowerCase() : null;
}

/**
 * Servers never contacted, whatever the setting: WebDAV ("host@SSL@443", which goes out over HTTP)
 * and Windows device paths ("\\?\", "\\.\") rather than a server.
 */
export function neverContact(host: string): boolean {
  return host.includes("@") || host === "?" || host === ".";
}

/** The drive ("C:\") or share ("\\server\share\") a path is on. */
export function rootOf(path: string): string {
  const unc = /^\\\\[^\\]+\\[^\\]+/.exec(path);
  if (unc) return `${unc[0]}\\`;
  const drive = /^[A-Za-z]:/.exec(path);
  return drive ? `${drive[0].toUpperCase()}\\` : path;
}

async function statusOf(path: string, timeoutMs: number): Promise<PathStatus> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<"late">((resolve) => (timer = setTimeout(() => resolve("late"), timeoutMs)));
  try {
    return (await Promise.race([stat(path), late])) === "late" ? "unreachable" : "found";
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    return code === "ENOENT" || code === "ENOTDIR" ? "missing" : "unreachable";
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Checks each path, grouped by drive or share. The root is checked first: one that is not there or
 * does not answer in time (a share off the network, a drive not plugged in) makes all its paths
 * unreachable, rather than "missing" or a wait on each. Roots are checked side by side, and the
 * paths on one root one after another. A network path is checked only when `allowHost` allows its
 * server; the rest are skipped without any contact.
 */
export async function checkPaths(
  paths: Iterable<string>,
  timeoutMs: number,
  allowHost: (host: string) => boolean,
): Promise<Map<string, PathStatus>> {
  const byRoot = new Map<string, string[]>();
  for (const p of new Set(paths)) {
    const root = rootOf(p);
    byRoot.set(root, [...(byRoot.get(root) ?? []), p]);
  }
  const result = new Map<string, PathStatus>();
  await Promise.all(
    [...byRoot].map(async ([root, list]) => {
      // Windows signs in to a server it is asked about, so only servers allowed are touched.
      const host = hostOf(root);
      if (host !== null && (neverContact(host) || !allowHost(host))) {
        for (const p of list) result.set(p, "skipped");
        return;
      }
      const reachable = (await statusOf(root, timeoutMs)) === "found";
      for (const p of list) result.set(p, reachable ? await statusOf(p, timeoutMs) : "unreachable");
    }),
  );
  return result;
}
