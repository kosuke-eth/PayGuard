# @payguard/web — PayGuard オーナー向けコントロールパネル

React 19 + Vite 7 + TypeScript。Node.js で動作します（開発: Vite dev server / 本番: 依存ゼロの `server.mjs`）。

このフロントエンドは **表示と操作の起点** だけを担当します。ALLOW / ESCALATE / BLOCK の判定、決済の成否、
予算残高、実際の input 消費量などの「真実」はすべて `/v1` API とチェーン観測から取得し、ローカルでは決めません。
アプリ本体にモックモードやフェイク状態へのフォールバックはありません。

## 配置とインストール

**このフロントエンドは単体では動きません。** `@payguard/integration` を `workspace:*` で参照しているため、
バックエンドのモノレポ（`Payguard-backend-contract`）の `apps/web` に置き、**リポジトリのルートで pnpm** を使います。
`npm install` は使えません（`workspace:` プロトコル非対応でエラーになります）。

```bash
# 1) zip を展開してできた web フォルダを、バックエンドのリポジトリへ移動
#    （展開先が "apps 2" のようにスペースを含む場合は引用符で囲む）
mv ~/Downloads/"apps 2"/web  <Payguard-backend-contract のパス>/apps/web

# 2) リポジトリのルートへ移動
cd <Payguard-backend-contract のパス>

# 3) Node 24 以上と pnpm 10.33.0 を用意（ルートの package.json の engines / packageManager 指定）
node -v
corepack enable
corepack prepare pnpm@10.33.0 --activate

# 4) インストール（必ずルートで実行。lockfile が更新されるので差分は目視確認を）
pnpm install

# 5) 環境ファイル
cp apps/web/.env.example apps/web/.env
```

配置後のツリーはこうなります。

```text
Payguard-backend-contract/
├── package.json            ← ここ（ルート）でコマンドを実行する
├── pnpm-workspace.yaml     ← apps/* を含むので設定変更は不要
├── apps/
│   ├── api/
│   ├── worker/
│   └── web/                ← このフォルダ
└── packages/
    └── integration/        ← web が依存する共有パッケージ
```

### よくあるエラー

| 症状 | 原因と対処 |
| --- | --- |
| `npm error enoent Could not read package.json` | `package.json` のないフォルダ（例: `~/Downloads/apps 2`）で実行しています。リポジトリのルートで `pnpm` を実行してください。 |
| `Unsupported URL Type "workspace:"` | `npm install` を使っています。`pnpm install` をルートで実行してください。 |
| `ERR_PNPM_WORKSPACE_PKG_NOT_FOUND @payguard/integration` | `web` フォルダがモノレポの `apps/` 配下にありません。上の手順 1 を確認してください。 |
| `Unsupported engine` / Node のバージョン警告 | Node 24 以上に更新してください。 |
| `pnpm: command not found` | `corepack enable` を実行するか、`npm i -g pnpm@10.33.0` で導入してください。 |
| サインインで `ORIGIN_NOT_ALLOWED` | 次節のバックエンド `.env` 3 行が未設定、または `127.0.0.1` で開いています。`http://localhost:5173` を使ってください。 |
| 画面に「PayGuard is unavailable right now」 | API に届いていません。API を起動するか、画面確認だけなら下記のダミー API を起動してください。 |

### 画面だけ先に確認する（バックエンドなし）

PostgreSQL・Anvil・API・worker を起動していなくても、ターミナルを 2 つ使えばレイアウトは確認できます。
サインインには MetaMask などのウォレット拡張が必要です（ダミー API は任意の署名を受理します）。

```bash
pnpm --filter @payguard/web mock-api    # ターミナル1（:3000 にダミー API）
pnpm --filter @payguard/web dev         # ターミナル2 → http://localhost:5173
```

これはレイアウト確認専用で、決済の挙動は何も証明しません（詳細は「dev/mock-api.mjs について」）。

## バックエンド側の設定（必須）

API は CORS ヘッダを返さず、セッション Cookie は `SameSite=Strict` です。そのためブラウザからは
**フロントと同一オリジン** で API に届く必要があり、Vite / `server.mjs` が `/v1` と `/health` をプロキシします。
ブラウザの `Origin` ヘッダはそのまま API に渡るので、バックエンドの `.env` に次を設定してください。

```bash
API_SIWE_DOMAIN=localhost:5173
API_SIWE_URI=http://localhost:5173
API_ALLOWED_ORIGINS=http://localhost:5173
```

- ブラウザでは必ず `http://localhost:5173` を開いてください（`127.0.0.1` だと SIWE ドメインと Origin が一致しません）。
- Chrome / Firefox は `http://localhost` で `Secure` Cookie を受け付けます。Safari を使う場合のみ
  `API_COOKIE_SECURE=false` が必要です（ローカル限定）。

## 起動

```bash
# バックエンド（docs/ENV_SETUP.md の手順どおり）
anvil
./scripts/payguard demo:setup
pnpm --filter @payguard/api dev
pnpm --filter @payguard/worker dev

# フロントエンド（開発）
pnpm --filter @payguard/web dev            # http://localhost:5173

# フロントエンド（本番相当: ビルド + Node サーバ）
pnpm --filter @payguard/web build
pnpm --filter @payguard/web start
```

ウォレット: MetaMask 等に demo:setup の **オーナーアカウント** をインポートし、チェーン 31337
（RPC `http://127.0.0.1:8545`）に接続します。エージェント・マーチャント・リレイヤーの鍵はブラウザに入れません。

## 既知のバックエンド不一致（フロントでは隠していません）

Uniswap ルートの `kind` は `demo-setup` で公開スキーマと同じ `UNISWAP_V4` として保存します。
フロントは未知の種別をエイリアスしません。以前 `V4` で保存されたデータベースは `demo:reset` で作り直してください。

v4 プロファイルの出力予算は 6 桁の mUSDC（合計 300 / 自動 100 / 承認上限 200）です。入力側だけが 18 桁の mRWA です。
Hotel（180 mUSDC）は ESCALATE になる想定です。

Aqua プロファイルの出力予算は 18 桁ですが、デモカタログの請求額は 6 桁のままです。Aqua の Hotel / Over budget は
ESCALATE / BLOCK にならない可能性があります。

## 構成

```text
src/
  lib/payguard-client.ts  唯一の HTTP 境界。@payguard/integration の callPayGuardApi を使用
  lib/wallet.ts           EIP-1193。SIWE / typed data 署名 / prepared tx の検証・独立デコード・送信
  lib/amounts.ts          bigint / 10進文字列のみ。Number は金額に使わない。表示は切り捨て
  lib/errors.ts           製品文言 + バックエンドの code / message / requestId を必ず併記
  lib/types.ts            レスポンス read-model（API_CONTRACT.md と実装ハンドラに準拠）
  state/app.tsx           config → wallet → session 復旧 → vault/policy プロファイル
  hooks/usePolling.ts     キー付きポーリング。失敗時は前回値を保持し「最終確認時刻」を表示
  components/payments/VerdictGate.tsx   3 レーンのゲート図（ALLOW / ESCALATE / BLOCK）
  components/vault/OwnerTxFlow.tsx      オーナー取引を 1 件ずつ、receipt 確認後に次へ
  pages/                  Overview / Policies / Approvals / Activity / Agent Demo
server.mjs                本番用 Node サーバ（静的配信 + /v1 プロキシ）
dev/mock-api.mjs          レイアウト作業専用のダミー API（下記）
```

EIP-712 型、ABI、ステータス enum、reason enum は手書きコピーを作らず、すべて `@payguard/integration` から import しています。

## サービスとしての機能（v0.2）

- **ランディング／サインイン**: 製品説明（3 レーンの判定、保管モデル、証跡）とウォレットサインイン。サービス停止時は利用者向け文言を先に出し、運用者向け詳細は折りたたみ。
- **テスト環境バー**: Stripe の Test mode と同じ位置づけ。`/v1/config` の environment に基づき常時表示（LOCAL DEMO／モック資産の明示は仕様要件のため消していません）。
- **名前（アドレス帳）**: API はエージェントとマーチャントをアドレスでしか識別しないため、オーナー自身のラベルをこのブラウザに保存。表示専用で、リクエスト・署名・判定には一切使いません。アドレスは常に併記。
- **通知**: バックエンドの読み取り結果の「変化」だけをトースト化（承認待ち／BLOCK／検証済み決済／revert）。初回読込は基準値にするだけで履歴を再通知しません。タブタイトルに承認待ち件数。
- **システムステータス**: `/health/ready` を表示専用で利用。リレイヤー停止時は「承認済みの支払いはキューで待機」と案内。アプリの挙動は一切ゲートしません。
- **Settings**: アカウント／セッション期限、名前、ステータス、ネットワーク情報。セッションは期限到達時に自動でサインイン画面へ。
- **Overview**: 残予算・支出・承認待ち・BLOCK 件数のタイル（件数は「recent activity 内」と明記）。
- **Activity**: 検索、日付グルーピング、表示中の行の CSV エクスポート（atomic 値も併記）。
- **Test payments**: 旧 Agent Demo。バックエンドが `/v1/demo` を公開している環境でのみナビに表示。

## 設計上の約束

- 承認: typed data を取得後、署名前に chainId / verifyingContract / expectedSigner / 金額 / 受取人を照合し、
  共有エンコーダ（`hashApproval`）で digest を再計算して一致を確認。署名 → `approvals` → **同じ** intent を `submit`。
  「Not now」は何も署名せず、オンチェーンのキャンセルとしても表示しません。
- 決済成功の表示は、検証済み canonical receipt に基づく `settlement` がある場合のみ。HTTP 202 や tx hash だけでは成功扱いにしません。
- `UNKNOWN` は BLOCK とも失敗とも表示しません。
- requested output / maximum input / actual input は常に別の値として表示します。
- リロード: Cookie でセッション復旧（`GET /v1/auth/session` は CSRF をローテーションするため、同時呼び出しを 1 本に集約）。
- localStorage に保存するのは選択中プロファイル ID とデモ run ID のみ。鍵・トークン類は保存しません。
- マーチャント名は API に無いため、アドレス表示が基本。Agent Demo から開始した支払いにのみシナリオ名を表示名として付けます。
- カテゴリ名も API に無いため、番号のまま表示します。

## dev/mock-api.mjs について

PostgreSQL / Anvil / worker なしで **レイアウトだけ** を触るためのダミーです。任意の署名を受理し、状態はメモリ上の作り物です。
デモ・録画・決済挙動の検証には絶対に使わないでください。

```bash
pnpm --filter @payguard/web mock-api   # :3000
pnpm --filter @payguard/web dev
```

## 検証状況（正直な現状）

- `tsc --noEmit` と `vite build` は通過。
- ダミー API + 注入したテスト用ウォレットで、接続 → Overview → Agent Demo（ALLOW / ESCALATE / BLOCK / 不正署名）→
  承認署名 → Activity → Receipt → Policies → リロード復旧 → モバイル幅、をブラウザで通し確認済み。
- **実バックエンド（API + worker + Anvil + 実ウォレット）との結合は未検証です。** 最初のマイルストーン
  「ウォレット接続 → 認証 → 実支払い → 実 receipt → リロード後も表示」を実環境で確認してください。
  特に未確認: `policy.counters` のシリアライズ形式、`/v1/chain-observations` 後のポリシー有効化の観測タイミング、
  Uniswap v4 / Aqua の `/v1/demo/runs` 経由実行（バックエンド側でも未テストと明記されています）。
