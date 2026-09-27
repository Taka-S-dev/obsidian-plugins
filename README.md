# obsidian-plugins

個人用 Obsidian プラグインをまとめたリポジトリ。1 プラグイン = `packages/` 配下の 1 パッケージ。

| プラグイン | 概要 |
|---|---|
| [path-links](packages/path-links/README.md) | Windows のパスを「開く＋コピー」ボタンとして表示する |
| [dayplanner-notify](packages/dayplanner-notify/README.md) | Day Planner のタスク開始通知に前面化・音・スヌーズ付きモーダルを追加する |

## セットアップ

Node.js 24 以上が必要。

```bash
git clone <このリポジトリ>
cd obsidian-plugins
npm ci
```

## ビルドと Vault への配置

`OBSIDIAN_VAULT` に Vault のルートを指定してビルドすると、`<Vault>/.obsidian/plugins/<プラグインID>/` へ
`main.js`・`manifest.json`・`styles.css` をコピーする。未指定ならビルドのみ。複数の Vault は `;` で区切る。

```powershell
# PowerShell
$env:OBSIDIAN_VAULT = "C:\path\to\VaultA;C:\path\to\VaultB"
npm run build                      # 全プラグイン
npm run build -w path-links        # 1 つだけ
npm run dev -w dayplanner-notify   # 変更を監視して自動ビルド・配置
```

```bash
# Git Bash
OBSIDIAN_VAULT="C:/path/to/VaultA" npm run build
```

毎回指定しない場合は `setx OBSIDIAN_VAULT "C:\path\to\Vault"` でユーザー環境変数にしておく（新しいターミナルから有効）。

初回配置後は Obsidian の 設定 → コミュニティプラグイン で有効化する。更新後はそのプラグインをオフ→オンにして読み直す。

## テスト

```bash
npm test                     # 全プラグイン
npm test -w path-links       # 1 つだけ
```

テストは Node.js 組み込みの `node --test` で、TypeScript をそのまま読み込む。
Obsidian API に依存しない純粋なロジック（`src/` 内の obsidian を import しないファイル）だけを対象にする。

## 構成

```
package.json          npm workspaces・共通の devDependencies
tsconfig.base.json    共通の TypeScript 設定（各パッケージが extends）
scripts/build.mjs     共通の esbuild ビルド＋Vault 配置
packages/<id>/
  manifest.json       Obsidian のマニフェスト。id が配置先フォルダ名になる
  package.json        build / dev / test スクリプト
  tsconfig.json
  src/main.ts         エントリポイント
  styles.css          任意
  tests/
```

## プラグインを追加する

1. `packages/<id>/` を作り、既存パッケージから `package.json`・`tsconfig.json` をコピーして `name` を変える。
2. `manifest.json` を書く（`id` はフォルダ名と揃える。デスクトップ専用なら `isDesktopOnly: true`）。
3. `src/main.ts` に `Plugin` を継承したクラスを `export default` する。
4. ルートで `npm install` してワークスペースに登録する。

## 方針

- ソースは Vault の外に置く。`node_modules` を Vault や Obsidian Sync に入れないため。
- `main.js` は生成物なのでコミットしない。
- 共通処理は 2 つ以上のプラグインで実際に必要になってから `packages/shared` などに切り出す。
