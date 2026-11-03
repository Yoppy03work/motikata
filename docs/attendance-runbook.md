# 出席機能 運用手順書 (attendance runbook)

モチカタの CIT ネイティブ出席機能を、学内で実際に動かすための手順。
コード変更は不要で、ここに書くのは **設定 (env) と操作だけ**。実装の背景は
`src/lib/attendance/` と PR #58〜#60 を参照。

> **大前提（安全設計）**
> - 出席は実システム (`attendance.is.chibatech.ac.jp`) に送信する高リスク操作。
> - 既定は **confirm (確認して送信)**。auto は **開発者コードを入れない限り永久にロック** (fail-closed)。
> - QR 文字列・CIT 認証情報・出席システムの HTML は **絶対にログ/例外に出さない**。
>   この手順でもそれらを `echo`/`cat`/貼り付けで表に出さないこと。

---

## 0. 3 つのモード

設定画面 (設定 → 出席モード) で選ぶ。

| モード | 画面ラベル | 実送信 | いつ送るか |
| --- | --- | --- | --- |
| manual | 手動 | **しない** | 自分で「手動で済みに」を押す（ローカル記録だけ） |
| confirm | 確認して送信 | する | 今日ページで「出席する (QR)」→ QR スキャン時に送信 |
| auto | 自動 (開発者向け) | する | 出席ウィンドウに入ると worker が毎分チェックして自動送信 |

既定は **confirm**。auto は開発者コード (`ATTENDANCE_AUTO_DEV_CODE`) が設定され、
かつ設定画面でそのコードを入力したときだけ有効になる。

---

## 1. 前提条件（共通）

1. **CIT 認証情報の登録**：設定画面の CIT ポータル連携で username / password を登録済み。
   （出席は既存の CIT 認証情報をそのまま使う。未登録だと今日ページに登録を促すヒントが出る。）
2. **学内ネットワーク**：出席システムは学内網からのみ到達可能。送信する端末（＝モチカタの
   web コンテナが動くホスト）が CIT_Wi-Fi など学内網にいること。学外からは `fetch` が失敗する。
3. **授業ウィンドウ**：confirm/auto とも、授業の開始時刻を基準にした時間ウィンドウ内でだけ送れる
   （時間外は「時間外」表示でボタンが無効）。

---

## 2. confirm の実動確認（フェーズ B-1：まずこれ）

**目的**：実システムへの 1 回の実送信が、教室で正しく通ることを確認する。

1. 設定画面でモードを **確認して送信 (confirm)** にする。
2. 対象の授業の **開始時刻前後（授業ウィンドウ内）** に、教室で **今日ページ**を開く。
   - 対象授業ブロックに「**出席する (QR)**」ボタンが出て、状態が「出席できます」になっていること
     （「時間外」ならまだウィンドウ外）。
3. 「出席する (QR)」→ 教室に掲示された QR を **html5-qrcode** スキャナで読む。
4. 成功すると「**〇〇 の出席を送信**」の完了表示が出て、状態が「**出席済み**」になる。
5. **確認ポイント**
   - 画面が「出席済み」になった。
   - `AttendanceLog` に `method=confirm, status=success` の行が 1 件できている（確認方法は §4）。
   - 同じ授業でもう一度押しても二重送信にならない（`already_submitted` で弾かれる）。
6. **うまくいかないとき** → §5 トラブルシュート。すぐ元に戻すなら設定を **手動 (manual)** にする
   （manual は一切実送信しない安全側）。

> confirm が 1 回でも学内で通れば、出席エンジン（login → class_room → attend）は
> 実機で動作している、ということ。auto に進む前にここを必ず通す。

---

## 3. auto の段階解禁（フェーズ B-2：confirm が通ってから）

auto は「時間に教室にいなくても QR さえ読めば送れる」= 代返と見なされうる最高リスク。

> **QR なしで送信**（設定 › 出席 のスイッチ）がオンなら、auto でも全授業で QR を読まずに
> 時間割の教室から作った教室番号で送る（開始 5 分前 ±2 分）。オフなら今までどおり当日の QR が必要。
> 監査ログには `metadata.via = "no_qr"` が残る。
必ず **①開発者コードで解禁 → ②ドライラン → ③実送信** の順で、1 段ずつ確認する。

### 3-1. 開発者コードを設定（サーバ側）

1. 十分に長いランダム値を用意する（例: `openssl rand -hex 24`）。これを秘密情報として扱う。
2. ホストの `.env` に設定する（`.env.example` の該当行を参照）。

   ```dotenv
   ATTENDANCE_AUTO_DEV_CODE="（↑で作ったランダム値）"
   ATTENDANCE_AUTO_DRY_RUN="true"   # ← 最初は必ずドライラン
   ```

3. web コンテナに反映（env はコンテナ作成時に読まれるので再作成する）：

   ```sh
   docker compose up -d --no-build web
   ```

   `--no-build` は「env を変えただけなのでイメージは再生成せず、既存イメージで
   コンテナだけ作り直す」ため。イメージのビルドは別途 `docker build` で行う運用。

   - これで設定画面の auto が「コード未設定」から選べる状態になる。
   - 逆に、この env を **空に戻して `docker compose up -d --no-build web`** すれば auto は即ロック（緊急停止の一つ）。

### 3-2. 設定画面で解禁

1. 設定 → 出席モードで **自動 (開発者向け)** を選ぶ → コード入力欄が開く。
2. 3-1 で決めた開発者コードを入力して確定。
   - 一致すれば `autoUnlocked=true` が保存され、ラベルが「**・解禁済み**」になる。
   - 不一致は 403 (`bad_dev_code`)、未設定なら 403 (`auto_locked`)。
3. **重要**：モードを confirm/manual に戻すと `autoUnlocked` は false にリセットされる
   （再び auto にするには再度コード入力が必要）。

### 3-3. ドライラン確認（実送信しない）

`ATTENDANCE_AUTO_DRY_RUN="true"` の間、worker の毎分 tick は全ガードを通すが
**adapter は呼ばず**、監査ログに `post_attempt / reason: "dry-run (no external send)"` を残すだけ。

- worker tick が動いているかはジョブログで確認（空振りの分は PR #60 以降ログに出ない）：

  ```sh
  docker compose exec worker tail -n 50 /app/logs/jobs.log
  ```

- 授業ウィンドウ内に入ったとき、監査ログ (`AttendanceAuditLog`) に
  `phase=post_attempt / reason="dry-run (no external send)"` が **1 行だけ**出る
  （実送信の `pre_attempt` は書かれない）。`AttendanceLog` に **success が増えない**
  ことを確認（＝実送信していない）。確認方法は §4。
- 想定どおりの動き：ドライランは送信予約 (claim) をしないので、ウィンドウにいる間は
  **毎分** 監査ログが 1 行増え、ジョブログにも `attempted=1` が出続ける（`AttendanceLog`
  は増えないまま）。これは正常で、実送信していないことの裏返し。確認できたら次へ。

### 3-4. 実送信へ（ドライラン解除）

ドライランで狙った授業・時刻だけ拾えていると確認できたら：

```dotenv
# ATTENDANCE_AUTO_DRY_RUN=   # 空/false/0/no のいずれかで実送信
```

```sh
docker compose up -d --no-build web
```

次の授業ウィンドウで、auto が実送信し `AttendanceLog(method=auto, status=success)` と
監査 `post_attempt` が記録される。

### 3-5. 緊急停止（どれでも可）

- 設定を **confirm / manual** に戻す（`autoUnlocked` が落ち、auto 実行が止まる）。
- `ATTENDANCE_AUTO_DRY_RUN="true"` に戻して `docker compose up -d --no-build web`（送らなくなる）。
- `ATTENDANCE_AUTO_DEV_CODE=""` にして `docker compose up -d --no-build web`（auto を恒久ロック）。

---

## 4. 記録の確認方法（AttendanceLog / AttendanceAuditLog）

管理 UI は無いので DB を直接見る。**creds や QR はログに出さない**方針なので、監査ログにも
秘密は入っていない（授業・時刻・phase のみ）。

- Prisma Studio（手元で見るのが楽）：

  ```sh
  npx prisma studio
  ```

  `AttendanceLog`（classScheduleId / classDate / method / status / attemptedAt）と
  `AttendanceAuditLog`（phase / reason / 時刻）を開く。

- psql で直接：

  ```sh
  # $POSTGRES_USER/$POSTGRES_DB はコンテナ内で展開させる (手元シェルでは空になる)。
  docker compose exec postgres sh -c \
    'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "select \"classScheduleId\",\"classDate\",method,status,\"attemptedAt\" from \"AttendanceLog\" order by \"attemptedAt\" desc limit 20;"'
  ```

状態の意味：`pending`=送信中 / `success`=成功 / `failed`=失敗 / `manual`=手動記録のみ。

---

## 5. トラブルシュート

| 症状 | 原因 | 対応 |
| --- | --- | --- |
| 送信が失敗する（confirm/auto） | 学外ネットワーク、または出席システム側の障害 | 学内網 (CIT_Wi-Fi) にいるか確認。`AttendanceLog.status=failed` が残る |
| ボタンが「時間外」で押せない | 授業ウィンドウ外 | 開始時刻前後のウィンドウ内に入ってから。時間割の `startTime` が正しいか確認 |
| 「出席済み」で押せない | 同じブロックで送信済み | 仕様（二重送信防止）。再送は不要 |
| QR を読んでも弾かれる | QR の教室 (roomId) が今日の授業と一致しない | 正しい教室の QR か確認（例 731 講義室=`7301`、一方向畳み込みで照合） |
| 今日ページに登録ヒントが出る | CIT 認証情報 未登録 | 設定の CIT ポータル連携で登録 |
| auto が選べない（コード未設定） | `ATTENDANCE_AUTO_DEV_CODE` 未設定 | §3-1 で設定して `docker compose up -d --no-build web` |
| auto 解禁したのに送らない | ドライラン中 / ウィンドウ外 / mode が auto でない | §3-3〜3-4。`ATTENDANCE_AUTO_DRY_RUN` と mode・`autoUnlocked` を確認 |

---

## 6. 関連ファイル

- 出席ロジック: `src/lib/attendance/{http,service,confirm-guard,auto-guard,room-normalize,qr,blocks,rollout,settings,time}.ts`
- API: `src/app/api/attendance/{submit,manual,today,settings,qr-validate}/route.ts`, `src/app/api/jobs/attendance-tick/route.ts`
- UI: `src/app/(app)/today/TodayAttendance.tsx`, `src/app/(app)/settings/AttendanceSettings.tsx`
- worker cron: `worker/index.ts`（毎分 `/api/jobs/attendance-tick`）
- env: `.env.example` の「出席 (CIT native)」セクション
  - `ATTENDANCE_AUTO_DEV_CODE`（auto 解禁コード。空=永久ロック）/ `ATTENDANCE_AUTO_DRY_RUN`（ドライラン弁）
  - `ATTENDANCE_BASE_URL`（出席ホスト。空/未設定なら chibatech）/ `ATTENDANCE_QR_ALLOWED_HOST_SUFFIXES`（QR 許可ホスト。空なら既定 .cit/.chibatech/.it-chiba）
