# Secretary

English | [日本語](README.ja.md)

A secretary inside Obsidian, made of:

- an **inbox** for things that come up
- **reminders** at a set time
- **due dates** written the Tasks plugin way
- **notices** from other programs
- a **panel** that lists them
- a **heartbeat** that checks every minute and announces them

It works on its own, without other plugins or apps. Desktop only.

Other programs (scripts, or an assistant such as GitHub Copilot CLI) hand things over by dropping one file per message into the **queue folder**. The plugin picks them up, writes them to the inbox or reminders note, or shows them as notices. The plugin never starts other programs and never accepts commands over the network.

Calendar blocks (a span of time on a day) are left to Day Planner and whatever announces its entries. A reminder is a one-line nudge at a moment, any number of days ahead.

The interface follows Obsidian's language setting (Japanese for Japanese, English otherwise).

## What it does

- **Add to inbox**: a one-line input appends `- [ ] 2026-11-20 10:32 text` to the end of the inbox. The idea is to add without deciding where things belong, then sort them later in one go.
- **Add a reminder**: write what to be reminded of and pick the date (today by default) and time from the calendar and clock. Text that starts with a time, `15:00 text` (today, or tomorrow once 15:00 has passed) or `2026-11-21 09:30 text`, fills them in, so it can be typed in one go. A line under the fields says when it will go off.
- **Queue**: takes messages that other programs drop in. See "Queue" below for the contract.
- **Heartbeat**: every minute (and right away when the queue or the notes change):
  - routes queued messages to notices, reminders or the inbox;
  - shows reminders whose time has come in an alert in the middle of the screen (see below);
  - after each summary time (09:00 and 16:30 by default), announces unsorted inbox items and tasks overdue or due today or tomorrow once, if there are any.
- **Due dates**: reads open tasks with a Tasks plugin due date, `- [ ] text 📅 2026-11-25`, across the vault (or one folder, in settings). Done (`[x]`) and cancelled (`[-]`) tasks are ignored. Overdue and due-today counts go in the status bar; the panel also lists tasks due tomorrow, and counts later ones on one line ("3 after tomorrow") that opens them, soonest first. An overdue task says by how many days ("3 days over"). Clicking a task opens its note at that line. Its right-click menu moves the due date with **To tomorrow**, **A week from today** (both counted from today) or **Pick a date…**, changing only the line's 📅 date; **Undo** in the notice that follows puts the old date back. Its **Done** (also in its right-click menu) checks it off: with the Tasks plugin installed, the way Tasks does (adding the done date, and for a repeating task the next one's line); without it, only the checkbox changes. If the line is no longer as the panel shows it, nothing is written. As with reminders, there is **Undo** and "Done today (N)"; undoing brings back the one line it was, and removes a repeating task's added line. A due date added or changed shows up as soon as the note is saved; only that note is read again. Links in the text are shown as their words, and open on click in the panel (`[Call the bank](https://…)` as Call the bank, `[[Plan|the plan]]` as the plan). Fields other than the due date (recurrence, priority and so on) are not read. Works without the Tasks plugin installed.
- **Agenda**: the reminders and due tasks of the next four weeks, day by day, in a tab, to see what is coming. Only days with something are listed (today always is), each with its date large on the left and its items on the right, under a heading per week ("This week 11/23 – 11/29"); today is in the accent color, Saturday blue and Sunday red. What is overdue comes first under its own heading, laid out the same way with its dates in orange. Rows work as in the panel: click, **Done** and the right-click menu. Anything later is counted on a button that shows four more weeks. Open it from the button on the panel's due-dates header, the panel tab's right-click menu, or a command (the agenda tab's right-click menu opens the panel).
- **Panel**: in the right sidebar, lists notices, due dates, the reminders left today (with any whose time has passed but are not checked off, marked overdue) and the inbox. Reminders on later days are counted on one line ("2 on later days") that opens them, soonest first, to edit or check off like today's. An inbox item's **Remind** opens the reminder fields with its text; once the reminder is added, the item leaves the inbox. An inbox item shows when it was added as a short, muted label ("11/22 19:19" in the current year). Clicking an inbox item edits its text (the date and time it was added stay), Ctrl+click jumps to its line, and right-click offers **Edit**, **Open in the note**, **Remind**, **Done** and **Delete**. Its **Done** checks it off, for one dealt with some other way; the line stays in the note as a record. Click a reminder to change its date, time or text in the same fields used to add one; Ctrl+click it to jump to its line in the reminders note (to delete it there, for one); right-click it for **Edit**, **Open in the note**, **Done**, which checks it off, and **Delete**. **Delete** takes a line no longer wanted out of the note (**Done** keeps it as a record of what was done); **Undo** in the notice that follows puts it back where it was. Checking a reminder or an inbox item off, in the panel or the reminder alert, shows a notice with **Undo** for a few seconds. For a mistake noticed later, "Done today (N)" under the due dates, the reminders and the inbox opens what was checked off today, struck through, each with **Undo**; the list empties at midnight. "Read" clears a notice's mark but keeps it listed, for one you have seen but not dealt with yet; "Done" takes it off, and "Clear read" takes off every read one. While a notice is unread, it is bold and the panel's tab has a purple dot, so it shows even with the panel out of sight. Open it from the bell ribbon icon, by clicking the status bar, or with a command.
- **Status bar**: shows something like "Notices 1 | Next 15:00 Renew the car… | Inbox 3".

Announcements appear inside Obsidian and as Windows notifications (the latter can be turned off).

A reminder is harder to miss: when it is due, Obsidian comes to the front with a short sound, and the reminder stays in the middle of the screen until it is dealt with. **Done** checks its line off. **In 10 min**, **In 1 h** and **Tomorrow** (the same time) move its time later, and **Other…** opens the date and time fields to pick any time or change the text; it goes off again then. While the reminders note is being typed in, the alert waits until it has been left alone for a few seconds, so a line is not announced half-written. Reminders that come due while the alert is open join it, and one missed while Obsidian was closed shows with the time it was due. Its buttons stay greyed out for a second after a reminder appears, so a click or key meant for something else does not deal with it. A click outside the alert does not close it; Close, × or Esc does, and leaves the reminders in it unchecked: the panel lists them as overdue, with **Done** to check them off once they are. Bringing Obsidian forward and the sound can each be turned off in the settings.

## Queue

How other programs hand messages to the plugin (contract version 1, called the drop-folder format v1). This section is the whole public interface: the plugin knows nothing about senders, and senders need to know nothing about the plugin beyond it.

### Location

By default `%LOCALAPPDATA%\Secretary\queue` (`~/.secretary/queue` outside Windows); it can be changed in the settings. It is outside the vault, so senders need not know where the vault is, and messages never show up in search, Tasks queries or the vault's git history.

### Writing a message

One message = one file: UTF-8 JSON with a name ending in `.json`.

1. Write it completely to a hidden temporary file (for example `.20261120-152300-123-copilot-1a2b3c4d.json.tmp`).
2. Rename it to its `.json` name in the same folder.

The plugin ignores names starting with `.` and names not ending in `.json`, so a half-written file is never read. Any unique name works; starting it with a timestamp makes messages handled oldest first.

### Content

```json
{ "v": 1, "type": "notify", "text": "The trip options are summarized", "source": "copilot" }
{ "v": 1, "type": "remind", "text": "Renew the car insurance", "at": "2026-11-20T15:00" }
{ "v": 1, "type": "inbox",  "text": "Return the library books by Friday", "source": "m" }
```

| Field | Required | Meaning |
|---|---|---|
| `v` | yes | Contract version. Only `1` for now |
| `type` | yes | `notify`: announce now and keep it in the panel until marked done. `remind`: add to the reminders note, announced at `at`. `inbox`: add to the inbox note |
| `text` | yes | 1 to 1000 characters. Line breaks are kept for `notify`; `remind` and `inbox` become one line |
| `at` | `remind` only | Local time on that PC, `YYYY-MM-DDTHH:MM` (seconds allowed). No time zone such as `Z` or `+09:00` |
| `source` | | Sender's name, one line up to 40 characters. Shown in the panel and the notification |
| `quiet` | | `notify` only. `true` keeps it in the panel without a popup |

Unknown fields are ignored, so later versions can add some. An unknown `v` is rejected.

### After a message is picked up

- It is routed, recorded and saved, then its file is deleted. If Obsidian dies before the delete, the record of recently handled file names (the last 200) stops it from being delivered twice.
- A message that does not fit the contract is moved to the `rejected` folder inside the queue, and the reason is shown as a notification and in the panel. "Dismiss" in the panel hides the entry; the file stays. Files over 16 KB are rejected. At most 50 messages are handled per pass; the rest wait for the next one.
- Messages dropped while Obsidian is closed are handled when it opens. A `remind` whose time has passed is announced then.
- Text is shown as plain text: never interpreted as HTML or Markdown, and links are never opened.

### Sending from PowerShell

```powershell
$dir  = Join-Path $env:LOCALAPPDATA 'Secretary\queue'
$name = '{0}-shell-{1}.json' -f (Get-Date -Format 'yyyyMMdd-HHmmss-fff'), [guid]::NewGuid().ToString('N').Substring(0, 8)
$json = @{ v = 1; type = 'notify'; text = 'The backup finished'; source = 'backup' } | ConvertTo-Json -Compress
New-Item -ItemType Directory -Force $dir | Out-Null
[IO.File]::WriteAllText((Join-Path $dir ".$name.tmp"), $json, [Text.UTF8Encoding]::new($false))
Move-Item (Join-Path $dir ".$name.tmp") (Join-Path $dir $name)
```

## Reminders note

```
# Reminders

- [ ] 2026-11-20 15:00 Renew the car insurance
- [ ] 2026-11-21 09:30 Check the filing deadline
- [x] 2026-11-19 17:00 Already announced
```

- By default `Reminders.md` at the vault root (`リマインダー.md` when Obsidian is in Japanese). Another path can be set; the note is created on the first reminder.
- One line per reminder. Only lines shaped `- [ ] YYYY-MM-DD HH:MM text` are read; lines without a date, or with an impossible date or time, are ignored. Lines can be added by hand too.
- When it is due, the reminder shows in the alert (see above) and stays unchecked until it is dealt with: **Done**, in the alert or later in the panel, turns its `[ ]` into `[x]`, and moving it later rewrites its date and time. If the line differs from when it was read (edited or moved meanwhile), it is left alone and the alert says so.
- Reminders whose time passed while Obsidian was closed are announced when it opens, marked with their original date and time.
- To cancel one, delete the line or check it off.

## Inbox note

```
# Inbox

- [ ] 2026-11-20 10:32 Return the library books by Friday
```

- By default `Inbox.md` at the vault root (`受信箱.md` when Obsidian is in Japanese). Another path can be set.
- Every unchecked line (`- [ ]`) counts as unsorted. Sorted items are meant to be removed; a checked line stays but no longer counts.

Both notes are read again whenever they change, so edits by hand show up right away.

## Links

The text of a reminder, an inbox item, a notice or a due task can hold links, written as standard Markdown. The panel and the reminder alert show them by their words and open them on click; only the link opens, and a click elsewhere in the row edits it (or, for a due task, opens its line) as before. A link whose words are its whole path or URL (as pasted) shows only the file or folder name, or the site (`example.com/…`), so it does not fill the row; the note keeps the full address, which the tooltip and Copy still give.

```markdown
- [ ] 2026-11-25 15:00 Send the quote [Quote](<file://server/share/sales/quote.xlsx>)
- [ ] 2026-11-25 09:12 Check <https://example.com/status>
- [ ] 2026-11-25 09:13 Read [[Meeting notes|the notes]]
```

- A Windows path (`C:\…` or `\\server\…`) or an `https://` address pasted into the inbox or reminder field goes in as such a link, labelled with the selection if there is one. The quotes Explorer's "Copy as path" adds are dropped.
- Web pages open in the browser, notes in Obsidian.
- A `file://` link opens a folder in Explorer, brought to the front, and a file with its application. The button after it copies the path; right-click offers **Open** and **Copy path** too.
- A click outside a link does what it did before (a reminder or an inbox item opens for editing).
- The status bar and notifications show a link by its words only.

Notices and inbox items can come from other programs, so a click on a link is kept from running a program or reaching an unknown server:

- Only documents that cannot hold macros, pictures and media (PDF, `.docx`, `.xlsx`, `.pptx`, text, photos and the like) and folders open without asking. Anything else (`.exe`, `.bat`, `.lnk`, a `.xlsm` or an older `.xls` or `.doc`, which can hold macros, an `.iso`, an unknown extension) asks first, with Cancel as the default.
- A `\\server\…` link to a server not opened before shows the server's name and asks before connecting, since opening it signs in to that server with the Windows account. A server once allowed is remembered.
- Only `https://`, `http://` and `mailto:` addresses open; other schemes (`ms-msdt:`, `search-ms:` and the like, which can run programs) stay text.

## Not announcing twice

Inbox announcements happen once per reminder time per day. If Obsidian is opened later in the day, only the latest time that has passed is announced (with 09:00 and 16:30, opening at 13:00 announces the 09:00 one). Reminders are checked off, so each is announced once. What has been announced is kept in the plugin's `data.json` with the date and dropped when the day changes.

## Commands

| Command | What it does |
|---|---|
| Add to inbox | Opens the input. Enter adds the line (Enter while composing with an IME confirms the IME instead). |
| Add a reminder | Opens the input. Until the text, date and time can be used (a time already passed cannot), the button is off and the line under the fields says what is missing. |
| Open panel | Opens the panel in the right sidebar. |
| Open agenda | Opens the next four weeks in a tab. |
| Mark all notices as read | Marks every unread notice as read. |
| Open inbox / Open reminders | Opens the note. |
| Check now | Reads the queue and both notes again and shows the list. |

No default hotkeys. Assigning ones to "Add to inbox" and "Add a reminder" in Settings → Hotkeys makes them quick.

## Settings

Path of the inbox note, path of the reminders note, the queue folder, summary times (empty turns them off), whether to watch due dates and which folder (empty for the whole vault), Windows notifications on or off, and whether a reminder brings Obsidian to the front and plays a sound. As you type, the note fields suggest the note's default name in each vault folder (not existing notes, which the plugin would append to), the folder field suggests folders, and a note path typed without `.md` gets it.

## What the plugin keeps

Besides the settings, `data.json` holds the notices (the latest 100; beyond that, the oldest read ones go first), recently handled queue files, by name, size and time (the last 200), recently rejected files (the last 20), what has been announced today, what was checked off today (for Undo, with a due task's note path and its line as it was; dropped when the day changes), and the servers allowed for links (the last 200).

## Limitations

- Works only while Obsidian is open (messages in the queue wait while it is closed).
- An announcement happens at the first check (every minute) after its time.
- Reminder times are local time on that PC.

## Notes

- The only writes are to the inbox and reminders notes (appending lines, and checking off, editing, deleting or undoing from the panel or the reminder alert), the lines of due tasks checked off, moved or undone from the panel, and deleting or moving files in the queue folder. No other note or line is written.
- Any program running as the same user can drop files into the queue. Text that arrives is only displayed, and a link in it opens only when clicked; a file that is not a known kind of document, or a server not opened before, asks first (see Links).
- Windows notifications use `Notification`. If another plugin replaces `Notification`, this plugin's notifications pass through it too.
- Provided as is, without warranty. Use at your own risk; the author is not liable for any damage arising from its use ([LICENSE](../../LICENSE)).
