# モチカタ 開発進捗まとめ

千葉工業大学の学生向けリマインダーアプリ「モチカタ」の開発進捗。
ここまでの会話で実装/対応した内容と、まだ手付かず or 中断した要素を一覧化する。

---

## アプリ概要

- **対象**: 千葉工業大学(CIT)の学生
- **目的**: 授業 / manaba 課題 / 自分で追加した予定タスクを一画面に集約し、リマインドする
- **構成**:
  - Next.js 15 (App Router) + React 19
  - Prisma + PostgreSQL
  - iron-session 認証 + AES-256-GCM で manaba / CIT ポータル認証情報を暗号化保管 (`CREDENTIAL_ENCRYPTION_KEY` は `SESSION_SECRET` と独立)
  - VAPID Web Push + Service Worker (`/public/sw.js`)
  - cheerio で manaba / CIT ポータル UPRX をスクレイピング、pdfjs-dist で CIT 学年歴 PDF を解析
  - date-fns / date-fns-tz で全面 JST 統一 (`formatInTimeZone(APP_TZ)`)
  - Tailwind v3 (`darkMode: "class"`)
  - Vitest, Docker Compose (postgres + web + worker), `concurrently` で `npm run dev`

---

## 実装済みの主要機能

### 認証 / セキュリティ
- [x] iron-session ベースのログイン
  - PIN 4 桁 (argon2) + Postgres `LoginAttempt` ベースの rate limit
  - 匿名ユーザー向け HMAC 署名付き Cookie (`SESSION_SECRET` で署名)
  - `SESSION_COOKIE_SECURE` env で Cookie の Secure フラグを切替 (HTTP ローカル docker 本番ビルド対応)
  - `NODE_ENV=production && SESSION_COOKIE_SECURE=false` 時は起動時に warn
- [x] manaba パスワード / CIT ポータル TOTP シークレットを AES-256-GCM で暗号化保存
  - 暗号鍵は専用 `CREDENTIAL_ENCRYPTION_KEY` (`SESSION_SECRET` 分離済み)
- [x] CSRF (Origin/Referer 検証) middleware (`/api/jobs/*` は除外)
- [x] JOBS_TOKEN で保護された cron エンドポイント

### スケジューリング機能
- [x] 今日ページ (`/today`): 「今日 → 明日の準備」縦並び固定
  - 「次の予定」Quick Answer カード(現在時刻以降の最初の OPEN を抽出)
  - 優先度ソート HIGH→MID→LOW、同一優先度内は締切時刻順
  - 必須タスク / 任意タスク / 予定 (EVENT) の 3 グループ分け
  - スワイプ / 矢印キー / DateNav チップで前後日ナビ
- [x] DateNav 上部日付ストリップ:
  - `useLayoutEffect` + `position: relative` で today を確実に中央寄せ
  - 初回 mount は instant、以降の `viewYmd` 変化は smooth
- [x] カレンダー (`/calendar`): ±12 ヶ月の月ビュー
  - Google カレンダー風カラーバー (青=予定 / 赤=必須 / 灰=任意)
  - 1 セル最大 3 件、超過は「+N 件」
  - サーバー側で MAX_BARS_PER_CELL 件まで切り詰めて payload 抑制 (hidden で正確な +N 維持)
  - kind 優先度ソート (event 最優先) で授業バーが押し出されない
  - バー空セルは indicators カウントからドット fallback
  - 日付タップ → `/today?date=YMD` 遷移
  - JST 00:00 跨ぎ + visibility change で `router.refresh` (cursor も同期)
- [x] タスク一覧 (`/tasks`) 週次ビュー
- [x] FAB「+ 追加」シート (`AddFab` → `TaskForm`)
  - 既存の `?date=` クエリから日付プレフィル
- [x] メモ → タスク昇格フロー (`/memo`)

### 時間割 (`/classes`)
- [x] 月-土 × 1-10限のグリッド
- [x] 複数限の rowspan 連結
- [x] 持ち物 (`ChecklistTemplate`) 編集
- [x] 前期 / 後期 セメスタトグル
- [x] 20 色カラーピッカー (講義カードの濃淡演出)
- [x] dayOfWeek 変更時に未来インスタンスを再 reconcile
- [x] 時間割同士の重なりを編集/作成 API で拒否

### CIT 連携
- [x] CIT 学年歴 PDF 解析 (pdfjs-dist + ① 円番号付き祝日)
  - 「休講」付き HOLIDAY のみ非授業日扱い (5/23 成田山詣行脚は授業日)
  - `serverExternalPackages: ["pdfjs-dist"]` で SSR `Object.defineProperty` エラー回避
- [x] 授業日計算 + 時間割マスター突合せで授業インスタンス展開
- [x] 朝の自動展開 cron (`/api/jobs/expand-today`)、今日 + 明日まで展開
- [x] **CIT ポータル時間割 SSO 同期** (Keycloak SAML IdP + TOTP)
  - credential picker (PatternFly tile) + autoLogin 中継ページ + menuForm ナビ
  - 35 秒間隔の throttle (TOTP replay 防止)
  - 1 日 3 回 (04:00 / 13:00 / 19:00 JST) の cron sync
  - `ClassSchedule.importedFrom='cit-portal'` 付きの行のみ全置換 (手入力は保護)
  - 空スクレイプ結果は拒否 (transient 失敗で全削除を防ぐ)
  - 同期失敗のロールバック / mutex

### manaba 連携
- [x] cheerio で `/ct/home_library_query` スクレイピング
- [x] 列順固定 (td[0]=種別, td[1]=タイトル, td[2]=コース, td[4]=締切)
- [x] 「ドリル」種別はスキップ
- [x] 部分日付 (`1/15`) の年補完 + 過去課題除外
- [x] live-keys スクレイピングで suspicious cancellation を拒否
- [x] 部分セメスタガード + atomic dispatch + ホールド処理

### 繰り返しテンプレート (`/templates`)
- [x] daily / weekly / monthly プリセット
- [x] RRULE サブセット (FREQ + BYDAY + BYMONTHDAY)
- [x] テンプレートからのインスタンス展開
- [x] `/settings` から目立つカードボタンとして導線

### 通知 / エスカレーション
- [x] VAPID Web Push 購読 (`PushSettings`)
  - subscribe 失敗時 rollback
  - QR コード読み取り (html5-qrcode + dynamic import)
- [x] Slack 通知 (`dispatchReminders.ts`、`[タグ] [優先 高] タイトル` 形式)
- [x] エスカレーション cron (`/api/jobs/escalate`)
- [x] 期限切れタスクのクリーンアップ cron

### その他
- [x] タグ管理 (`TagSettings`、PRESET_COLORS = 3 色)
- [x] 完了ダッシュボード
- [x] 検索ページ (`/search`)
- [x] バックアップ機能 (ignore で自身を除外)
- [x] Vitest テスト
- [x] BottomNav: 今日 / 時間割 / カレンダー / タスク / メモ / 設定 の 6 タブ
- [x] PWA アイコン (純 Node PNG generator)

### Google カレンダー連携 (Phase 1〜12 全マージ済み、2026-06-20)
全 28 PR (`#2`〜`#29`) を develop にマージ完了。OAuth + 同期 + 双方向書き戻し +
衝突解決 + ハードニングが揃った状態。
ユーザー側の **Google Cloud Console セットアップ** が完了すれば即連携開始可能
(`docs/google-calendar.md` 参照、`.env` に `GOOGLE_OAUTH_CLIENT_ID/SECRET/REDIRECT_BASE` を設定)。

- [x] **Phase 1**: OAuth (Authorization Code + offline) + GoogleCredential テーブル
      (`refreshTokenEnc` AES-256-GCM、`CREDENTIAL_ENCRYPTION_KEY` 派生) + primary calendar read-only sync
      + `/api/oauth/google/{authorize,callback,disconnect,status,sync-now}` + worker cron 5 分
- [x] **Phase 2**: 多カレンダー対応 (`GoogleCalendar` テーブル, per-calendar `syncToken`,
      `calendarList` upsert) + Google 色追従 (公式 colorId → hex 静的テーブル)
      + /settings カレンダー選択 UI + バー描画 inline `style.background` override
- [x] **Phase 3**: モチカタ → Google patch (`pushTaskInstanceToGoogle`) で
      title/notes/dueAt の write-back
- [x] **Phase 4**: events.insert (`POST /api/tasks` の `googleCalendarId`) +
      events.delete (`DELETE /api/tasks/[id]`) + `GoogleTombstone` 設計
- [x] **Phase 5 (UI)**: TaskForm の「保存先」ラジオ (モチカタのみ / Google: 各カレンダー)
- [x] **Phase 6**: 衝突解決 (etag/If-Match + tombstone TTL + cleanup cron + loop avoidance)
- [x] **Phase 7**: Phase 6 review (Claude high-recall 11 件) 反映
- [x] **Phase 8**: Phase 7 regression (Opus 4.8 review 5 件) 反映 — sync update payload を field 限定 +
      rollbackOrphan tombstone 先書き
- [x] **Phase 9**: Phase 8 regression (Opus 4.8 review 5 件) 反映 — rollbackOrphan を try/catch black hole +
      reviveFromSkipped を etag/updatedAt 必須に + cancelled 経路 updateMany 化
- [x] **Phase 10**: legacy NULL etag spurious revive を guard + `TRANSIENT_403_REASONS` dead entry 削除
- [x] **Phase 11**: notes null preservation + all-day event GET/preserve + Google raw error sanitize +
      route.ts named export 違反修正 (`GOOGLE_OAUTH_STATE_COOKIE` を lib に移設)
- [x] **Phase 12**: 403 transient メッセージング (`kind="transient"` 経路) + PII redaction (`redactSensitive`)

---

## 未着手 / 改善余地

### Google カレンダー連携の data model 限界 (Phase 13 候補)
- [ ] `TaskInstance.endAt` 追加で multi-day all-day Google event の保存
      (現状: dueAt + 1day で 1 日に collapse)
- [ ] all-day と timed の明示フラグ (現状: dueAt 00:00 JST 判定の heuristic)
- [ ] PATCH 経路の `googleConflict` を消費する UI (現状: response に乗せるだけ、消費先 UI 無し)
- [ ] read-only calendar 検出 (現状: 403 forbidden の延々再試行ループの可能性)

### Phase 6〜10 で acknowledged な低リスク trade-off (未対応)
- [ ] `count != changed` の metric 厳密性 (updateMany の matched count を加算しているので no-op write も updated++ になる)
- [ ] revive 経路で concurrent DELETE 発生時の observability gap (count=0 silent skip)
- [ ] 401/403 rollback orphan の phantom 取り込み (1 サイクル発生し得る — user manual delete で回復)
- [ ] cancelledThisRun ordering の counter 二重計上 (極稀)

### 運用安定化(継続)
- [ ] CIT ポータル同期成功率の監視 (lastError ベースのアラート? Slack 通知?)
- [ ] manaba スクレイピングのフォーマット変化検出強化
- [ ] 同期失敗時のユーザー導線 (再認証ボタン等)

### スタック PR の段階マージ運用
- [ ] PR #3 から順番にマージ (1 つマージするたびに GitHub が次の base を auto-update)
- [ ] 全部マージしたら feature/slack-and-day-detail-fix を develop にマージ (PR #2)

---

## 主要ファイルマップ(参照用)

```
src/
├─ app/
│  ├─ (app)/
│  │  ├─ today/
│  │  │  ├─ page.tsx              ... 今日ビュー
│  │  │  ├─ DateNav.tsx           ... 上部日付ストリップ (中央寄せ + useLayoutEffect)
│  │  │  ├─ SwipeNav.tsx
│  │  │  └─ TodayItemCard.tsx
│  │  ├─ calendar/
│  │  │  ├─ page.tsx              ... ±12 ヶ月 + getMonthlyEvents 並列フェッチ
│  │  │  └─ CalendarClient.tsx    ... 日タップ→/today, 深夜跨ぎ refresh
│  │  ├─ tasks/page.tsx
│  │  ├─ memo/MemoClient.tsx
│  │  ├─ classes/
│  │  │  ├─ page.tsx
│  │  │  └─ TimetableClient.tsx
│  │  ├─ templates/page.tsx       ... 繰り返しテンプレート(daily/weekly/monthly)
│  │  ├─ settings/
│  │  │  ├─ page.tsx
│  │  │  ├─ ManabaSettings.tsx
│  │  │  ├─ CitPortalSettings.tsx
│  │  │  ├─ PushSettings.tsx
│  │  │  ├─ TagSettings.tsx
│  │  │  └─ AcademicImport.tsx
│  │  └─ search/page.tsx
│  └─ api/
│     ├─ auth/
│     │  ├─ login/route.ts
│     │  └─ change-pin/route.ts
│     ├─ jobs/
│     │  ├─ expand-today/
│     │  ├─ escalate/
│     │  ├─ cleanup-past-tasks/
│     │  ├─ cleanup-google-tombstones/    ... Phase 6 で追加 (04:30 JST daily)
│     │  ├─ dispatch-reminders/
│     │  ├─ manaba-sync/
│     │  └─ sync-google/                  ... Phase 1 で追加 (5 分間隔)
│     ├─ cit-portal/
│     ├─ manaba/
│     ├─ templates/
│     ├─ google/
│     │  └─ calendars/                    ... GET 一覧 + POST [id]/toggle
│     └─ oauth/google/                    ... authorize / callback / status /
│                                              sync-now / disconnect
├─ components/
│  ├─ MonthCalendar.tsx           ... バー描画 + CellBars/CellDots + cursor 同期 +
│  │                                  events?: Record<ymd, MonthEventDay> 経由で
│  │                                  Google 色 inline style override
│  ├─ CalendarSheet.tsx           ... /today から開くドット mode 月ビュー
│  ├─ BottomNav.tsx               ... 6 タブ
│  ├─ AddFab.tsx                  ... + 追加 FAB (date プレフィル)
│  ├─ TaskForm.tsx                ... 「保存先」ラジオ (モチカタ / Google: 各カレンダー)
│  └─ icons.tsx
└─ lib/
   ├─ calendarConstants.ts        ... MAX_BARS_PER_CELL (中立 lib)
   ├─ cookieSecure.ts             ... Cookie Secure 解決 + prod warn
   ├─ session.ts                  ... iron-session 設定
   ├─ credentialKey.ts            ... CREDENTIAL_ENCRYPTION_KEY 派生 (共通)
   ├─ manabaCrypto.ts / citPortalCrypto.ts
   ├─ googleCrypto.ts             ... AES-256-GCM (DOMAIN="google-calendar")
   ├─ googleOAuth.ts              ... state HMAC + authorize URL + token 交換 + revoke +
   │                                  GOOGLE_OAUTH_STATE_COOKIE
   ├─ googleAccessToken.ts        ... access_token 取得 + refresh
   ├─ googleColors.ts             ... Google 公式 colorId → hex 静的テーブル
   ├─ googleCalendarSync.ts       ... events.list (incremental + 410 fallback) +
   │                                  tombstone + revive narrowing + loop avoidance
   ├─ googleCalendarWrite.ts      ... events.patch/insert/delete + If-Match etag +
   │                                  rollbackOrphan + redactSensitive logs
   ├─ citPortalSync.ts            ... SSO + scrape + 全置換 (空ガード付き)
   ├─ citPortalScrape.ts          ... UPRX HTML パーサ
   ├─ manabaSync.ts
   ├─ dispatchReminders.ts        ... Slack
   ├─ tz.ts                       ... APP_TZ = "Asia/Tokyo"
   ├─ today.ts                    ... getDayItems
   └─ indicators.ts               ... getMonthlyIndicators + getMonthlyEvents
                                      (Google 色を MonthEvent.color に流す)
```

---

最終更新: 2026-06-20。Google カレンダー連携 Phase 1〜12 を全 28 PR で develop にマージ完了、
develop tip = `46847ce`。本番ビルド + migration + smoke test 通過済み。ユーザー側の
Google Cloud Console セットアップ待ち。
