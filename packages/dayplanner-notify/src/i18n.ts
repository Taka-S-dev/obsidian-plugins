// UI text in English and Japanese. Pure module (no Obsidian imports) so key parity is testable.
// The language follows Obsidian's own setting; anything but Japanese falls back to English.

const en = {
  starting: "Starting now",
  postpone: "Postpone",
  postponeButton: (m: number) => `+${m} min`,
  postponeTooltip: (m: number) => `Postpone by ${m} minutes`,
  openNote: "Open note",
  ok: "OK",
  undo: "Undo",
  postponed: (task: string, from: string, to: string) => `Postponed "${task}": ${from} → ${to}`,
  restored: (task: string, time: string) => `Moved "${task}" back to ${time}`,
  errors: {
    "not-found": "Could not find this block in the note. It may be done, or its time or name changed.",
    ambiguous: "Several blocks have this time and name, so it was not moved. Open the note to adjust it.",
    "past-midnight": "Cannot move a block past midnight.",
    noDailyNote: "Today's daily note was not found.",
    noStartTime: "The start time is unknown, so the block was not moved.",
    undoLineChanged: "The moved line was edited afterwards, so it was not restored.",
    openDailyNote: "Could not open the daily note. Check the core Daily notes plugin.",
  },
  commands: {
    testNow: "Send a test notification",
    testDelayed: "Send a test notification in 10 seconds (minimize to check bringing the window to front)",
  },
  testScheduled: "Sending a test notification in 10 seconds",
  testTask: "Test task",
  dayPlannerMissing: "Day Planner Notify: Day Planner is not enabled.",
  dayPlannerNotifyOff: "Day Planner Notify: turn on Task Notification in Day Planner's settings.",
  settings: {
    enabled: "Enabled",
    enabledDesc: "Show an alert when Day Planner announces a task start.",
    frontMode: "Bring window to front",
    frontModeDesc: "off: do nothing / flash: flash the taskbar / front: restore and focus the window, even from the tray",
    sound: "Play sound",
    volume: "Volume",
    repeatSeconds: "Repeat interval (seconds)",
    repeatSecondsDesc: "Until the alert is closed, repeat the sound and taskbar flash at this interval. 0 turns it off.",
    maxRepeats: "Maximum repeats",
    postponeOptions: "Postpone options (minutes)",
    postponeOptionsDesc:
      "Buttons shown in the alert, comma-separated, 1 to 720. Each moves the block later in today's daily note, and Day Planner notifies again at the new time.",
  },
};

export type Strings = typeof en;

const ja: Strings = {
  starting: "開始時刻です",
  postpone: "延期",
  postponeButton: (m) => `+${m}分`,
  postponeTooltip: (m) => `${m}分延期する`,
  openNote: "ノートを開く",
  ok: "OK",
  undo: "Undo",
  postponed: (task, from, to) => `「${task}」を ${from} → ${to} に延期しました`,
  restored: (task, time) => `「${task}」を ${time} に戻しました`,
  errors: {
    "not-found": "ノートに該当するブロックが見つかりません。完了済みか、時刻や名前が変わった可能性があります。",
    ambiguous: "同じ時刻・同じ名前のブロックが複数あるため、延期できません。ノートを開いて調整してください。",
    "past-midnight": "日付をまたぐため、延期できません。",
    noDailyNote: "今日のデイリーノートが見つかりません。",
    noStartTime: "開始時刻が分からないため、延期できません。",
    undoLineChanged: "延期した行があとから変更されたため、戻せませんでした。",
    openDailyNote: "デイリーノートを開けませんでした。コアプラグイン「デイリーノート」を確認してください。",
  },
  commands: {
    testNow: "テスト通知を送る",
    testDelayed: "10秒後にテスト通知を送る（最小化して前面化を確認）",
  },
  testScheduled: "10秒後にテスト通知を送ります",
  testTask: "テストタスク",
  dayPlannerMissing: "Day Planner Notify: Day Planner が有効になっていません。",
  dayPlannerNotifyOff: "Day Planner Notify: Day Planner の設定で Task Notification をオンにしてください。",
  settings: {
    enabled: "有効",
    enabledDesc: "Day Planner のタスク開始通知に合わせてアラートを出す。",
    frontMode: "ウィンドウの前面化",
    frontModeDesc: "off: 何もしない / flash: タスクバーを点滅 / front: 最小化・トレイ格納から前面に出す",
    sound: "音を鳴らす",
    volume: "音量",
    repeatSeconds: "再通知の間隔（秒）",
    repeatSecondsDesc: "アラートを閉じるまで、この間隔で音とタスクバー点滅を繰り返す。0 で無効。",
    maxRepeats: "再通知の最大回数",
    postponeOptions: "延期の選択肢（分）",
    postponeOptionsDesc:
      "アラートに並べるボタン。カンマ区切りで 1〜720。押すと今日のデイリーノートのそのブロックを延期し、Day Planner が新しい時刻で再通知する。",
  },
};

export const STRINGS = { en, ja };

/** Obsidian language code ("ja", "en", "zh-TW", ...) -> UI strings. */
export function stringsFor(language: string): Strings {
  return language.toLowerCase().startsWith("ja") ? ja : en;
}
