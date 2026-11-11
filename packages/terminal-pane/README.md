# Terminal Pane

English | [日本語](README.ja.md)

An Obsidian plugin that runs a shell, GitHub Copilot CLI or your own terminal programs in a pane, started in the vault folder. Windows, Obsidian 1.8.7 or later, desktop only.

The interface follows Obsidian's language: Japanese when Obsidian is in Japanese, English otherwise.

## What it does

- One pane holds several terminals as tabs, each running its own program. It opens in the right sidebar; drag its icon into the main area to place it next to your notes, and it stays there.
- Programs run in a real pseudo terminal (ConPTY), so full-screen programs work: TUIs, editors, `copilot`, `nvim`.
- Each tab runs a *profile*: a named command line. PowerShell, Command Prompt and GitHub Copilot CLI are set up to start with; add your own.
- The open tabs are saved with the workspace and start again when Obsidian restarts (their programs start fresh).

## Requirements

- Windows 10 1809 or later (x64), Obsidian 1.8.7 or later
- Node.js on PATH, or its path set in the settings (checked with Node.js 24). The terminal runs in a separate Node.js process; see [How it works](#how-it-works).

## Usage

The row above the terminal shows the tabs.

- **+** opens a tab with the default profile; **▾** lists the profiles to choose from.
- Click a tab to show it. Close it with its **×**, a middle click, or **Close** in its right-click menu, which also has **Restart**. With a tab focused, Left and Right move between tabs, Enter or Space shows one, and Delete closes it.
- Closing the last tab closes the pane.
- When a program ends, its tab is dimmed and the terminal says so. Press Enter in it to start the program again.

### Commands

| Command | Does |
|---|---|
| Toggle terminal | From a focused terminal, go back to the note (collapsing the right sidebar if the terminal is there). Otherwise show the terminal pane, opening it if needed. Like VS Code's Ctrl+`. |
| New terminal | Add a tab with the default profile. |
| Open terminal: *profile* | Show the tab running that profile, or open one. There is one per profile. |
| Next / Previous terminal tab, Close terminal tab | Move between tabs or close the current one. |
| Insert the current note's path into the terminal | Type the note's vault-relative path into the terminal, for example after `@` in Copilot CLI. A path with spaces or shell punctuation goes in double quotes; a path containing `$`, `` ` ``, `%`, a quotation mark (including typographic ones, which PowerShell reads as quotes) or a control character is not inserted, since a shell would expand or end the quotes there when you press Enter. |

None has a default hotkey; set them in Settings → Hotkeys.

### Keys

While a terminal has the keyboard, every key goes to the program, including ones Obsidian would otherwise take (Ctrl+P, Ctrl+W, Esc). There is no mode to switch; two kinds of hotkeys reach Obsidian instead:

- Hotkeys you assigned to this plugin's commands. Bind Toggle terminal to go back to the note, where all of Obsidian's hotkeys work, and press it again to return.
- Hotkeys of the Obsidian commands listed under **Obsidian commands in the terminal** in the settings, like VS Code's `commandsToSkipShell`. The list starts empty, because Obsidian's common keys are also keys terminal programs use: Ctrl+P and Ctrl+N move through shell history, Ctrl+W deletes a word, and full-screen programs bind many more.

Copy and paste follow Windows Terminal:

- Ctrl+C copies when text is selected; otherwise it reaches the program as an interrupt.
- Ctrl+Shift+C copies. Ctrl+V and Ctrl+Shift+V paste.

Shift+Enter is sent as Alt+Enter (ESC, then Enter). xterm.js, which draws the terminal, sends Shift+Enter as a plain Enter, so programs could not tell them apart; Alt+Enter is a line break Claude Code accepts. VS Code's terminal, also built on xterm.js, needs Claude Code's `/terminal-setup` for the same reason. In PowerShell, Shift+Enter then does nothing rather than running the line. Turn this off under **Shift+Enter inserts a line break** to send a plain Enter. Ctrl+J inserts a line break in Claude Code either way.

## Profiles

A profile's command line is a program followed by its arguments, as you would type it in Command Prompt.

```text
pwsh.exe -NoLogo
cmd.exe
copilot
"C:\Program Files\My Tool\tool.exe" --flag "a b"
```

- A bare name (`copilot`, `pwsh.exe`) is searched for on PATH, trying each extension in PATHEXT. It is never taken from the vault folder, so a file placed in the vault cannot stand in for a program.
- A path with a folder resolves against the vault folder when it is relative.
- `.cmd` and `.bat` files, such as commands installed with npm, run through `cmd.exe`.
- PowerShell scripts do not run directly; use `pwsh.exe -File script.ps1`.
- Programs start in the vault folder, but commands are never looked up there: the plugin sets `NoDefaultCurrentDirectoryInExePath`, so Command Prompt and `.cmd` files (npm's call `node` by name) do not run a `node.exe` or `git.bat` placed in the vault. To run a program from the vault folder in Command Prompt, type `.\name`.

Each profile gets its own "Open terminal" command, so a profile can have a hotkey. Renaming a profile keeps its hotkey.

## Settings

- **Profiles**: add, rename, change or remove.
- **Default profile**: used by +, New terminal and Toggle terminal.
- **Open terminals in**: where a new pane opens when there is none (right sidebar or a new tab). An existing pane stays where you put it.
- **Font size** and **Font**: font names separated by commas. Use a Nerd Font, such as JetBrainsMono Nerd Font, to show the icons many terminal programs draw. Empty uses Obsidian's monospace font.
- **Shift+Enter inserts a line break**: on by default; see [Keys](#keys).
- **Obsidian commands in the terminal**: commands whose hotkeys work while a terminal has the keyboard; see [Keys](#keys). Each shows its current hotkey.
- **Use the bundled ConPTY**: off by default; see below.
- **Node.js**: `node` uses the one on PATH, or enter the full path to `node.exe`.

## How it works

- The screen is [xterm.js](https://xtermjs.org/), drawn with WebGL. Without WebGL it falls back to its DOM renderer.
- The pseudo terminal is [node-pty](https://github.com/microsoft/node-pty). It cannot run inside Obsidian itself: on Windows it reads the console output on a worker thread, and Obsidian's window cannot start Node.js workers. Obsidian's own executable cannot be run as Node.js either. So each tab starts a small helper (`pty-host.js`) in a separate Node.js process, the same arrangement as VS Code's pty host. A helper that crashes takes only its tab down, and it exits when its tab closes or when Obsidian exits.
- node-pty ships prebuilt binaries using Node-API, so no rebuild is needed when Obsidian or Node.js is updated.
- **Bundled ConPTY**: node-pty also ships a newer ConPTY (OpenConsole). Measured on Windows 11 build 26300, it passed output about 2.7 times slower than the ConPTY built into Windows, and full-screen programs redrew visibly in pieces, so it is off by default. Turn it on if a program draws incorrectly with the built-in one.

## Limitations

- The terminal reads PATH when Obsidian starts. After installing a program, restart Obsidian before using it in a profile.
- Only the list of tabs is restored after a restart, not what was on screen.
- Ctrl+C in a program started from a `.cmd` file may ask "Terminate batch job (Y/N)?"; this comes from `cmd.exe`, as in any terminal.
- Only Windows x64 is installed.

## Caution

- Programs run with your user account's rights, in the vault folder. A profile runs exactly what its command line says.
- The plugin itself sends nothing over the network; programs you run in it can.
- The installed plugin folder includes node-pty's native binaries (about 2.6 MB).
- Provided without warranty. Use at your own risk; the author is not liable for any damage arising from its use (see [LICENSE](../../LICENSE)).

## Development

See the repository README. `npm test -w terminal-pane`, `npm run build -w terminal-pane`.

The build bundles `src/pty-host.ts` into `pty-host.js` next to `main.js`, and installs node-pty's runtime files into `node_modules/` of the plugin folder (see the `plugin` field in `package.json`). A running terminal keeps node-pty's binaries open; the build skips files that have not changed, and warns about any it could not replace.
