# General Site Timing Tool Architecture

## 目的

このリポジトリを、汎用 site-profile ベースのチケット操作検証ツールとして次の 2 つに展開しやすい形へ設計する。

- VSCode 上でローカル実行するデスクトップ向けツール
- Web 上に公開して使えるブラウザ向けツール

ただし、一般の第三者サイトに対する過剰アクセスや規約違反を誘発しないことを前提にする。

## 設計原則

- 共通コアは「時刻同期」「カウントダウン」「実行判定」に限定する
- サイト固有処理はプラグイン設定として分離する
- 公開 Web 版は安全側に制限し、URL オープン補助までを基本にする
- ローカル版だけが高度な自動化を持てるが、利用者が管理する環境か検証環境に限定する
- 実行ログ、時刻差分、失敗理由を必ず記録する

## 想定するプロダクト分割

### 1. Shared Core

UI や実行環境に依存しない共通ロジック。

- 時刻表現の正規化
- NTP オフセット計算
- 残り時間計算
- 実行トリガー判定
- イベントログの標準フォーマット
- 設定バリデーション

推奨配置:

- `src/core/time-sync.js`
- `src/core/scheduler.js`
- `src/core/config-schema.js`
- `src/core/event-log.js`

### 2. Web App

ブラウザから使う公開版。ブラウザ制約を前提に、できることを明確に制限する。

主な責務:

- URL と実行時刻の入力
- NTP 同期結果の表示
- カウントダウン表示
- 実行時刻に `window.location` または `window.open` を呼ぶ
- 実行回数と間隔を明示した URL オープン補助であることの明示
- 利用規約確認チェック

制約:

- 他ドメインの DOM を読むことはできない
- 他サイトを裏で自動操作することはしない
- CORS 制約のため、NTP 取得は自前 API 経由にする

推奨配置:

- `web/index.html`
- `web/app.js`
- `web/styles.css`
- `api/time-sync`

### 3. VSCode / Local Runner

Node.js と Playwright を使うローカル版。公開 Web 版より権限が強いので責務を限定する。

主な責務:

- 検証環境や自分で管理するサイトでの再現テスト
- 画面遷移、クリック、入力の検証
- トレース、スクリーンショット、ログ保存

制約:

- 第三者サイトへの常時監視や過剰リトライはしない
- デフォルトでは控えめな回数と間隔で実行
- サイト固有セレクタは外部設定に置く

推奨配置:

- `runner/local_runner.js`
- `runner/site_profiles/*.json`
- `logs/`
- `artifacts/`

このリポジトリの現在の実装では、次を中心にする。

- `site_profile_runner.js`
  明示指定された JSON profile に書かれたステップを Playwright で実行するローカル runner。

profile は実行時に明示指定する。安全な汎用 example profile がない状態では、runner は暗黙のデフォルト profile を使わない。

ブラウザ版の `timing_assistant` から外部サイトへ遷移した後は、同一生成元ポリシーにより元ページから外部サイトの DOM を操作できない。そのため、サイト別の後続機能はローカル runner、ブラウザ拡張、ユーザーが明示実行する bookmarklet のいずれかに分離する。まずはログと trace を残せる Playwright runner を標準形にする。

## 共有設定モデル

共通設定は 3 層に分ける。

### 1. Global Settings

- `mode`
- `scheduledStartAt`
- `targetUrl`
- `timeSync`
- `execution`
- `logging`

### 2. Site Profile

サイト単位の設定。

- `allowedOrigins`
- `openMode`
- `preconnectOrigins`
- `selectors`
- `steps`

### 3. Session Overrides

一時的な調整値。

- `headless`
- `dryRun`
- `keepBrowserOpenMs`

## 推奨設定例

```json
{
  "mode": "web_public",
  "targetUrl": "https://example.com/release-page",
  "scheduledStartAt": "2026-05-01T10:00:00+09:00",
  "timeSync": {
    "enabled": true,
    "strategy": "server_ntp_proxy",
    "maxSamples": 3
  },
  "execution": {
    "type": "timed_open",
    "openCount": 3,
    "openIntervalMs": 250,
    "preconnect": true
  },
  "logging": {
    "enabled": true,
    "level": "info"
  }
}
```

## 実行モード

### `web_public`

公開 Web 版。

- 許可する実行は `timed_open` のみ
- 実行時は指定した回数と間隔で URL を開く
- クロスドメイン DOM 操作は禁止

### `local_assisted`

VSCode 上での補助実行。

- URL オープン補助
- ログ保存
- 計測強化
- Playwright は任意

### `local_automation`

ローカルの検証用自動化。

- Playwright 使用可
- サイトプロファイルに沿って遷移
- 自分で管理する環境やテスト環境を前提

## 公開 Web 版の API 設計

ブラウザから直接 UDP ベースの NTP は扱えないため、公開版は HTTP API を 1 つ持つ。

### `POST /api/time-sync`

役割:

- サーバー側で時刻ソースを取得
- サーバー受信時刻、送信時刻を含むサンプルを返す
- クライアントは HTTP の送受信時刻と合わせて擬似 4 タイムスタンプ計算を行う

レスポンス例:

```json
{
  "serverNowIso": "2026-05-01T00:59:59.820Z",
  "serverReceiveEpochMs": 1777597199800,
  "serverSendEpochMs": 1777597199802,
  "source": "ntp.nict.jp",
  "sampleId": "sample_001"
}
```

## UI 設計

### 公開 Web 版の画面

- URL 入力
- 実行時刻入力
- タイムゾーン表示
- NTP 同期状態
- 手元時計との差分
- カウントダウン
- 実行結果
- 利用規約と注意事項

### VSCode / Local 版の画面または CLI

- 設定ファイル読み込み
- Dry run
- 直近のログ一覧
- スクリーンショット保存先表示
- サイトプロファイル切り替え

## セキュリティと運用境界

- 公開 Web 版では認証情報を保存しない
- 公開 Web 版では任意 JS 注入機能を持たない
- 公開 Web 版では複数 URL 連打や巡回機能を持たない
- ローカル版でも既定値は控えめな回数にする
- 実行前に対象サイトの規約確認を促す

## デプロイ想定

### Web 公開

- Vercel
- Netlify
- Cloudflare Pages

必要要素:

- 静的フロントエンド
- 時刻同期用の軽量 API

### VSCode / Local

- Node.js
- Playwright
- JSON 設定

## このリポジトリで次に整理したいもの

1. `web_public` 用の最小 UI を別ディレクトリに作る
2. サイト固有処理を `site_profiles/` に分離する
3. profile schema と validation を追加する
4. auto-selection 設定と site profile の責務境界を明確にする
5. ログと trace の保存方針を repository safety check とそろえる
