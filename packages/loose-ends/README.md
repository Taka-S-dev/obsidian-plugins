# Loose Ends

English | [日本語](README.ja.md)

An Obsidian plugin that lists what is left over in a vault. Images pasted into notes casually and later removed from the text leave things behind: attachments nothing uses, broken links, empty folders. This shows them. Desktop only.

The interface follows Obsidian's language: Japanese when Obsidian is in Japanese, English otherwise.

## What it lists

Open it in a tab from the eraser icon in the ribbon or the command "Loose Ends: Open the list". Each kind has a tab with its count, and one kind is shown at a time: at first the first kind with anything in it. Tabs of kinds with nothing left are faint.

The vault is read only when the tab opens, when **Scan again** is pressed, and after something is moved to the trash from it. Nothing watches the vault in the background, so it adds no load the rest of the time. The time of the last scan is shown at the top; while **Scan again** runs its icon turns, and afterwards it says what changed ("No change", "2 fewer").

- **Broken links to images and files**: embeds (`![[...]]`, `![](...)`) whose target is gone, and links to a file with an extension. Click to open the note at the link.
- **Links to files outside the vault that are gone**: standard Markdown links with a `file://` URL (`[label](<file:///C:/...>)`, `[label](<file://server/share/...>)`, `<file:///...>`) whose target no longer exists.
  - Network shares can be slow, so these are checked only when **Check** is pressed.
  - The root of each drive or share is checked first. A share that does not answer within 3 seconds, or a drive that is not connected, is reported as not checked, never as missing.
  - Checking a network path makes Windows sign in to its server with your account, and a link in a note from elsewhere can point to any server. A server not seen before is named before the check and contacted only once allowed ("Check drives only" has the focus). Allowed servers are kept in the **Servers allowed to be contacted** setting, where they can be removed. WebDAV (`\\host@SSL\...`) and `\\?\` `\\.\` paths are never contacted.
  - Paths inside code blocks and inline code are not links.
- **Attachments nothing links to**: files other than notes, canvases and bases that no note links to and no canvas card shows. Images show as thumbnails; under each name are its folder, size and when it was last changed ("changed 3 month(s) ago").
- **Empty folders**: folders with no file at any depth. Of empty folders inside each other, only the outermost is listed.
- **Blank notes**: notes with nothing written in them (properties alone count as nothing), such as one made by clicking a link and never written, or an untitled note left empty. One that something links to would leave those links pointing nowhere, so it shows how many places link to it and **Select all** leaves it out. Each is checked to be still blank right before it goes to the trash.
- **Links to notes not written yet**: often left on purpose, so this tab comes last and is never the one opened first.

Lists of links (broken links, outside the vault, notes not written yet) have one line per row.

- **By target** (at first): one row per target with the number of places linking to it, most first; a row for several opens to the list of places.
- **By note**: one row per note with how many links it has, most first, opening to its links.
- The field above filters by target or note name (rows containing every word typed).
- The first 50 are shown; **Show 50 more** brings the rest.

Attachments can be sorted by name, largest first or oldest first. A file nothing links to but whose path or name is written in a note, script or setting file (for example Dataview's `dv.view("views/script")`) is marked as maybe in use, with where it is written, and **Select all** leaves it out.

## Opening

- Clicking an attachment, an empty folder or a blank note shows it in the file explorer, selected; a file or note is opened as well.
- It opens in the tab used most recently other than this list (as search results do), never in place of the list. With Ctrl, in a new tab.
- A right click brings up Obsidian's own menu for it, as in the file explorer. Anything deleted or renamed from there leaves the list at once.

## Tidying up

Attachments, empty folders and blank notes go with **Move to trash** on each row, or by ticking them and pressing **Move N selected to trash** (**Select all** is there too).

- Folders that moving the files leaves with nothing in them are listed in the confirmation as "Also move the N folder(s) this leaves empty", ticked (the outermost of nested ones). The attachment folder set in Obsidian, and folders holding it, stay even when empty.
- A list of what will be moved is shown first. **Cancel** has the focus, so Enter does not delete.
- The trash is the one set in Obsidian (Files and links → Deleted files): the system trash or the vault's `.trash` folder.
- Each item is checked again right before it is moved; an attachment linked meanwhile, a folder that now holds a file, or a note something has been written in, is kept.

Broken links are not fixed automatically. Open the line and fix or remove the link by hand.

## Taking things off the lists

Anything kept on purpose, of any kind, can be taken off its list with **Take off the list** (the crossed-out eye) on its row; links go by where they point. What is taken off is not counted.

It all appears in the **Taken off** tab at the far right, under the list it came from, and goes back with **Put back** on its row or **Put all back**, at any time. Taking off and putting back show at once, without reading the vault again.

## Left out

- Nothing inside the folders in the **Folders to leave out** setting (one per line) is listed. Use it for folders of material kept on purpose.
- While the core Templates plugin is on, its templates folder is left out too, since links in templates are usually examples.

## Caution

- "Nothing links to" is based on the links Obsidian knows about: note text and properties, and file cards on canvases. A file whose path or name is written in the vault's notes or text files, or in .obsidian's CSS snippets (snippets/*.css) and plugin settings (plugins/*/data.json, up to 1 MB), is marked as maybe in use, but one referenced only from elsewhere, such as a name built up in code, is listed without a mark. Check a file before moving it to the trash.
- Links outside the vault are checked against the paths as they can be seen at the time. Depending on share permissions and the network, a file that exists can come out as not checked.

## Development

```bash
npm test -w loose-ends
npm run build -w loose-ends
```

Tests use `node --test` for the parts that do not depend on Obsidian: reading links, checking paths, finding empty folders and unused files, and the interface text.
