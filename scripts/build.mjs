// Shared build for every plugin. Run from a package directory:
//   node ../../scripts/build.mjs          one-off build
//   node ../../scripts/build.mjs --watch  rebuild on change
//
// If OBSIDIAN_VAULT is set, each successful build is copied to
// <vault>/.obsidian/plugins/<manifest id>/. Separate several vaults with ";".
//
// A package can add an optional "plugin" field to its package.json:
//   "entries": extra scripts bundled next to main.js (src/foo.ts -> foo.js), for example a helper
//              that runs in a separate Node process.
//   "runtime": packages that cannot be bundled (native modules), mapped to globs of the files
//              to install. They are left out of the bundle and copied into node_modules/ of the
//              installed plugin, so require() finds them next to the scripts.
import esbuild from "esbuild";
import { builtinModules, createRequire } from "node:module";
import { copyFileSync, existsSync, globSync, mkdirSync, readFileSync, statSync, utimesSync } from "node:fs";
import { basename, delimiter, dirname, join } from "node:path";

const watch = process.argv.includes("--watch");
const pkgDir = process.cwd();
const manifest = JSON.parse(readFileSync(join(pkgDir, "manifest.json"), "utf8"));
const options = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8")).plugin ?? {};
const entries = {
  main: join(pkgDir, "src/main.ts"),
  ...Object.fromEntries((options.entries ?? []).map((file) => [basename(file, ".ts"), join(pkgDir, file)])),
};
const runtime = options.runtime ?? {};
const ASSETS = ["manifest.json", "styles.css", ...Object.keys(entries).map((name) => `${name}.js`)];
const vaults = (process.env.OBSIDIAN_VAULT ?? "")
  .split(delimiter)
  .map((v) => v.trim())
  .filter(Boolean);

/** [source, path relative to the plugin folder] for every runtime package file. */
function runtimeFiles() {
  const resolve = createRequire(join(pkgDir, "package.json")).resolve;
  return Object.entries(runtime).flatMap(([name, patterns]) => {
    const root = dirname(resolve(`${name}/package.json`));
    const files = new Set(patterns.flatMap((pattern) => globSync(pattern, { cwd: root })));
    return [...files].map((file) => [join(root, file), join("node_modules", name, file)]);
  });
}

/**
 * Copies only when size or modification time differ. A running helper keeps its native modules
 * open, and Windows refuses to overwrite them; unchanged files are skipped so redeploying works.
 */
function copyIfChanged(src, dest) {
  const from = statSync(src);
  if (existsSync(dest)) {
    const to = statSync(dest);
    // utimes keeps whole milliseconds, so the copy's time can differ from the source by under 1 ms.
    if (to.size === from.size && Math.abs(to.mtimeMs - from.mtimeMs) < 1) return;
  }
  mkdirSync(dirname(dest), { recursive: true });
  try {
    copyFileSync(src, dest);
    utimesSync(dest, from.atime, from.mtime);
  } catch (error) {
    if (error.code !== "EBUSY" && error.code !== "EPERM") throw error;
    console.warn(`[${manifest.id}] in use, kept the installed copy: ${dest}`);
  }
}

function deploy() {
  const extra = runtimeFiles();
  for (const vault of vaults) {
    if (!existsSync(join(vault, ".obsidian"))) {
      console.error(`[${manifest.id}] skipped, not an Obsidian vault: ${vault}`);
      process.exitCode = 1;
      continue;
    }
    const dest = join(vault, ".obsidian", "plugins", manifest.id);
    mkdirSync(dest, { recursive: true });
    for (const file of ASSETS) {
      if (existsSync(join(pkgDir, file))) copyFileSync(join(pkgDir, file), join(dest, file));
    }
    for (const [src, rel] of extra) copyIfChanged(src, join(dest, rel));
    console.log(`[${manifest.id}] deployed to ${dest}`);
  }
}

const ctx = await esbuild.context({
  entryPoints: entries,
  outdir: pkgDir,
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "es2021",
  // Provided by Obsidian at runtime; bundling them would break the plugin.
  external: ["obsidian", "electron", "@codemirror/*", "@lezer/*", ...builtinModules, ...Object.keys(runtime)],
  // Stylesheets from dependencies are imported as text; the plugin adds them to the page itself.
  loader: { ".css": "text" },
  sourcemap: watch ? "inline" : false,
  treeShaking: true,
  logLevel: "info",
  banner: { js: `/* ${manifest.name} ${manifest.version}: generated from src/, do not edit. */` },
  plugins: [
    {
      name: "deploy",
      setup(build) {
        build.onEnd((result) => {
          if (result.errors.length === 0) deploy();
        });
      },
    },
  ],
});

if (watch) {
  await ctx.watch();
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
