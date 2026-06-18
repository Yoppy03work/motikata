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

---

## 進行中 (open PR)

### feature/slack-and-day-detail-fix → develop (PR #2)
ベースの大型 feature ブランチ。Slack 配送 + DayDetailSheet DONE フィルタ。以下のスタック PR を順次マージして取り込む想定。

### 高 recall レビュー (15 件中 11 件) → 個別 PR スタック
[d7217a1..feature ブランチ tip] のレビューを元に、各指摘を個別 PR 化。マージ順は **#3 → #4 → #5 → #6 → #7 → #8 → #9 → #14 → #15 → #16**。

| # | レビュー | 種類 | 内容 |
|---|---|---|---|
| #3 | [12] | 🔴 fix | event バー優先ソート |
| #4 | [2] | 🔴 fix | バー空のときドット fallback |
| #5 | [7] | 🔴 fix | JST 0 時跨ぎ refresh + cursor 同期 + mount 時 staleness check |
| #6 | [4] | 🟢 cleanup | `resolveCookieSecure()` 共通化 |
| #7 | [15] | 🟢 cleanup | `formatInTimeZone(APP_TZ)` 統一 |
| #8 | [1] | 🟢 cleanup | Tailwind `pb-1`/`pb-3` 衝突解消 |
| #9 | [8] | 🟢 cleanup | `CellBars`/`CellDots` 抽出 |
| #14 | [10][14] | 🟡 perf | 1日 events をサーバー側 cap (hidden 集約) + MAX_BARS_PER_CELL を中立 lib に移設 (P1) |
| #15 | [13] | 🟡 cleanup | prod + `SECURE=false` で起動時 warn |
| #16 | — | 📝 docs | Google カレンダー連携の Phase 設計ドキュメント |

レビュー指摘で Skip 判定:
- [3] `useLayoutEffect` SSR フラッシュ(CSS だけで解決困難、現状受容)
- [5] sub-second 精度 (旧コードと同じ)
- [6] DayDetailSheet 撤去 (ユーザー要望通り)
- [9] hasInitialCentered ref race (極稀)
- [11] indicators/events 2 query 間 race (極稀、影響軽微)

### Codex 自動レビュー対応 (個別)
| # | 内容 |
|---|---|
| #10 | viewDate を `formatInTimeZone(APP_TZ)` で整形 |
| #11 | AddFab で `?date=` クエリから日付プレフィル |
| #12 | dayOfWeek 変更時に未来インスタンスを reconcile |
| #13 | 時間割編集/作成で既存スロットとの重なりを拒否 |

---

## やっていないこと / 未着手

### Google カレンダー連携 (Phase 設計済み、`docs/google-calendar.md`)
- [ ] **Phase 1**: OAuth + 単一カレンダー read-only
  - GoogleCredential テーブル (refresh_token を `CREDENTIAL_ENCRYPTION_KEY` で暗号化)
  - `/api/oauth/google/{authorize,callback,disconnect,sync-now}`
  - worker cron に `syncGoogleCalendar` (5 分間隔、syncToken incremental + 410 で full)
  - /settings 連携 UI
  - **着手前にユーザーが Google Cloud Console で OAuth クライアント作成必要** (手順は `docs/google-calendar.md`)
- [ ] **Phase 2**: 多カレンダー選択 + Google 色追従
- [ ] **Phase 3**: モチカタ → Google 書き込み (GoogleEventMap)
- [ ] **Phase 4**: 衝突解決 / 双方向運用ルール (etag + newer wins)

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
│     │  ├─ dispatch-reminders/
│     │  └─ manaba-sync/
│     ├─ cit-portal/
│     ├─ manaba/
│     └─ templates/
├─ components/
│  ├─ MonthCalendar.tsx           ... バー描画 + CellBars/CellDots + cursor 同期
│  ├─ CalendarSheet.tsx           ... /today から開くドット mode 月ビュー
│  ├─ BottomNav.tsx               ... 6 タブ
│  ├─ AddFab.tsx                  ... + 追加 FAB (date プレフィル)
│  ├─ TaskForm.tsx
│  └─ icons.tsx
└─ lib/
   ├─ calendarConstants.ts        ... MAX_BARS_PER_CELL (中立 lib)
   ├─ cookieSecure.ts             ... Cookie Secure 解決 + prod warn
   ├─ session.ts                  ... iron-session 設定
   ├─ credentialCrypto.ts         ... AES-256-GCM (CIT/manaba 共有、将来 Google も)
   ├─ citPortalSync.ts            ... SSO + scrape + 全置換 (空ガード付き)
   ├─ citPortalScrape.ts          ... UPRX HTML パーサ
   ├─ manabaSync.ts
   ├─ dispatchReminders.ts        ... Slack
   ├─ tz.ts                       ... APP_TZ = "Asia/Tokyo"
   ├─ today.ts                    ... getDayItems
   └─ indicators.ts               ... getMonthlyIndicators + getMonthlyEvents
```

---

最終更新: 2026-06-18。レビュー対応 9 PR スタック + Google 連携設計ドキュメント追加直後。
