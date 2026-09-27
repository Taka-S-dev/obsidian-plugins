// Shared build for every plugin. Run from a package directory:
//   node ../../scripts/build.mjs          one-off build
//   node ../../scripts/build.mjs --watch  rebuild on change
//
// If OBSIDIAN_VAULT is set, each successful build is copied to
// <vault>/.obsidian/plugins/<manifest id>/. Separate several vaults with ";".
import esbuild from "esbuild";
import { builtinModules } from "node:module";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { delimiter, join } from "node:path";

const watch = process.argv.includes("--watch");
const pkgDir = process.cwd();
const manifest = JSON.parse(readFileSync(join(pkgDir, "manifest.json"), "utf8"));
const ASSETS = ["main.js", "manifest.json", "styles.css"];
const vaults = (process.env.OBSIDIAN_VAULT ?? "")
  .split(delimiter)
  .map((v) => v.trim())
  .filter(Boolean);

function deploy() {
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
    console.log(`[${manifest.id}] deployed to ${dest}`);
  }
}

const ctx = await esbuild.context({
  entryPoints: [join(pkgDir, "src/main.ts")],
  outfile: join(pkgDir, "main.js"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "es2021",
  // Provided by Obsidian at runtime; bundling them would break the plugin.
  external: ["obsidian", "electron", "@codemirror/*", "@lezer/*", ...builtinModules],
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
