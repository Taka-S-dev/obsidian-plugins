# Path Links

English | [日本語](README.ja.md)

An Obsidian plugin that pastes Windows local and network (UNC) paths as standard Markdown links, then opens them in Explorer or copies the original path. Windows, Obsidian 1.8.7 or later, desktop only.

The interface follows Obsidian's language: Japanese when Obsidian is in Japanese, English otherwise.

## Approach

Notes should read naturally in any Markdown editor (VS Code, GitHub, ...).

- Only standard Markdown links are saved. There is no custom syntax, so notes stay readable without the plugin.
- Link targets keep the path readable. Only `%` and `#`, which would break the link, are percent-encoded.
- The label is the last folder or file name. A full path as the label doubles every backslash in the source, and the path is already in the target.

```markdown
[release](<file:///C:/Users/me/project/target/release>)
[Reports](<file://server/share/Reports>)
<https://example.sharepoint.com/sites/team>
```

## Usage

1. Copy a path in Explorer (the surrounding `"` from "Copy as path" are removed).
2. Run "Path Links: Paste clipboard paths and URLs as links" from the command palette, or bind it to a hotkey.
   - Selected text becomes the label.
   - Several lines become a bullet list.
   - If the cursor is in or above the frontmatter (for example, right after opening a note, when it sits hidden behind the Properties panel), the links go on the line right below the frontmatter instead, so the properties are never broken.
   - `https://` URLs become `<…>` autolinks, or `[selection](<URL>)` when text is selected.
3. In Reading view and Live Preview, `file://` links get a copy button that copies the original Windows path.
4. Clicking a link opens the folder.
5. Right-clicking any `file://` link adds "Copy Windows path" to Obsidian's link menu.

Source mode shows the file exactly as stored. In Live Preview the button is hidden while the cursor is inside the link.

### Properties and Bases

`file://` links in note properties open the same way, both in the Properties panel and in Bases tables: Explorer comes to the front, and files that run as programs ask first. These places get no copy button, since Obsidian manages those cells; use "Copy Windows path" from the right-click menu instead. Path Links handles clicks on the link itself only; the rest of the property value behaves as before.

```yaml
---
target: "[Reports](<file://server/share/Reports>)"
---
```

## How links open

Folders are opened by passing the original path to explorer.exe as a single argument. Obsidian's default handling opens folders behind the Obsidian window. Files open in their associated application. If the folder check or the launch fails, Obsidian's default handling is used. No shell command string is ever built. Bringing Explorer to the front is subject to Windows' focus rules, so it is not guaranteed on every system.

### Files that run as programs ask first

Some Markdown previews do not open `file://` links at all, because one click on a link in an untrusted note could run a program.
Path Links opens them, but asks first for file types Windows runs rather than displays (`.exe` `.bat` `.cmd` `.ps1` `.vbs` `.js` `.msi` `.lnk` `.url` `.reg` and others). Cancel is the default, and closing the dialog with Esc also cancels.
Folders, documents and images open without asking. Trailing dots or spaces (`setup.exe.`) and alternate data streams (`a.txt:b.exe`) are treated as executables too.

## Caution

- This plugin opens Windows files and folders from links in notes. What an opened file does depends on the file and its associated application.
- The confirmation is based on the file extension and cannot catch every dangerous file. For example, Office documents with macros (`.docm`, `.xlsm`) open without asking and rely on Office's macro settings.
- Check the target path before opening links in web clippings or notes from other people.
- Provided without warranty. Use at your own risk; the author is not liable for any damage arising from its use (see [LICENSE](../../LICENSE)).

## `file://localhost`

Following RFC 8089 and Windows, `localhost` means this machine.

| Link target | Opens |
|---|---|
| `file://localhost/C:/a` | `C:\a` |
| `file://localhost/Users` (no drive) | Not handled (Windows does not resolve it to a valid path either) |
| `file:////localhost/Users` (UNC form) | `\\localhost\Users` |

The UNC form (four slashes) is written only when pasting a `\\localhost\…` path. To try share paths locally, `\\127.0.0.1\Users` resolves the same way in other editors.

## Formats it reads

- `[name](<file:///C:/a b/c>)`, `[name](<file://server/share/x>)`, `[name](file:///C:/x)`
- The older `[name](<file:///%5C%5Cserver/share>)` form
- The older `path-links` code block (display only; there is no command to insert it)

````markdown
```path-links
\\localhost\Users
[Users](<C:\Users>)
```
````

## Development

See the repository README. `npm test -w path-links`, `npm run build -w path-links`.
`tests/fixtures/sample-note.md` is test data containing the older code block.
