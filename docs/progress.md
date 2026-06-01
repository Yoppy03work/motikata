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
  - iron-session 認証 + AES-256-GCM で manaba 認証情報を暗号化保管
  - VAPID Web Push + Service Worker (`/public/sw.js`)
  - cheerio で manaba をスクレイピング、pdfjs-dist で CIT 学年歴 PDF を解析
  - date-fns / date-fns-tz で全面 JST 統一
  - Tailwind v3 (`darkMode: "class"`)
  - Vitest, Docker Compose (postgres + web + worker), `concurrently` で `npm run dev`

---

## 実装済みの主要機能

### 認証 / セキュリティ
- [x] iron-session ベースのログイン
- [x] manaba パスワードを AES-256-GCM で暗号化して保存(GET ではマスク返却)
- [x] 匿名ユーザー向け HMAC 署名付き Cookie + Postgres 上の atomic UPSERT による Rate Limit
- [x] JOBS_TOKEN で保護された cron エンドポイント

### スケジューリング機能
- [x] 今日ページ (`/today`):「今日 → 明日の準備」の縦並び固定(夕方フリップ削除済み)
- [x] 「次の予定」Quick Answer カード(現在時刻以降の最初の OPEN を抽出)
- [x] 優先度ソート: HIGH → MID → LOW、同一優先度内は締切時刻順
- [x] 必須タスク / 任意タスク / 予定 (EVENT) の 3 グループ分け
- [x] スワイプ / 矢印キーでの前後日ナビゲーション (`SwipeNav`, `DateNav`)
- [x] カレンダー (`/calendar`) ±12 ヶ月のインジケータ表示
- [x] タスク一覧 (`/tasks`) 週次ビュー
- [x] FAB「+ 追加」シート(タスク / 予定の選択 → `TaskForm`)
- [x] 各カードクリックで詳細シート (`DayDetailSheet`)
- [x] メモ → タスク昇格フロー (`/memo`)

### CIT 連携
- [x] CIT 学年歴 PDF を pdfjs-dist で解析(休講判定: タイトルに「休講」を含む HOLIDAY のみ非授業日として扱う)
  - 5/23(成田山詣行脚)は授業日として扱う(以前は誤って除外していた)
  - `serverExternalPackages: ["pdfjs-dist"]` で SSR 時の `Object.defineProperty` エラーを回避
- [x] 授業日計算 + 時間割マスター (`/classes`) との突き合わせで授業インスタンス展開
- [x] 朝の自動展開 cron (`/api/jobs/expand-today`)

### manaba 連携
- [x] cheerio で `/ct/home_library_query` をスクレイピング
- [x] 列順固定で取得(td[0]=種別, td[1]=タイトル, td[2]=コース, td[4]=締切)
- [x] 「ドリル」種別はスキップ (`SKIP_TYPES`)
- [x] 部分日付("1/15")の年補完(現在年 → 過去なら来年)
- [x] 過去課題の取込み除外
- [x] 認証情報の保存 / 削除 / 同期 UI (`ManabaSettings`)

### 時間割 (`/classes`)
- [x] 月-土 × 1-10限のグリッド
- [x] 複数限の rowspan 連結
- [x] 持ち物 (`ChecklistTemplate`) 編集
- [x] PALETTE は **3 色** に統一(sky / slate / rose)

### 通知 / エスカレーション
- [x] VAPID Web Push 購読 (`PushSettings`)
- [x] Slack 通知(`dispatchReminders.ts`、絵文字なしの `[タグ] [優先 高] タイトル` 形式)
- [x] エスカレーション cron (`/api/jobs/escalate`)
- [x] 期限切れタスクのクリーンアップ cron (`/api/jobs/cleanup-past-tasks`)

### その他
- [x] タグ管理 (`TagSettings`、PRESET_COLORS は **3 色**: `#0ea5e9 / #64748b / #f43f5e`)
- [x] 完了ダッシュボード
- [x] 検索ページ (`/search`、絵文字 🔍 撤去済みで「検索」テキストのみ)
- [x] バックアップ機能
- [x] Vitest テスト
- [x] BottomNav: 今日 / カレンダー / タスク / メモ / 設定 の 5 タブ

---

## 直近の UI クリーンアップ(進行中)

### 絵文字を全削除
バルクで Python 正規表現置換し、空 `<span>` も後処理で除去:
- 📅 ✅ ◎ ☀ 🌙 🔔 🏫 📍 ⏰ 🔴 🟡 ⚪ 🔍 など全消し
- 検索ボタン: 🔍 → 「検索」
- カレンダー絵文字、優先度バッジの色丸など全削除
- Slack メッセージから絵文字を取り除き `[タグ] [優先 高]` 等のテキストラベルに統一

### カラーパレットを 3 色に縮小
sky / slate / rose のみ。Python スクリプトで以下 8 ファイルを一括置換:
- `AddFab.tsx` / `TaskForm.tsx` / `ManabaSettings.tsx` / `PushSettings.tsx`
- `AcademicImport.tsx` / `TodayItemCard.tsx` / `today/page.tsx` / `MemoClient.tsx`

マッピング:
- violet → sky
- emerald → sky
- amber → slate
- pink → sky
- indigo → sky
- teal → sky
- orange → slate
- cyan → sky
- red → rose

### 夕方フリップを削除
`EVENING_START_HOUR` 削除、`DayBlock` から `accent` prop を撤去。
「今日 → 明日の準備」の順を時間で入れ替えなくなった。

### ステータス
- `git status --short` 上で 14 ファイル変更あり(まだコミットしていない)
- `npx tsc --noEmit` / `npm run lint` 未実施
- コミット & push 未実施

---

## やっていないこと / 未着手 / 中断中

### 直前にユーザーから出た新規依頼(まだ未着手)
1. **繰り返しテンプレートを設定ページのボタンにする**
   - 現状 `src/app/(app)/settings/page.tsx` の「データ管理」セクションに `<a href="/templates">繰り返しテンプレート</a>` がリストアイテムとして埋まっているだけ
   - これを目立つカードボタンに昇格させる
2. **時間割タブを BottomNav に追加**
   - 現状 BottomNav は 5 タブ(今日 / カレンダー / タスク / メモ / 設定)
   - 6 タブ目として 時間割 (`/classes`) を追加する
   - レイアウト: 5 列 → 6 列に変更が必要(モバイル幅で崩れないか要確認)

### 中断したまま残っているクリーンアップ
- [ ] バルク置換後の型整合チェック(`accent: "sky" | "sky"` のような重複ユニオン型などの後処理が一部のみ)
- [ ] `npx tsc --noEmit` 実行で型エラーゼロ確認
- [ ] `npm run lint` 実行で lint エラーゼロ確認
- [ ] 絵文字 / カラー削減のコミット & push

### 未実装 or プレースホルダのまま
- [ ] `/templates` ページが placeholder のまま(繰り返しテンプレートの本実装)
- [ ] BottomNav に 6 列レイアウトを入れる場合の grid-cols-6 対応

---

## 次にやる順序(再開時のチェックリスト)

1. **クリーンアップ確定**
   - `npx tsc --noEmit` で型チェック
   - `npm run lint` で lint チェック
   - エラーがあれば修正
   - 絵文字 / カラー削減を 1 コミットにまとめて push
2. **繰り返しテンプレートを設定ページの目立つボタンに**
   - `src/app/(app)/settings/page.tsx` の「データ管理」リストから `/templates` リンクを取り出し、独立したカードボタンに変更
3. **BottomNav に 時間割 タブを追加**
   - `src/components/BottomNav.tsx` の `items` 配列に `{ href: "/classes", label: "時間割", Icon: ??? }` を追加
   - グリッドを 5 列 → 6 列に
   - `HIDDEN_PREFIXES` ("/classes" が含まれていたら除外する) との整合確認
4. **動作確認 → コミット**

---

## 主要ファイルマップ(参照用)

```
src/
├─ app/
│  ├─ (app)/
│  │  ├─ today/page.tsx        ... 今日ビュー(夕方フリップ削除済み)
│  │  ├─ calendar/page.tsx     ... ±12ヶ月カレンダー
│  │  ├─ tasks/page.tsx        ... タスク週次ビュー
│  │  ├─ memo/MemoClient.tsx   ... メモ → タスク昇格
│  │  ├─ classes/
│  │  │  ├─ page.tsx
│  │  │  └─ TimetableClient.tsx ... 時間割グリッド + 持ち物
│  │  ├─ templates/page.tsx    ... 繰り返しテンプレート(placeholder)
│  │  ├─ settings/
│  │  │  ├─ page.tsx           ... 設定トップ(/templates と /classes へのリスト)
│  │  │  ├─ ManabaSettings.tsx
│  │  │  ├─ PushSettings.tsx
│  │  │  ├─ TagSettings.tsx (PRESET_COLORS = 3色)
│  │  │  └─ AcademicImport.tsx
│  │  └─ search/page.tsx       ... 絵文字なし「検索」
│  └─ api/
│     └─ jobs/
│        ├─ expand-today/
│        ├─ escalate/
│        ├─ cleanup-past-tasks/
│        ├─ dispatch-reminders/
│        └─ manaba-sync/
├─ components/
│  ├─ BottomNav.tsx            ... 5 タブ(時間割追加が必要)
│  ├─ AddFab.tsx               ... + 追加 FAB
│  ├─ TaskForm.tsx
│  ├─ DayDetailSheet.tsx
│  └─ icons.tsx
└─ lib/
   ├─ dispatchReminders.ts     ... Slack メッセージ(絵文字なし)
   ├─ tz.ts                    ... APP_TZ = "Asia/Tokyo"
   ├─ today.ts                 ... getDayItems
   └─ indicators.ts            ... カレンダーインジケータ
```

---

最終更新: 中断時点の差分(14 ファイル) + この .md 追加。
```
```
