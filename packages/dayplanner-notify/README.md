# Day Planner Notify

English | [日本語](README.ja.md)

An Obsidian plugin that makes [Day Planner](https://github.com/ivan-lednev/obsidian-day-planner) task starts hard to miss. Windows, desktop only.

## What it does

When Day Planner announces a task start (its `Task started: …` notification), this plugin adds:

- Brings the Obsidian window to the front, including from minimized or the system tray
- Plays a short beep
- Opens an alert with the task, its time, and buttons to postpone it (+15 / +30 / +45 / +60 min), open the note, or dismiss it
- Repeats the beep and flashes the taskbar until the alert is closed (without stealing focus again)

Day Planner decides when a task starts; this plugin has no parsing or scheduling of its own.
The alert and sound come from inside Obsidian, separately from the OS notification, so Windows Do Not Disturb does not hide them.

The interface follows Obsidian's language: Japanese when Obsidian is in Japanese, English otherwise.

## Postponing

Pressing +N rewrites the block's start and end time in today's daily note, N minutes later.
Day Planner picks up the change and notifies again at the new start time, so this replaces a snooze and keeps the timeline accurate.

- Only open tasks (`[ ]`) and plain bullets are changed. Done or cancelled blocks (`[x]`, `[-]`) are never touched.
- The line is found by task name and start time. If several lines match, or the block would cross midnight, nothing is changed and the alert shows why.
- Later blocks are not moved. If they overlap, adjust them on Day Planner's timeline.
- The options can be changed in the settings (comma-separated minutes).

After postponing, the confirmation shows an Undo button for 8 seconds. Undo puts the original line back exactly and reopens the alert quietly (no sound or focus change), so you can pick a different amount.
Day Planner's repeat announcement for the restored block is ignored, and its OS notification is closed.
If the line was edited after postponing, Undo leaves it alone.

## Requirements

- Obsidian 1.8.7 or later, on Windows
- Task Notification turned on in Day Planner's settings (the plugin warns at startup if it is off)
- Obsidian running

## Settings

Bring window to front (off / flash / front), sound and volume, repeat interval and maximum repeats, postpone options.

## Commands

- Send a test notification
- Send a test notification in 10 seconds (minimize Obsidian to check bringing the window to front)

Both go through the same path as Day Planner's own notification, so they exercise the real behavior.

## Limitations

- When several blocks start at the same time, Day Planner announces only one, so only one alert appears.
- If Day Planner changes its notification text (`Task started: `), this plugin no longer detects it.

## Caution

- Postponing edits the daily note directly. It changes nothing when the line cannot be identified, but keep history for important notes (Obsidian Sync, git, or similar).
- The plugin detects Day Planner's notification by wrapping the browser `Notification` API. Other plugins that wrap the same API may interfere.
- Provided without warranty. Use at your own risk; the author is not liable for any damage arising from its use (see [LICENSE](../../LICENSE)).
