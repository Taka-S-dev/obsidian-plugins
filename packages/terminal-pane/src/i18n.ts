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
  diff: {
    tabTitle: (assistant: string, name: string) => `${assistant}: ${name}`,
    empty: "No proposed edit",
    newFile: "new file",
    approve: "Approve",
    reject: "Reject",
    decideHere: (assistant: string) => `${assistant} proposes this edit. Approve or reject it here or in the terminal; this tab closes when you do.`,
    noChanges: "The edit leaves the file as it is.",
    skipped: (lines: number) => `⋯ ${lines} unchanged ${lines === 1 ? "line" : "lines"}`,
  },
  changes: {
    title: (count: number) => `${count} ${count === 1 ? "note" : "notes"} changed by programs in the terminal`,
    created: "(new)",
    deleted: "(deleted)",
    clear: "Clear the list",
    hint: "Click to see what changed · Ctrl+click to open the note",
  },
  review: {
    tabTitle: (name: string) => `Changes: ${name}`,
    note: "What a program in the terminal changed, from before its first change to now.",
    renamedFrom: (from: string) => `Renamed from ${from}.`,
    unknownBefore: "The contents from before the change were not kept, as for a file too large to remember, so it cannot be undone here.",
    open: "Open note",
    undo: "Undo change",
    undone: (name: string) => `Undid the change to ${name}.`,
    undoFailed: (name: string) => `Could not undo the change to ${name}: the file has been moved, or another file is in the way.`,
    confirmTitle: (name: string) => `Undo the change to ${name}?`,
    confirmModified: "The file goes back to its contents from before the program changed it. Edits made since are lost.",
    confirmCreated: "The program created this file. It is deleted, following Obsidian's setting for deleted files.",
    confirmDeleted: "The file is created again with the contents it had before it was deleted.",
    confirmRenamed: (from: string) => `The file is renamed back to ${from}, and links to it are updated. Its contents go back to those from before the change.`,
    confirm: "Undo",
    cancel: "Cancel",
  },
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
    connectAssistants: "Connect Claude Code and Copilot CLI",
    connectAssistantsDesc:
      "Claude Code and GitHub Copilot CLI started in the terminal connect to Obsidian as they do to VS Code: they see which note is open and what is selected in it, and show the edits they propose as a diff next to the terminal. Applies to programs started afterwards.",
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
  diff: {
    tabTitle: (assistant, name) => `${assistant}: ${name}`,
    empty: "変更案はありません",
    newFile: "新規ファイル",
    approve: "承認",
    reject: "拒否",
    decideHere: (assistant) => `${assistant} が提案している変更です。ここかターミナルで承認か拒否を選んでください。決めるとこのタブは閉じます。`,
    noChanges: "この変更でファイルの内容は変わりません。",
    skipped: (lines) => `⋯ 変更のない ${lines} 行`,
  },
  changes: {
    title: (count) => `ターミナルのプログラムが変更したノート：${count} 件`,
    created: "（新規）",
    deleted: "（削除）",
    clear: "一覧を消す",
    hint: "クリックで変更を見る · Ctrl+クリックでノートを開く",
  },
  review: {
    tabTitle: (name) => `変更: ${name}`,
    note: "ターミナルのプログラムが行った変更です（最初の変更の前から今まで）。",
    renamedFrom: (from) => `${from} から名前が変わりました。`,
    unknownBefore: "大きいファイルなどのため変更前の内容を記録していないので、ここでは元に戻せません。",
    open: "ノートを開く",
    undo: "元に戻す",
    undone: (name) => `${name} の変更を元に戻しました。`,
    undoFailed: (name) => `${name} の変更を元に戻せませんでした。ファイルが移動されたか、同じ名前のファイルがあります。`,
    confirmTitle: (name) => `${name} の変更を元に戻しますか？`,
    confirmModified: "プログラムが変更する前の内容に戻します。そのあとの編集は失われます。",
    confirmCreated: "このファイルはプログラムが作ったものです。削除します（削除したファイルの扱いは Obsidian の設定に従います）。",
    confirmDeleted: "削除される前の内容で、ファイルを作り直します。",
    confirmRenamed: (from) => `名前を ${from} に戻し、リンクも合わせて直します。内容も変更前に戻します。`,
    confirm: "元に戻す",
    cancel: "キャンセル",
  },
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
    connectAssistants: "Claude Code と Copilot CLI をつなぐ",
    connectAssistantsDesc:
      "ターミナルで起動した Claude Code と GitHub Copilot CLI が、VS Code と同じように Obsidian につながります。開いているノートと選択範囲を知り、提案する変更をターミナルの隣に差分で表示します。このあと起動するプログラムから反映されます。",
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
