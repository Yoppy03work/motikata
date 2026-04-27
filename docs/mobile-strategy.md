# モバイル化戦略メモ(2026-04-25 時点)

位置情報を活用したい(特にジオフェンス通知)が、Web/PWA だけでは原理的に不可能なため、ネイティブ化を検討する際の選択肢を整理。

## 動機

- 「家を出る前に持ち物リマインド」「大学に着いたら今日の授業チェックリスト表示」のような **位置をトリガーにした通知** が欲しい
- iOS Safari / Android Chrome の PWA はバックグラウンド位置取得が不可で、Geofencing API も実装されていない
- 現状: 位置情報は「ルート検索を起動するときだけ」(`navigator.geolocation` の単発呼び出し)で運用

## 案1: フル React Native 化

**概要**: スマホ版を完全に作り直し。Next.js は PC 版として残す。

- API は共有(認証だけ JWT に切り替え)
- 画面は全部 RN で再実装
- Geofencing は React Native 純正 / `react-native-background-geolocation` などで実装

| | |
| --- | --- |
| 工数 | 6〜8週間 |
| メリット | 純正のネイティブ UX、Geofencing API フル機能、長期的に安定 |
| デメリット | コード2重メンテ、機能追加が常に2倍コスト |

## 案2: Capacitor で Web をネイティブ包装(現時点の本命)

**概要**: 今の Next.js の画面をそのままモバイルアプリ化。位置情報まわりだけ Capacitor のプラグインで native 機能を呼ぶ。

- 既存の React コンポーネントをほぼ100%再利用
- Geofence は `@capacitor-community/background-geolocation` 等で実装
- UI 変更は Web 側 deploy だけで反映、native 部の変更時のみアプリ再ビルド

| | |
| --- | --- |
| 工数 | 2〜3週間 |
| メリット | 再利用性が高い、機能追加が一回で済む、Web も並行で進化できる |
| デメリット | (下記) |

### 案2 の具体的なデメリット

1. **WebView 性能** — ネイティブよりわずかに重い。スワイプ慣性やリストスクロールで違和感が出ることがある
2. **認証作り直し** — iron-session(Cookie)から JWT/Bearer に切り替え。CSRF Origin チェックも `capacitor://` を許容する形に調整。半日〜1日
3. **公開サーバー必須** — localhost ではダメ、HTTPS で外部公開必要(VPS / Cloud Run / Tailscale Funnel など)。月数百円〜
4. **App Store 配布の手間** — iOS は Apple Developer Program $99/年。個人利用だけなら TestFlight(90日制限)や AltStore で回避可
5. **更新が即時でなくなる** — Web 部は即時反映できるが、native 部分の変更はストア再配布
6. **iOS のバックグラウンド時間制約** — Geofence 自体は OS が監視するので問題なし。ただしトリガー後の処理は数秒〜10分以内
7. **コミュニティプラグイン依存** — Geofencing は公式プラグインがなく第三者ライブラリ。メンテ状況によるリスク少々

## 案3: 薄いネイティブ"コンパニオン"アプリ

**概要**: ネイティブアプリは「位置監視 → サーバ通知 → Web Push で PWA に返す」だけ。既存 Web は無修正。

| | |
| --- | --- |
| 工数 | 1〜2週間 |
| メリット | 最小工数、既存資産フル活用 |
| デメリット | ユーザーがアプリ2つ要(ネイティブ常駐 + PWA)、UI が分断 |

## 比較

| 観点 | 案1 | 案2 | 案3 |
| --- | --- | --- | --- |
| 工数 | 6〜8週 | 2〜3週 | 1〜2週 |
| UX | ◎ | ○ | △(2アプリ) |
| 機能追加コスト | 高(2重) | 低 | 中 |
| 個人利用ROI | △ | ◎ | ○ |

## 現時点の方針

- 位置情報は **「ルート検索」起動時の単発取得のみ** を実装(Web 内で完結)
- ジオフェンス通知が本当に必要になったら案2(Capacitor)で着手
- 案2に進むときの最小タスク:
  1. JWT 認証への移行
  2. CSRF Origin に `capacitor://localhost` を追加
  3. Capacitor インストールと iOS/Android プロジェクト生成
  4. Geofence プラグイン導入と権限フロー実装
  5. サーバー公開(Tailscale Funnel か小さい VPS)

## 関連

- 現状の認証: [src/lib/session.ts](../src/lib/session.ts), [src/lib/auth.ts](../src/lib/auth.ts)
- CSRF Origin チェック: [src/lib/csrf.ts](../src/lib/csrf.ts), [src/middleware.ts](../src/middleware.ts)
- Web Push 設定 (VAPID): `.env` の `VAPID_*`

## 保留: ルート検索 + 予定への移動時間追加

API キー(Google Cloud)対応が要るため後回し。再開時の手順:

1. Google Cloud プロジェクト作成 → Routes API 有効化 → API キー取得
2. `.env` に `GOOGLE_ROUTES_API_KEY` を追加(`.env.example` にもダミー追記)
3. `/api/routes/duration` を新設: 目的地と現在地を受け、Routes API で所要時間を返す。
   **API キーはサーバーから外に出さない**。Server Route 必須
4. `/route` ページを新設:
   - 目的地入力(将来「お気に入り保存」拡張可)
   - 到着希望時刻(`datetime-local`)
   - 「現在地を取得」ボタン(`navigator.geolocation`)
   - 「予定に追加」ボタンで `到着 − 所要時間` を `dueAt` にした EVENT 型 TaskInstance を作成
5. 取得した経路時間のキャッシュ戦略(同じ目的地への問い合わせを短時間で繰り返したくない)
6. 失敗時の手入力フォールバック(API エラー、現在地拒否などのケース)

代替案: API 不要で済ませたい場合は手入力 UI(目的地 + 到着時刻 + 所要時間を全部手で入れる)に縮退すれば即実装可能。
