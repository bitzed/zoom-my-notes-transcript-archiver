# Zoom My Notes → ローカル文字起こし保管（PoC）

[English](./README.md) | **日本語**

> ⚠️ The following sample application is a personal, open-source project shared by the app creator and not an officially supported Zoom Communications, Inc. sample application. Zoom Communications, Inc., its employees and affiliates are not responsible for the use and maintenance of this application. Please use this sample application for inspiration, exploration and experimentation at your own risk and enjoyment. You may reach out to the app creator and broader Zoom Developer community on https://devforum.zoom.us/ for technical discussion and assistance, but understand there is no service level agreement support for this application. Thank you and happy coding!

> ⚠️ このサンプルのアプリケーションは、Zoom Communications, Inc.の公式にサポートされているものではなく、アプリ作成者が個人的に公開しているオープンソースプロジェクトです。Zoom Communications, Inc.とその従業員、および関連会社は、本アプリケーションの使用や保守について責任を負いません。このサンプルアプリケーションは、あくまでもインスピレーション、探求、実験のためのものとして、ご自身の責任と楽しみの範囲でご活用ください。技術的な議論やサポートが必要な場合は、アプリ作成者やZoom開発者コミュニティ（ https://devforum.zoom.us/ ）にご連絡いただけますが、このアプリケーションにはサービスレベル契約に基づくサポートがないことをご理解ください。

Zoom の **My Notes（自分用メモ）** イベントを **WebSocket** で購読し、メモの文字
起こし（transcript）が準備できたタイミングで、**そのメモ所有者本人の OAuth トー
クン**で取得してローカルに JSON として保管する PoC です。

これは概念実証（PoC）です。すべてローカルに保存し（クラウド不使用）、詳細ログを
残します。ここで使っているローカルループバック（`127.0.0.1`）＋ PKCE のオンボー
ディングは **検証用の簡便手段** であり、実運用ではサーバサイド OAuth と allowlist
が必要です。→ [PoC から本番へ](#poc-から本番へ) を参照。

---

## 仕組み

```
Zoom  ──(WebSocket: my_notes.* イベント)──▶  listener ─▶ router ─▶ processor
                                                                    │
                          ユーザーの access token を更新 (PKCE) ◀──┤
                          GET /my_notes/notes/{id}/content     ────┤
                          生JSONを data/transcripts/ に保存     ◀──┘
```

役割が非対称なため、**別々の Zoom アプリが 2 つ**必要です。

| | **App A** — イベント受信 | **App B** — データ取得 |
| --- | --- | --- |
| 種別 | Server-to-Server OAuth | General App（**Public Client / PKCE**） |
| グラント | `client_credentials` | Authorization Code + PKCE |
| 用途 | WebSocket を開いてイベント受信 | 各ユーザーのメモ本文を取得 |
| トークン | アカウント単位の access token | **ユーザーごと**の refresh token |
| シークレット | Client ID **＋ Secret** | **Public Client ID のみ（secret 無し）** |

なぜ 2 つに分けるか：My Notes の本文は **メモ所有者本人の User-managed OAuth トー
クンでしか取得できません**（Admin/S2S トークンでは取得不可）。一方でイベント購読
はアカウント単位で、S2S アプリを使います。この非対称性が設計の核心です。

---

## 前提

- **Node.js 18 以上**（Node 22 で開発）。他のランタイムは不要です。
- [Zoom App Marketplace](https://marketplace.zoom.us/) で作成したアプリ 2 つ。
- OAuth リダイレクトが **ループバックアドレス（`127.0.0.1`）** なので、ngrok や公
  開エンドポイントは **不要** です。

---

## 1. Zoom アプリを 2 つ作成

### App A — Server-to-Server OAuth（WebSocket 購読）

1. Marketplace → **Develop → Build App → Server-to-Server OAuth**。
2. **Client ID** と **Client Secret** を控える。
3. **Feature → Event Subscription** で **WebSocket** 方式のサブスクリプションを
   追加し、My Notes 系イベントを購読：
   - *My Note generated*
   - *My Note transcript generated*
   - *Note completed*
4. その WebSocket サブスクリプションの **Subscription ID** を控える。

> WebSocket 用トークンは `client_credentials` グラント（Client ID/Secret の Basic
> 認証）で取得します。このグラントでは `account_id` は不要です。

### App B — General App（Public Client / PKCE、ユーザーごとの OAuth）

1. Marketplace → **Develop → Build App → General App**。
2. **OAuth** で **Public Client ID**（PKCE）を有効化。Public Client は
   **secret を持たず**、トークンエンドポイントには client id を **リクエストボディ**
   に入れ、PKCE の `code_verifier` を添えて呼び出します。
3. **OAuth Redirect URL** を RFC 8252 のループバックアドレスに設定：
   ```
   http://127.0.0.1/callback
   ```
   登録時はポート番号を省略できます。ループバックリダイレクトは host/path で照合
   され実行時ポートは任意なので、アプリが稼働ポート（例
   `http://127.0.0.1:3000/callback`）を自動で付与します。
4. スコープを追加：
   - `my_notes:read:content`
   - `docs:read:list_children`
5. **Public Client ID** を控える。

---

## 2. 環境変数を設定

テンプレートをコピーして値を記入：

```bash
cp .env.example .env
```

```ini
# --- App A: S2S OAuth (WebSocket subscription) ---
S2S_CLIENT_ID=            # App A の Client ID
S2S_CLIENT_SECRET=        # App A の Client Secret
WS_SUBSCRIPTION_ID=       # App A の WebSocket Subscription ID
WS_URL=wss://ws.zoom.us/ws

# --- App B: General App (Public Client / PKCE) ---
PUBLIC_CLIENT_ID=         # App B の Public Client ID（secret 無し）
OAUTH_REDIRECT_URI=http://127.0.0.1/callback

# --- Local ---
PORT=3000
DATA_DIR=./data
LOG_LEVEL=debug
```

---

## 3. インストール & 起動

```bash
npm install
npm start
```

`npm start` でオンボーディング用 HTTP サーバ（`127.0.0.1` にバインド）と WebSocket
リスナーが同時に起動します。正常起動時はコンソールに `ws.open` が出ます。ハート
ビートはミュートされます（ログファイルには残ります）。

---

## 4. メモ所有者をオンボーディング

文字起こしを保管したい **各ユーザー** について、そのユーザーでサインインしたブラ
ウザで connect URL を開き、同意します：

```
http://127.0.0.1:3000/connect
```

> 複数ユーザーを登録する場合はブラウザのプロファイル / シークレットウィンドウを
> 分けてください。サーバは `127.0.0.1` にバインドされているので、`localhost` では
> なく `127.0.0.1` を使ってください。

同意すると「Onboarded」画面が表示され、`data/tokens.json` にそのユーザーのメール
アドレスのエントリが追加されます。

## 5. メモを作成

オンボーディング済みユーザーとして Zoom ミーティング中に **My Notes** を作成・完了
します。Zoom が `my_notes.transcript_generated` を発火すると、アプリはそのユーザー
のトークンを更新し、メモ本文を取得して文字起こしをディスクに書き出します。

成功時のログは概ね次のようになります：

```
event.received  (my_notes.transcript_generated)
token.refresh_start → token.rotated → token.refresh_ok
api.fetch_start → api.fetch_ok
store.saved
```

---

## どこに何が保存されるか

| パス | 内容 |
| --- | --- |
| `data/tokens.json` | ユーザーごとの refresh token（使うたびにローテーション）。**機密 — gitignore 済み。** |
| `data/transcripts/{email}/{note_id}.json` | My Notes API のレスポンスを無加工で保存。再配信は上書きせずスキップ。 |
| `logs/raw-events.jsonl` | 受信した全 WebSocket メッセージを無加工で 1 行 1 JSON 記録。 |
| `logs/app.jsonl` | 構造化アプリログ（JSON Lines）。ハートビート/制御フレームもここには残るがコンソールには出さない。 |

保存される transcript の例：

```json
{
  "note_id": "…",
  "note_name": "…'s notes 2026-08-19 13:19(GMT+9:00)",
  "note_url": "https://…docs.zoom.us/doc/…",
  "manual_note_content": "",
  "generated_note_content": null,
  "transcript": {
    "items": [
      { "text": "…", "start_time": "…", "end_time": "…", "speaker_id": "1" }
    ]
  }
}
```

---

## 観測結果（検証で判明したこと）

- **実際に飛ぶイベント：** `my_notes.note_generated`（メモ作成時）と
  `my_notes.transcript_generated`（文字起こし準備完了時）。
  `my_notes.note_completed` は購読 UI にはあるが **発火は観測されなかった**。
- **取得トリガー：** `my_notes.transcript_generated` のみ。`note_generated` は
  文字起こし準備前に届き得るうえ、storage は `note_id` で重複排除するため、これで
  取得すると文字起こし無しのメモを保存して本命を取りこぼす。
- **WebSocket エンベロープ：** イベントは二重エンコードで届く —
  `{"module":"message","content":"<文字列化されたイベント JSON>"}`。制御フレームは
  `module: "heartbeat"` / `module: "build_connection"`。
- **イベント payload のフィールド：** `operator`（所有者メール）、`operator_id`、
  `account_id`、`object.note_id`、`object.note_link`、`object.meeting_id`、
  `event_ts`。

---

## セキュリティ

- App B は **Public Client** で、PKCE を使い **secret を持ちません**。refresh
  token は使うたびにローテーションされ、`data/` 以下に平文で保存されます（PoC のた
  め）。このディレクトリは絶対にコミットしないでください。
- 機密情報（client secret、access/refresh トークン）は **ログに出しません**。長さ
  だけを記録します。一方で Zoom から届いた生イベントデータは、観測のため全量記録
  します。

---

## トークンの扱い（refresh token のローテーション）

Zoom は **refresh token を使うたびにローテーション** します。更新のたびに新しい
refresh token が返り、直前のものは即座に無効化されます。新しい値を失うとそのユー
ザーは更新不能になり再オンボーディングが必要になるため、保存を最重要として扱います：

- ローテーションされた `refresh_token` は `data/tokens.json` に **アトミックに**
  書き込み（一時ファイル → `rename`）、その書き込みが成功するまで更新を完了扱いに
  しません。
- 同一ユーザーの更新は **直列化** します。同時に来た 2 つのイベントがそれぞれトー
  クンをローテーションして互いの結果を無効化する、という事故を防ぎます。
- `400 invalid_grant` を受けたらそのユーザーを `needs_reonboarding` にし、ログに残
  します。復旧はそのユーザーの `/connect` をやり直すことです。

> **未実装（PoC）：** アイドル状態のトークンを定期更新する *keep-alive*。Zoom は
> 長期間使われない refresh token を失効させるため、長寿命の本番運用ではスケジュー
> ル更新が必須です。短期の PoC では、失効したら再オンボーディングで対応します。

---

## PoC から本番へ

ここでのオンボーディングは **Public Client（PKCE）＋ ループバックリダイレクト
（`127.0.0.1`）** を使っています。ローカル PoC には最適（secret 管理不要・公開エン
ドポイント不要）ですが、これは **あくまで検証用の簡便手段** であり、実運用サービス
のユーザー認証の作法ではありません。本番実装では次の点が異なります：

- **サーバサイド OAuth（Confidential Client）。** App B を Confidential Client
  （**Client ID ＋ Client Secret**）として登録し、`http://127.0.0.1/callback` では
  なく **サーバがホストする HTTPS リダイレクト URL**（例
  `https://your-service.example.com/callback`）を使います。認可コード交換はサーバ
  側で Basic 認証（`client_id:client_secret`）で行い、secret をエンドユーザー端末に
  置きません。ループバック/PKCE はネイティブ/ローカルアプリ向けで、ホスト型サービ
  スが依存すべきものではありません。
- **allowlist フィルタリング。** 保管対象ユーザーの承認リスト（例：コーディネータ
  のメールアドレスの CSV/スプレッドシート）を管理し、各イベントで
  **`payload.operator` がリストに載っている場合のみ** 文字起こしを保管し、それ以外
  は捨てます。本 PoC は意図的に allowlist を省き、オンボーディング済みの全ユーザー
  を保管します。
- **refresh token の keep-alive。** アイドルなトークンを定期更新して失効を防ぎます
  （上記の節を参照）。
- **永続かつ保護されたストレージ。** ローカルディスクをクラウドオブジェクトストレ
  ージ（例：GCS）に置き換え、保存する refresh token を `data/` 以下の平文ではなく
  保存時暗号化します。
