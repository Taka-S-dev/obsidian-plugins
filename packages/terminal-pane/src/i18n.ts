// UI text in English and Japanese. Pure module (no Obsidian imports) so key parity is testable.
// The language follows Obsidian's own setting; anything but Japanese falls back to English.

const en = {
  commands: {
    toggle: "Toggle terminal",
    newTerminal: "New terminal",
    openProfile: (name: string) => `Open terminal: ${name}`,
    next: "Next terminal tab",
    previous: "Previous terminal tab",
    close: "Close terminal tab",
    insertNotePath: "Insert the current note's path into the terminal",
    sendSelection: "Send selection to the terminal",
    find: "Find in terminal",
  },
  tabs: {
    newTerminal: "New terminal",
    chooseProfile: "New terminal with profile",
    restart: "Restart",
    close: "Close",
  },
  attention: "Wants your attention",
  linkHint: "Click to open · Ctrl+click to open in a new tab",
  find: {
    placeholder: "Find",
    older: "Previous match, in older output (Enter)",
    newer: "Next match, in newer output (Shift+Enter)",
    close: "Close (Esc)",
    none: "No results",
    count: (index: number, count: number) => (index < 0 ? `${count}+` : `${index + 1} of ${count}`),
  },
  pasteConfirm: {
    title: (lines: number) => `Paste text that runs ${lines === 1 ? "a line" : `${lines} lines`}?`,
    desc: "This program does not take a paste as a whole, so each line runs as soon as it is pasted, as if Enter were pressed.",
    paste: "Paste",
    cancel: "Cancel",
  },
  untitled: "Terminal",
  commandPrompt: "Command Prompt",
  noTerminal: "No terminal is open.",
  noNote: "No note is open.",
  unsafePath: (path: string) =>
    `Not inserted: the path contains a character that a shell would expand or read as a quote when you press Enter ($, \`, %, quotation marks, or control characters).\n${path}`,
  nodeNotFound: (node: string) =>
    `Node.js was not found (${node}). Install Node.js, or set its path in the Terminal Pane settings.`,
  commandNotFound: (command: string) => `Command not found: ${command}`,
  emptyCommand: "This profile has no command. Set one in the Terminal Pane settings.",
  startFailed: (error: string) => `The terminal could not start: ${error}`,
  exited: (code: number) => `Process exited with code ${code}.`,
  pressEnter: "Press Enter to start it again.",
  settings: {
    profiles: "Profiles",
    profilesDesc:
      "Each profile is a program the terminal runs, started in the vault folder. Each one also gets an \"Open terminal\" command you can bind to a hotkey.",
    name: "Name",
    command: "Command line, for example pwsh.exe -NoLogo",
    remove: "Remove profile",
    add: "Add profile",
    newProfile: "New profile",
    defaultProfile: "Default profile",
    defaultProfileDesc: "Used by \"Toggle terminal\" and \"New terminal\".",
    location: "Open terminals in",
    locationRight: "Right sidebar",
    locationTab: "New tab",
    fontSize: "Font size",
    fontFamily: "Font",
    fontFamilyDesc:
      "Font names separated by commas, for example JetBrainsMono Nerd Font, Consolas. Use a Nerd Font to show the icons many terminal programs draw. Leave empty to use Obsidian's monospace font.",
    obsidianCommands: "Obsidian commands in the terminal",
    obsidianCommandsDesc:
      "While a terminal has the keyboard, every key goes to the program. The hotkeys of the commands listed here go to Obsidian instead, as do those of this plugin's own commands. Pick commands whose keys your terminal programs do not use: shells and editors use Ctrl+P, Ctrl+W, Ctrl+N and Ctrl+O.",
    addCommand: "Add command",
    removeCommand: "Remove",
    chooseCommand: "Choose a command to run from the terminal",
    commandMissing: (id: string) => `${id} (not loaded)`,
    noHotkey: "No hotkey. Set one in Settings → Hotkeys.",
    shiftEnterNewline: "Shift+Enter inserts a line break",
    shiftEnterNewlineDesc:
      "Sends Shift+Enter as Alt+Enter, which Claude Code reads as a new line instead of submitting. Turn off to send it as a plain Enter. Ctrl+J also inserts a line break in Claude Code either way.",
    notifications: "Mark tabs that want attention",
    notificationsDesc:
      "When a program finishes replying in a tab you are not typing in, the tab gets a blinking dot, and the taskbar button flashes if Obsidian is in the background. A reply counts as finished when output that followed Enter stops for 3 seconds, or when the program rings the bell, sends a notification or clears its taskbar progress. No sound plays.",
    advanced: "Advanced",
    bundledConpty: "Use the bundled ConPTY",
    bundledConptyDesc:
      "Runs programs through the newer ConPTY that ships with the plugin instead of the one built into Windows. It can draw some programs more accurately, but on this Windows build it passed output more slowly. Applies to terminals opened afterwards.",
    nodePath: "Node.js",
    nodePathDesc:
      "The terminal runs in a separate Node.js process. Leave as node to use the one on PATH, or enter the full path to node.exe.",
  },
};

export type Strings = typeof en;

const ja: Strings = {
  commands: {
    toggle: "ターミナルの表示を切り替え",
    newTerminal: "新しいターミナル",
    openProfile: (name) => `ターミナルを開く：${name}`,
    next: "次のターミナルタブ",
    previous: "前のターミナルタブ",
    close: "ターミナルタブを閉じる",
    insertNotePath: "現在のノートのパスをターミナルに入力",
    sendSelection: "選択範囲をターミナルに送る",
    find: "ターミナル内を検索",
  },
  tabs: {
    newTerminal: "新しいターミナル",
    chooseProfile: "プロファイルを選んで新しいターミナル",
    restart: "再起動",
    close: "閉じる",
  },
  attention: "応答があります",
  linkHint: "クリックで開く · Ctrl+クリックで新しいタブに開く",
  find: {
    placeholder: "検索",
    older: "前の一致（古い出力へ）（Enter）",
    newer: "次の一致（新しい出力へ）（Shift+Enter）",
    close: "閉じる（Esc）",
    none: "見つかりません",
    count: (index, count) => (index < 0 ? `${count}+` : `${index + 1} / ${count}`),
  },
  pasteConfirm: {
    title: (lines) => `${lines} 行が実行される貼り付けです。貼り付けますか？`,
    desc: "このプログラムは貼り付けをまとめて受け取らないため、各行は貼り付けた時点で Enter を押したように実行されます。",
    paste: "貼り付け",
    cancel: "キャンセル",
  },
  untitled: "ターミナル",
  commandPrompt: "コマンド プロンプト",
  noTerminal: "開いているターミナルがありません。",
  noNote: "開いているノートがありません。",
  unsafePath: (path) =>
    `入力しませんでした。パスに、Enter を押すとシェルが展開したり引用符として扱ったりする文字（$、\`、%、引用符、制御文字）が含まれているためです。\n${path}`,
  nodeNotFound: (node) =>
    `Node.js が見つかりません（${node}）。Node.js をインストールするか、Terminal Pane の設定でパスを指定してください。`,
  commandNotFound: (command) => `コマンドが見つかりません：${command}`,
  emptyCommand: "このプロファイルにはコマンドがありません。Terminal Pane の設定で指定してください。",
  startFailed: (error) => `ターミナルを起動できませんでした：${error}`,
  exited: (code) => `プロセスが終了しました（終了コード ${code}）。`,
  pressEnter: "Enter キーでもう一度起動します。",
  settings: {
    profiles: "プロファイル",
    profilesDesc:
      "プロファイルごとに、ターミナルで動かすプログラムを指定します。Vault のフォルダで起動します。プロファイルごとに「ターミナルを開く」コマンドができ、ホットキーを割り当てられます。",
    name: "名前",
    command: "コマンドライン（例：pwsh.exe -NoLogo）",
    remove: "プロファイルを削除",
    add: "プロファイルを追加",
    newProfile: "新しいプロファイル",
    defaultProfile: "既定のプロファイル",
    defaultProfileDesc: "「ターミナルの表示を切り替え」と「新しいターミナル」で使います。",
    location: "ターミナルを開く場所",
    locationRight: "右サイドバー",
    locationTab: "新しいタブ",
    fontSize: "文字の大きさ",
    fontFamily: "フォント",
    fontFamilyDesc:
      "フォント名をカンマで区切って指定します（例：JetBrainsMono Nerd Font, Consolas）。ターミナルのプログラムが表示するアイコンを出すには Nerd Font を指定してください。空欄なら Obsidian の等幅フォントを使います。",
    obsidianCommands: "ターミナルで使う Obsidian のコマンド",
    obsidianCommandsDesc:
      "ターミナルにフォーカスがあるときは、すべてのキーがプログラムに届きます。ここに並べたコマンドのホットキーは、代わりに Obsidian が受け取ります（このプラグインのコマンドも同様）。ターミナルのプログラムが使わないキーのコマンドを選んでください。Ctrl+P、Ctrl+W、Ctrl+N、Ctrl+O はシェルやエディタが使います。",
    addCommand: "コマンドを追加",
    removeCommand: "削除",
    chooseCommand: "ターミナルから使うコマンドを選択",
    commandMissing: (id) => `${id}（読み込まれていません）`,
    noHotkey: "ホットキーがありません。設定 → ホットキーで割り当ててください。",
    shiftEnterNewline: "Shift+Enter で改行する",
    shiftEnterNewlineDesc:
      "Shift+Enter を Alt+Enter として送ります。Claude Code では送信せずに改行になります。オフにすると普通の Enter として送ります。Claude Code では、この設定にかかわらず Ctrl+J でも改行できます。",
    notifications: "応答があったタブに印を付ける",
    notificationsDesc:
      "入力中でないタブでプログラムの応答が終わると、そのタブに点滅する点が付きます。Obsidian が裏にあるときはタスクバーのボタンも点滅します。Enter のあとに続いた出力が 3 秒止まったとき、またはプログラムがベルや通知を送ったり、タスクバーの進捗表示を消したりしたときに、応答が終わったとみなします。音は鳴りません。",
    advanced: "詳細",
    bundledConpty: "同梱の ConPTY を使う",
    bundledConptyDesc:
      "Windows に組み込まれた ConPTY の代わりに、プラグインに同梱した新しい ConPTY でプログラムを動かします。プログラムによっては表示が正確になりますが、この Windows では出力が遅くなりました。このあと開くターミナルから反映されます。",
    nodePath: "Node.js",
    nodePathDesc:
      "ターミナルは別の Node.js プロセスで動きます。node のままなら PATH にあるものを使います。別のものを使うときは node.exe のフルパスを入力してください。",
  },
};

export const STRINGS = { en, ja };

/** Obsidian language code ("ja", "en", "zh-TW", ...) -> UI strings. */
export function stringsFor(language: string): Strings {
  return language.toLowerCase().startsWith("ja") ? ja : en;
}
