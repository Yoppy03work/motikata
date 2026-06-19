# Google カレンダー連携 設計

## ゴール

モチカタの月ビュー (`/calendar`) / 今日ページ (`/today`) で、Google カレンダーの予定もネイティブと同じ見た目 (バー + 色) で表示する。最終形は **双方向同期 + 多カレンダー + Google カラー追従**。実装は破壊的変更を避けるため Phase 1〜4 に分割する。

## スコープ判断

| 項目 | 採用 | 補足 |
|---|---|---|
| 同期方向 | 最終形は **双方向**。初期は Google → モチカタの片方向 | 双方向はループ・削除伝播・衝突解決が一気に複雑化するため Phase 3 以降 |
| 認証 | **Google OAuth 2.0** (refresh_token を `CREDENTIAL_ENCRYPTION_KEY` で暗号化) | ICS フィードは認可・write が無いので採用しない |
| カレンダー数 | **多カレンダー対応** (Phase 2 以降) | 1 ユーザー = 1 Google アカウント、その下に N 個のカレンダー |
| 色分け | **Google の color に追従** (Phase 2 以降) | Google Calendar API の `colorId` + Color Definitions API |

シングルユーザー前提 (`AppUser` が常に 1 行)、`singletonKey` パターンで持つ。

## Phase 計画

### Phase 1: OAuth + 単一カレンダー (read-only)

- **Prisma migration**: `GoogleCredential` テーブル
- **OAuth 2.0 (Authorization Code + offline)**:
  - `GET /api/oauth/google/authorize` → Google authorize URL に redirect
  - `GET /api/oauth/google/callback` → code 交換 → refresh_token を暗号化保存
- **同期ジョブ**: `worker` の cron に `syncGoogleCalendar` を追加 (5 分間隔)
  - access_token が期限切れなら refresh
  - `primary` カレンダー (= ログインアカウントの主カレンダー) を fetch
  - 取得した event を `TaskInstance` に upsert (`itemType=EVENT`, `source=GOOGLE`)
- **UI**: `/settings` に「Google カレンダー連携」セクション (連携 / 解除 / 最終同期時刻 / エラー表示)
- **表示**: 既存の `/calendar` `/today` がそのまま拾う (TaskInstance 経由)

✅ Phase 1 完了時点で「Google で作った予定がモチカタに出る」状態になる。

### Phase 2: 多カレンダー選択 + Google カラー追従

- **Prisma migration**:
  - `GoogleCalendar` テーブル (`externalId`, `summary`, `colorId`, `enabled`, `syncToken`)
  - `TaskInstance.googleCalendarId Int?` (どのカレンダー由来か)
  - `TaskInstance.color String?` (Google color hex を直接保持。`MonthEvent` 描画で参照)
- **API**:
  - `GET /api/google/calendars` → enable/disable トグル UI 用
  - 同期ジョブ拡張: 有効カレンダー全件 incremental sync (`syncToken` 利用)
- **MonthCalendar 描画**: `MonthEvent.color?: string` (hex) を受けて `style={{ background: color }}` でバー色を上書き

### Phase 3: モチカタ → Google 反映 (片方向の逆)

- **Prisma migration**:
  - `GoogleEventMap` テーブル (`googleCalendarId`, `externalEventId`, `taskInstanceId`, `etag`, `syncedAt`)
  - `@@unique([googleCalendarId, externalEventId])`
- **書き込みパス**:
  - `POST /api/tasks` で `source=GOOGLE_LOCAL`(新規 enum) のものは即時 Google API へ push
  - `PATCH /api/tasks/[id]` も同様 (etag で楽観ロック)
  - `DELETE /api/tasks/[id]` で Google 側 `events.delete`
- **書き込み元 (= 「モチカタで作って Google に押す」) の選択 UI**:
  - 追加 FAB に「Google に送る」トグル

### Phase 4: 双方向の運用ルール

- **衝突解決**: `updated` 時刻比較で **newer wins**。ただし削除は常に勝つ (tombstone)。
- **ループ回避**: Google 側 fetch 時に etag が一致したら skip (自分の書き込みが跳ね返ってきたケース)。
- **削除の伝播**: Google 側削除 → 対応 TaskInstance を `status=SKIPPED` ではなく実削除 (`source=GOOGLE`/`GOOGLE_LOCAL` のみ)。
- **障害対応**: refresh_token 失効時に UI に「再認証してください」を出す。

## Prisma スキーマ (Phase 1)

```prisma
model GoogleCredential {
  id                    Int       @id @default(autoincrement())
  // シングルユーザー前提のため固定値。upsert で使う。
  singletonKey          String    @unique @default("singleton")
  email                 String    // 認証済み Google アカウント
  // Authorization Code grant で取得した refresh_token を
  // CREDENTIAL_ENCRYPTION_KEY で AES-256-GCM 暗号化して保存。
  // (CIT/manaba と同じ方式。src/lib/credentialCrypto.ts を流用)
  encryptedRefreshToken String
  // Access token は短寿命 (~1h) なので生で持っても許容。
  // 期限を過ぎたら refresh_token から再発行する。
  accessToken           String?
  accessTokenExpiresAt  DateTime?
  // 認可されたスコープ (検証用。手動 revoke 等で剥がれたとき気付ける)
  scope                 String
  lastSyncAt            DateTime?
  lastError             String?
  createdAt             DateTime  @default(now())
  updatedAt             DateTime  @updatedAt
}
```

`TaskInstance.source` enum に `GOOGLE` を追加 (将来 `GOOGLE_LOCAL` も)。
`TaskInstance.sourceExternalId` に Google event id を入れる (既存フィールド流用)。

## API エンドポイント (Phase 1)

| メソッド | パス | 用途 |
|---|---|---|
| `GET` | `/api/oauth/google/authorize` | state 発行 + Google authorize URL に 302 redirect |
| `GET` | `/api/oauth/google/callback?code=...&state=...` | code 交換 → `GoogleCredential` 保存 → `/settings` に redirect |
| `POST` | `/api/oauth/google/disconnect` | `GoogleCredential` 削除 (token も Google 側で revoke) |
| `POST` | `/api/jobs/sync-google` | 内部 cron 用 (JOBS_TOKEN ガード)。最終同期時刻と件数を返す |
| `POST` | `/api/oauth/google/sync-now` | 手動同期トリガー (UI から) |

OAuth state は HMAC 署名付き Cookie (`mochikata_oauth_state`) に格納。一致しなければ callback を 400 で拒否。

## Sync 戦略 (Phase 1)

```
fetchPrimaryCalendar(refresh_token) {
  if (access_token expired || empty) {
    access_token = refreshAccessToken(refresh_token)
    save(access_token, expiresAt)
  }
  events = googleCalendar.events.list({
    calendarId: "primary",
    syncToken: prev_sync_token,        // 初回は timeMin = now - 30d
    showDeleted: true,
    singleEvents: true,                // 繰り返しを実体化
    orderBy: "startTime"
  })
  for ev of events:
    if (ev.status === "cancelled") {
      delete TaskInstance where sourceExternalId = ev.id
    } else {
      upsert TaskInstance {
        title: ev.summary
        dueAt: ev.start.dateTime ?? ev.start.date
        itemType: EVENT
        source: GOOGLE
        sourceExternalId: ev.id
        // notes に ev.description + ev.location を畳む
      }
    }
  save(nextSyncToken = events.nextSyncToken)
}
```

- **timeMin の初期値**: `now - 30 日`。それより前の予定は無視。
- **timeMax**: 未指定 (Google 側で繰り返しを展開する上限はサーバーまかせ。実体化済み event だけ返ってくる)。
- **エラー**: `410 Gone` (= syncToken 失効) なら state をリセットして次回フル同期。

## Google Cloud Console 設定手順 (ユーザー側作業)

> 全部無料枠で完結。所要 10〜15 分。

### 1. プロジェクト作成
1. [Google Cloud Console](https://console.cloud.google.com/) にログイン
2. 上部のプロジェクト選択 → 「新しいプロジェクト」
3. プロジェクト名: `mochikata-local` (好きな名前で OK)
4. 「作成」 → プロジェクトが選択された状態にする

### 2. Calendar API を有効化
1. ナビ左メニュー → 「API とサービス」→「ライブラリ」
2. 検索バーに `Google Calendar API` → 選択 → 「有効にする」

### 3. OAuth 同意画面を構成
1. 「API とサービス」→「OAuth 同意画面」
2. ユーザータイプ:
   - 個人 Gmail のみで使うなら **「外部」** で OK (テストユーザー上限 100 人だが個人なら十分)
   - Google Workspace アカウントなら **「内部」** で組織ドメイン限定にできる
3. アプリ名: `モチカタ (local)` など
4. ユーザーサポートメール: 自分の Gmail
5. デベロッパーの連絡先情報: 同上
6. スコープ画面: `auth/calendar` (`https://www.googleapis.com/auth/calendar`) を追加
7. テストユーザー: 自分の Gmail を追加 (外部の場合のみ)
8. 「保存して次へ」で最後まで進む

### 4. OAuth クライアント ID 作成
1. 「API とサービス」→「認証情報」
2. 上部「+ 認証情報を作成」→「OAuth クライアント ID」
3. アプリケーションの種類: **「ウェブ アプリケーション」**
4. 名前: `モチカタ Web`
5. 承認済みのリダイレクト URI に以下を追加:
   - `http://localhost:3000/api/oauth/google/callback`
   - (公開する場合は `https://your-domain/api/oauth/google/callback` も)
6. 「作成」→ クライアント ID と クライアントシークレットが表示される
7. 両方を控える

### 5. `.env` に追記
```bash
# Google Calendar 連携 (Phase 1)
GOOGLE_OAUTH_CLIENT_ID="..."
GOOGLE_OAUTH_CLIENT_SECRET="..."
# callback URL の origin。アプリの公開 URL と一致させる。
# 末尾スラッシュ無しで指定。
GOOGLE_OAUTH_REDIRECT_BASE="http://localhost:3000"
```

`.env.example` にも同 3 つを空値で追記する。

### 6. docker-compose 経由で env をコンテナに渡す
`docker-compose.yml` の `web` と `worker` 両方の `environment:` に追加:
```yaml
- GOOGLE_OAUTH_CLIENT_ID=${GOOGLE_OAUTH_CLIENT_ID}
- GOOGLE_OAUTH_CLIENT_SECRET=${GOOGLE_OAUTH_CLIENT_SECRET}
- GOOGLE_OAUTH_REDIRECT_BASE=${GOOGLE_OAUTH_REDIRECT_BASE}
```

設定が済んだら `docker compose up -d` で反映、`/settings` から「Google カレンダー連携」ボタンを押せば OAuth フローが始まる。

## セキュリティ要件

- `state` Cookie は HMAC 署名 (既存 `src/lib/anonId.ts` のパターンで `SESSION_SECRET` を流用)
- `refresh_token` は `CREDENTIAL_ENCRYPTION_KEY` で暗号化 (CIT/manaba と同じ `credentialCrypto.ts`)
- `access_token` はメモリ内のみ理想だが、worker と web で共有が必要なら DB に短寿命保存
- callback 完了後は `code` と `state` を含む URL を即座に history.replace で消す (`/settings` 遷移時に検証側でも生 URL を残さない)
- スコープは最小限の `https://www.googleapis.com/auth/calendar` (read + write 必要)。read-only 始めるなら `auth/calendar.readonly` で OK だが Phase 3 で剥がして取り直しが面倒なため最初から両用にする
- ユーザーが手動 revoke した場合の検出: 401/403 を受けたら `lastError` に記録し、UI に再認証導線を出す

## 未決事項 (Phase 設計で再検討)

- 削除の "tombstone" を Google 側で TTL する仕組みが無いので、ループ回避は etag + 「自分が書いたのと同じ updated 時刻なら skip」で対応
- 繰り返しイベント (`recurringEventId`) を実体化したとき、ユーザーが 1 つだけスキップしたとき (exception)、tutorial が要る
- カレンダーがアーカイブされた / ユーザーが Google 側でカレンダー自体を削除したケース: 次回 sync で 404 → `enabled=false` に倒す

## マイルストーン

| Phase | PR 想定 | ステータス |
|---|---|---|
| 1: OAuth + 単一カレンダー read-only | 1 PR (schema + route + cron + UI) | 未着手 |
| 2: 多カレンダー + 色追従 | 1 PR (schema migration + UI + 描画) | 未着手 |
| 3: モチカタ → Google 書き込み | 1 PR (mapping + write paths) | 未着手 |
| 4: 双方向運用ルール | 1 PR (衝突解決 + tombstone + UI ガード) | 未着手 |
