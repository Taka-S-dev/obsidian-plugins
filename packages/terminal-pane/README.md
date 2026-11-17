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
- Click a tab to show it. Close it with its **×**, a middle click, or **Close** in its right-click menu, which also has **Restart**. A tab shows the title the program in it sets, such as Claude Code's, when it sets one; double-click it, or use **Rename** in its menu, to give it a name that stays. With a tab focused, Left and Right move between tabs, Enter or Space shows one, and Delete closes it.
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
| Find in terminal | Show a search bar over the current terminal, starting with the selected text if any. It searches upward from the latest output and highlights every match. Enter finds the previous (older) match, Shift+Enter the next, Esc closes it. |
| Send selection to the terminal | Type the selected text, or the line the cursor is on, into the terminal without pressing Enter. Also in the editor's right-click menu when text is selected. |

None has a default hotkey; set them in Settings → Hotkeys.

### Keys

While a terminal has the keyboard, every key goes to the program, including ones Obsidian would otherwise take (Ctrl+P, Ctrl+W, Esc). There is no mode to switch; two kinds of hotkeys reach Obsidian instead:

- Hotkeys you assigned to this plugin's commands. Bind Toggle terminal to go back to the note, where all of Obsidian's hotkeys work, and press it again to return.
- Hotkeys of the Obsidian commands listed under **Obsidian commands in the terminal** in the settings, like VS Code's `commandsToSkipShell`. The list starts empty, because Obsidian's common keys are also keys terminal programs use: Ctrl+P and Ctrl+N move through shell history, Ctrl+W deletes a word, and full-screen programs bind many more.

Copy and paste follow Windows Terminal:

- Ctrl+C copies when text is selected; otherwise it reaches the program as an interrupt.
- Ctrl+Shift+C copies. Ctrl+V and Ctrl+Shift+V paste.
- Right-click copies the selection, or pastes when nothing is selected; no menu opens. Programs that use the mouse, such as Copilot CLI, handle right-click themselves; hold Shift to use the terminal's instead.
- Pasting text with a line break, even a final one, into a program that does not take a paste as a whole, such as PowerShell or Command Prompt, asks first: each line would run as soon as it arrives. Claude Code and Copilot CLI take a paste as a whole, so they are not asked about. Control characters other than tabs and line breaks are left out of every paste.

Shift+Enter is sent as Alt+Enter (ESC, then Enter). xterm.js, which draws the terminal, sends Shift+Enter as a plain Enter, so programs could not tell them apart; Alt+Enter is a line break Claude Code accepts. VS Code's terminal, also built on xterm.js, needs Claude Code's `/terminal-setup` for the same reason. In PowerShell, Shift+Enter then does nothing rather than running the line. Turn this off under **Shift+Enter inserts a line break** to send a plain Enter. Ctrl+J inserts a line break in Claude Code either way.

### Notes and the terminal

- A path or `[[wikilink]]` in the output that names a file in the vault becomes a link: click it to open the note, Ctrl+click to open it in a new tab. Paths may be relative to the vault or absolute, with either slash. A relative path with no file at that place is looked up the way Obsidian resolves a `[[link]]`, so a bare file name such as `Index.md` works too. A path with spaces counts when it is in quotes. The note never opens in the terminal's own tab.
- Links keep the colors the program gave them. Hovering underlines one, and after a moment shows the note it opens and how.
- Drop files or folders on the terminal to type their paths, quoted as needed: relative to the vault when dragged from Obsidian, absolute when dragged from Windows Explorer.
- Notes that change while a program is working, such as notes an assistant edits, are counted on a button next to **+**. A program counts as working from Enter or its latest output until it has been quiet for 30 seconds, and while it shows progress; a change another plugin or a sync makes in that time is listed too. Its menu lists them, newest first, marked new, renamed or deleted. Click one to see what changed as a diff, from before the first change to now; Ctrl+click opens the note in a new tab. **See all changes** shows every one in a single tab, and **Undo all changes** puts every note back after asking. Saves of a note you have just typed in are left out. **Clear the list** in the menu empties it.
- The diff of a change has **Undo change**, which asks first and then puts the file back: an edited file gets its earlier contents, a new file is deleted (following Obsidian's setting for deleted files), a deleted file is created again, and a renamed file gets its old name back, with links updated. To have the earlier contents, the plugin keeps the text of the vault's notes, canvases and bases in memory, up to a million characters per file and 32 million in all; a change to a file past those limits can be seen but not undone.
- When a program deletes or moves a file that other notes link to, the button turns to the warning colour and the entry shows how many links broke; its diff lists the notes they are in. A program moving a file reaches Obsidian as a deletion and a new file, so a new file with the contents of one just deleted is shown as a rename. For a rename, **Update links** points the links at the new name, as renaming the file in Obsidian does; for a deletion, **Undo change** mends them.

### Claude Code, Copilot CLI and the open note

Claude Code and GitHub Copilot CLI started in the terminal connect to Obsidian the way they connect to VS Code, and see which note is open and what is selected in it. Ask about "this note" or "the selected lines" without typing a path. The note last looked at stays shared while the terminal has the keyboard.

- When either asks to edit a file, Obsidian shows the edit as a diff in a tab next to the terminal: lines removed and added, with three unchanged lines around each change, and within a line that was edited rather than rewritten, the words that changed marked. Approve or reject it with the buttons on the tab, the commands **Approve/Reject the edit Claude Code or Copilot CLI proposes** (which can have hotkeys that work while typing in the terminal), or in the terminal as usual; the tab closes when you do. The keyboard stays in the terminal while the tab is open.
- **Attach the current note to Claude Code or Copilot CLI** adds the note to the prompt being typed, as @path, with the selected lines if any; so does **Attach to Claude Code / Copilot CLI** in the right-click menu of a note or of the editor, shown while one is connected. Copilot CLI only tells the model about the open note when text is selected in it, so this is the sure way to point it at a note.
- While either is connected, the bar above the terminal shows its name with a plug icon; hovering it names the note they are told is open. While an edit waits for approval, it reads Awaiting approval in blue and blinks, and so does a dot on the pane's own tab.
- For Claude Code, the plugin listens on a port on 127.0.0.1 and writes `~/.claude/ide/<port>.lock` with a random token. Programs started in the terminal get the port in `CLAUDE_CODE_SSE_PORT`, so Claude Code connects without `/ide`.
- For Copilot CLI, the plugin listens on a named pipe and writes a lock file to `~/.copilot/ide` with a random nonce. Copilot CLI started in the vault folder connects by itself, unless its own setting for connecting to an IDE is off.
- A connection without the token or nonce is refused. The lock files are removed when the plugin unloads.
- This follows how the VS Code extensions talk to Claude Code and Copilot CLI, which is not a documented interface: an update to either can stop it working. Turn it off under **Connect Claude Code and Copilot CLI**.

### Notifications

When a program finishes replying while you are not typing in its terminal, its tab gets a blinking orange dot and an orange title, and so does Obsidian's own tab for the pane, which stays in sight while another note is open. The mark stays until you switch to the terminal's tab, or click or type in it, or the program withdraws it with `OSC 1337;RequestAttention=no` (as in iTerm2), for example once what it was waiting for has been dealt with elsewhere. If Obsidian is in the background, its taskbar button flashes too. No sound plays and nothing pops up.

A reply counts as finished when:

- output that followed Enter stops for 3 seconds. Assistants such as Copilot CLI animate a spinner until they are done, and a shell command prints until it ends, so this needs no setup in the program;
- the program rings the terminal bell, or sends an OSC 9 or OSC 777 notification;
- the program clears the taskbar progress (OSC 9;4) it set while working, as Copilot CLI does.

Turn this off under **Mark tabs that want attention**.

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
- **Hide the tab row with one terminal**: off by default. On, the row with the tab, the changed-notes button and **+** is hidden while only one terminal is open, and comes back with a second. Right-click the pane's tab, or use its ⋮ menu, to open a terminal or see the changed notes; the commands for them still work too.
- **Show the title bar**: on by default. Turn off to hide Obsidian's bar with back, forward, the title and the menu above a terminal in the main area, giving its height to the terminal. Right-clicking the tab shows the same menu.
- **Font size** and **Font**: font names separated by commas. Use a Nerd Font, such as JetBrainsMono Nerd Font, to show the icons many terminal programs draw. Empty uses Obsidian's monospace font. Ctrl+wheel over a terminal also changes the size, as in VS Code.
- **Shift+Enter inserts a line break**: on by default; see [Keys](#keys).
- **Mark tabs that want attention**: on by default; see [Notifications](#notifications).
- **Connect Claude Code and Copilot CLI**: on by default; see [Claude Code, Copilot CLI and the open note](#claude-code-copilot-cli-and-the-open-note).
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
- The plugin sends nothing to other computers. With **Connect Claude Code and Copilot CLI** on, it listens on 127.0.0.1 and on a named pipe so that Claude Code and Copilot CLI on this PC can connect, and tells them the open note and selection. Programs you run in it can use the network.
- The installed plugin folder includes node-pty's native binaries (about 2.6 MB).
- Provided without warranty. Use at your own risk; the author is not liable for any damage arising from its use (see [LICENSE](../../LICENSE)).

## Development

See the repository README. `npm test -w terminal-pane`, `npm run build -w terminal-pane`.

The build bundles `src/pty-host.ts` into `pty-host.js` next to `main.js`, and installs node-pty's runtime files into `node_modules/` of the plugin folder (see the `plugin` field in `package.json`). A running terminal keeps node-pty's binaries open; the build skips files that have not changed, and warns about any it could not replace.
