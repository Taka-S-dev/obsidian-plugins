# obsidian-plugins

English | [日本語](README.ja.md)

A collection of Obsidian plugins, one package per plugin under `packages/`. Each plugin shows its interface in Japanese or English, following Obsidian's language setting.

| Plugin | Summary |
|---|---|
| [path-links](packages/path-links/README.md) | Paste Windows paths as standard Markdown links, then open them or copy the original path |
| [dayplanner-notify](packages/dayplanner-notify/README.md) | Brings Obsidian to the front with a sound when a Day Planner task starts, with an alert that can postpone it |

## Setup

Requires Node.js 24 or later.

```bash
git clone <this repository>
cd obsidian-plugins
npm ci
```

## Build and install into a vault

With `OBSIDIAN_VAULT` set to a vault's root folder, each build copies `main.js`, `manifest.json` and `styles.css` into `<vault>/.obsidian/plugins/<plugin id>/`. Without it, the build only compiles. Separate several vaults with `;`.

```powershell
# PowerShell
$env:OBSIDIAN_VAULT = "C:\path\to\VaultA;C:\path\to\VaultB"
npm run build                      # all plugins
npm run build -w path-links        # one plugin
npm run dev -w dayplanner-notify   # rebuild and install on every change
```

```bash
# Git Bash
OBSIDIAN_VAULT="C:/path/to/VaultA" npm run build
```

To avoid setting it every time, run `setx OBSIDIAN_VAULT "C:\path\to\Vault"` once (takes effect in new terminals).

After the first install, enable the plugin in Obsidian under Settings → Community plugins. After an update, turn the plugin off and on again to reload it.

## Tests

```bash
npm test                     # all plugins
npm test -w path-links       # one plugin
```

Tests use Node.js's built-in `node --test`, which loads TypeScript directly.
They cover the pure logic only: files in `src/` that do not import `obsidian`.

## Layout

```
package.json          npm workspaces and shared devDependencies
tsconfig.base.json    shared TypeScript settings (each package extends it)
scripts/build.mjs     shared esbuild build and vault install
packages/<id>/
  manifest.json       Obsidian manifest; the id is the install folder name
  package.json        build / dev / test scripts
  tsconfig.json
  src/main.ts         entry point
  src/i18n.ts         interface text in English and Japanese
  styles.css          optional
  tests/
  README.md, README.ja.md
```

## Adding a plugin

1. Create `packages/<id>/` and copy `package.json` and `tsconfig.json` from an existing package, changing `name`.
2. Write `manifest.json` (match `id` to the folder name; set `isDesktopOnly: true` for desktop-only plugins).
3. In `src/main.ts`, `export default` a class that extends `Plugin`.
4. Run `npm install` at the root to register the workspace.

`.gitignore` is an allowlist. Files outside the listed paths (for example a new top-level folder) are ignored until they are added to it.

## Principles

- Sources live outside the vault, so `node_modules` never reaches the vault or Obsidian Sync.
- `main.js` is a build output and is not committed.
- Shared code moves into something like `packages/shared` only once two or more plugins actually need it.

## License

[MIT](LICENSE). Provided without warranty; the author is not liable for any damage arising from its use. See also the Caution section of each plugin's README.
