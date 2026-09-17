# ChatGPT Migration Script

このファイルは、`ticket-practice` の状況を ChatGPT に移行して会話するための台本です。  
ChatGPT では方針整理・仕様相談・プロンプト作成を行い、Codex には実装プロンプトのみを渡す運用を想定しています。

## ChatGPT に貼る冒頭文

以下のプロジェクトについて相談したいです。  
あなたには実装そのものではなく、仕様整理、リスク整理、レビュー観点、Codex に渡す実装プロンプトの作成を手伝ってほしいです。

対象プロジェクトは `ticket-practice` です。TicketDive などのチケットサイト向けに、ローカルで動く timing assistant / auto-selection assistant を作っています。

## 現在の目的

販売開始時刻に合わせてページを開き、リロード後にチケット申込画面で以下を自動補助することが目的です。

- 券種の選択
- 枚数の選択
- お目当ての選択
- 支払い方法の選択
- 購入者情報の入力
- 購入確定の手前で停止

購入確定ボタンの押下は対象外です。

## 実装済みの主な機能

### timing assistant

- `timing_assistant.html`
- `timing_assistant.js`
- `timing_assistant_server.js`

ローカルサーバーで timing assistant を起動します。

```bash
npm run start:timing-assistant
```

設定画面:

```text
http://127.0.0.1:4173/auto-selection
```

### auto-selection 設定画面

関連ファイル:

- `auto_selection_settings.html`
- `auto_selection_settings.js`
- `auto_selection_settings.json`
- `timing_assistant_server.js`

設定画面では以下を保存できます。

- 自動選択を使うかどうか
- リロードしてから開始するか
- 対象URL
- 券種
- 枚数
- お目当て
- 支払い方法
- 姓
- 名
- 電話番号
- 停止後にブラウザを残す時間
- スクリーンショット保存
- Playwright trace zip 保存
- お目当て未選択時に停止するか

### サイト候補学習

販売前でも見えるページ情報から候補を事前取得します。

- 出演者欄からお目当て候補を取得
- `TICKET INFO` / `販売情報` から券種候補を取得
- 単独公演向けに、別公演URLからお目当て候補だけ取得
- 手入力のお目当て候補を追加

単独公演では出演者欄がグループ名だけで、実際のお目当てが各メンバーになるケースがあります。  
そのため、別公演URLからメンバー候補を学習するか、手入力候補を併用する方針です。

### Playwright runner

関連ファイル:

- `site_profile_runner.js`
- `site_profiles/*.json`
- `package.json`

ログイン準備:

```bash
npm run login:auto-selection
```

自動選択実行:

```bash
npm run run:auto-selection
```

対象URLを一時指定する場合:

```bash
npm run run:auto-selection -- --target-url=https://ticketdive.com/event/example
```

ログイン準備でも同じ指定が使えます。

```bash
npm run login:auto-selection -- --target-url=https://ticketdive.com/event/example
```

### ログイン・電話番号認証対応

- Playwright の永続プロファイル `.playwright-user-data/auto-selection` を使う
- `login:auto-selection` で手動ログインと電話番号認証を完了させる
- その後 `run:auto-selection` で同じプロファイルを使う
- 未ログイン、電話番号認証未完了を検出した場合は停止
- 原因確認用の png スクリーンショットを `artifacts/` に保存

### お目当て選択対応

実装済みの選択方式:

- native `select`
- カスタムドロップダウン
- radio / label 形式

お目当てが選べない場合は、設定により停止し、原因確認用pngを保存します。

### 支払い方法・購入者情報入力

実装済み:

- コンビニ決済の選択
- 姓の入力
- 名の入力
- 電話番号の入力

過去に「名」が正しく入らない問題がありましたが、exact placeholder / label 優先に修正済みです。

### ログ・成果物

ログ:

```text
logs/site-profile-run-*.json
```

スクリーンショット:

```text
artifacts/*.png
```

Playwright trace:

```text
artifacts/site-profile-trace-*.zip
```

trace zip はデバッグ用で、現在は既定では保存しない設定です。必要な場合だけ `captureTrace` を有効化します。

操作完了時刻として、ログに以下を出力します。

- `operationCompletedAt`
- `operationCompletedAtLocal`
- `operationDurationMs`

## 現在の注意点

GitHub に push / レビューへ出す前に、以下を必ず整理する必要があります。

### Git 管理対象から除外すべきもの

```gitignore
node_modules/
logs/
artifacts/
.playwright-user-data/
auto_selection_settings.json
```

理由:

- `.playwright-user-data/` はログインセッションを含む可能性がある
- `logs/` は実行ログや対象URL、画面状態を含む可能性がある
- `artifacts/` はスクリーンショットやtraceを含む
- `auto_selection_settings.json` は氏名・電話番号などの個人情報を含む

代わりに、サンプルとして以下のようなファイルを用意するのが安全です。

```text
auto_selection_settings.example.json
```

## ChatGPT に相談したいこと

以下の観点で相談したいです。

- GitHub にpushする前の安全なファイル整理
- `.gitignore` の設計
- サンプル設定ファイルの作り方
- README の整理
- TicketDive 以外のサイトに分岐する設計
- お目当て候補の安全な学習方法
- 本番利用前のチェックリスト
- Codex に渡す実装プロンプトの作成

## Codex に渡す実装プロンプトの形式

Codex には、ChatGPT で相談した結果を以下の形式で渡します。

```text
Goal:
- 何を実装するか

Context:
- 関連ファイル
- 現在の挙動
- 変更したい理由

Requirements:
- 必須要件
- 触ってよいファイル
- 触らない機能
- セキュリティ上の注意

Verification:
- 実行してほしいコマンド
- 期待する結果
```

## 次にCodexへ渡す候補プロンプト

### 候補1: GitHub push 前の安全整理

```text
Goal:
- ticket-practice を GitHub にpushできる状態へ整理してください。

Context:
- 現在 logs, artifacts, .playwright-user-data, auto_selection_settings.json に実行成果物や個人情報が含まれる可能性があります。
- GitHub に出すのはコード、README、サンプル設定のみが望ましいです。

Requirements:
- .gitignore を追加してください。
- logs/, artifacts/, .playwright-user-data/, node_modules/, auto_selection_settings.json をGit管理対象から除外してください。
- auto_selection_settings.example.json を作成してください。
- example には個人情報や実URLを入れないでください。
- 既存の実設定ファイルは削除しないでください。
- README に、設定ファイルのコピー方法と注意点を追記してください。
- 実装範囲は push 前整理に限定してください。

Verification:
- node --check site_profile_runner.js
- node --check timing_assistant_server.js
- node --check auto_selection_settings.js
- git status --short で個人情報や成果物がstage対象にならないことを確認してください。
```

### 候補2: サイト別分岐設計の相談後実装

```text
Goal:
- auto-selection にサイト別プロファイル分岐の土台を追加してください。

Context:
- 現在は TicketDive を主対象にしています。
- 将来的に、よく使うサイトごとに選択ロジックを分けたいです。

Requirements:
- 既存の TicketDive 挙動を壊さないでください。
- URL origin または host からサイトプロファイルを選べる構造にしてください。
- 最初は TicketDive 用 profile と default profile だけでよいです。
- OCR、購入確定、削除、課金のような機能は追加しないでください。
- ログにはどのprofileを選んだかを出してください。

Verification:
- node --check site_profile_runner.js
- npm run run:site-profile -- path/to/site_profile.json
```

### 候補3: お目当て選択の失敗解析強化

```text
Goal:
- お目当て選択が失敗した時の解析ログを強化してください。

Context:
- 単独公演ではお目当て候補がメンバー名になるため、事前学習や手入力候補と実フォーム候補が一致しないことがあります。

Requirements:
- お目当て選択失敗時に、表示されている候補テキストをログへ保存してください。
- 個人情報を含む入力欄の値はログに出さないでください。
- 失敗時pngはこれまで通り保存してください。
- 成功時にも選択方法 native select / custom dropdown / radio などをログに出してください。

Verification:
- node --check site_profile_runner.js
- 既存ログ構造と互換性があることを確認してください。
```

## ChatGPT への依頼文テンプレート

```text
上記の ticket-practice の状況を前提に相談します。
今はCodexには実装を直接頼まず、まず方針とリスクを整理したいです。

今回相談したいテーマ:
（ここに相談内容を書く）

最終的には、Codex に渡すための Goal / Context / Requirements / Verification 形式の実装プロンプトを作ってください。
```
