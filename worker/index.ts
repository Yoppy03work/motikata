import cron from "node-cron";

console.log("[worker] starting — TZ=" + process.env.TZ);

const WEB_URL = process.env.WEB_URL ?? "http://localhost:3000";
const JOBS_TOKEN = process.env.JOBS_TOKEN;

if (!JOBS_TOKEN) {
  console.error("[worker] JOBS_TOKEN not set; dispatch will be skipped");
}

// 各 job に共通の最大実行時間。これを超えたら AbortController で打ち切る。
// 設定理由: web 側が固まった時に in-flight ガード(dispatchInFlight 等)が
// 永久に true のまま残ると以後の cron tick がスキップされ続け、通知が止まる。
// CIT portal sync など SSO 経由の重い処理は別途 maxDuration を 120s に
// 拡張してあるので、worker 側は余裕を持って 180s。
const JOB_TIMEOUT_MS = 180_000;

async function callJob(path: string, label: string): Promise<void> {
  if (!JOBS_TOKEN) return;
  const url = `${WEB_URL}${path}`;
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), JOB_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${JOBS_TOKEN}` },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[worker] ${label} failed: ${res.status} ${body.slice(0, 200)}`);
      return;
    }
    const json = (await res.json().catch(() => null)) as
      | {
          sent?: number;
          failed?: number;
          skipped?: number;
          examined?: number;
          deleted?: number;
          inserted?: number;
          classes?: number;
          scheduled?: number;
          scanned?: number;
          replaced?: number;
          isClassDay?: boolean;
        }
      | null;
    if (
      json &&
      (json.sent ||
        json.failed ||
        json.skipped ||
        json.deleted ||
        json.inserted ||
        json.classes ||
        json.scheduled ||
        json.scanned ||
        json.replaced)
    ) {
      const parts: string[] = [];
      if (json.examined !== undefined) parts.push(`examined=${json.examined}`);
      if (json.classes !== undefined) parts.push(`classes=${json.classes}`);
      if (json.scanned !== undefined) parts.push(`scanned=${json.scanned}`);
      if (json.sent !== undefined) parts.push(`sent=${json.sent}`);
      if (json.failed !== undefined) parts.push(`failed=${json.failed}`);
      if (json.inserted !== undefined) parts.push(`inserted=${json.inserted}`);
      if (json.scheduled !== undefined) parts.push(`scheduled=${json.scheduled}`);
      if (json.replaced !== undefined) parts.push(`replaced=${json.replaced}`);
      if (json.skipped !== undefined) parts.push(`skipped=${json.skipped}`);
      if (json.deleted !== undefined) parts.push(`deleted=${json.deleted}`);
      console.log(`[worker] ${label}: ${parts.join(" ")}`);
    }
  } catch (e) {
    if (ctrl.signal.aborted) {
      console.error(
        `[worker] ${label} timed out after ${JOB_TIMEOUT_MS}ms`,
      );
    } else {
      console.error(`[worker] ${label} error:`, e instanceof Error ? e.message : e);
    }
  } finally {
    clearTimeout(timeout);
  }
}

// expand-today: 毎朝 05:00 JST + 夕方 17:00 JST + 23:00 JST。
// 今日の授業 (ClassSchedule × ClassDay) を TaskInstance に EVENT として
// 展開し、持ち物 ChecklistTemplate をチェックリストとしてコピーする。
// /api/jobs/expand-today は既定で「今日 + 明日」の 2 日分を展開するので、
// 17:00 / 23:00 の tick で「翌日の準備」がカレンダーに事前に並ぶ。
//
// 複数 tick を置く理由:
//   - 05:00 で web 側が固まる / DB が瞬断する / worker が再起動中 だと
//     その日の授業が一度も TaskInstance 化されないまま終わる事故が起きる。
//   - expandToday は冪等(同じ class:<id>:<ymd> は (source, sourceExternalId)
//     ユニーク制約で skipped 集計)なので何度叩いても安全。
//   - 17:00 ティックは「翌日の準備」用途的にも合理的なタイミング。
//   - 23:00 ティックは日付境界直前のセーフティネット。
const expandTodaySchedule = "0 5,17,23 * * *";
cron.schedule(
  expandTodaySchedule,
  () => {
    void callJob("/api/jobs/expand-today", "expand-today");
  },
  { timezone: "Asia/Tokyo" },
);
// 起動時にも 1 回呼ぶ。worker が朝の cron tick を寝過ごしたまま再起動
// された場合の catch-up。expandToday は冪等なので空打ちでも害は無い。
// callJob 自体が JOBS_TOKEN 未設定なら no-op するので、ローカル開発で
// JOBS_TOKEN を設定していない環境でも安全。
void callJob("/api/jobs/expand-today", "expand-today (startup catch-up)");

// dispatch-reminders: 毎分。pending な Reminder を Slack/Push に流す。
// 直前の実行が 60 秒以上かかると次の cron tick が重なり、同じ PENDING 行を
// 別呼び出しが拾って二重通知になる可能性がある。in-flight ガードで
// 重複起動をスキップする(API 側にも atomic claim を入れているが二段防御)。
let dispatchInFlight = false;
cron.schedule("* * * * *", () => {
  if (dispatchInFlight) {
    console.log("[worker] dispatch-reminders: previous run still in flight, skipping");
    return;
  }
  dispatchInFlight = true;
  void callJob("/api/jobs/dispatch-reminders", "dispatch-reminders").finally(() => {
    dispatchInFlight = false;
  });
});

// escalate: 毎朝 07:00 JST。
// 当日中(同日)に締切がある status=OPEN な TASK に対して
// 即時発火 Reminder (PUSH) を作成する。dispatchReminders が拾って実送信する
cron.schedule(
  "0 7 * * *",
  () => {
    void callJob("/api/jobs/escalate", "escalate");
  },
  { timezone: "Asia/Tokyo" },
);

// cleanup-past-tasks + manaba-sync + cit-portal-sync: 毎日 04:00 / 13:00 / 19:00 JST の 3 回。
// 順序:
//   1. cleanup で締切超過の TASK を消す
//   2. manaba-sync で未来の課題を取り直す
//      (cleanup → sync の順は、消した直後に最新を取り直すため)
//   3. cit-portal-sync で時間割(ClassSchedule)を全置換
// 注意: cit-portal-sync は同期内で 1 回 SSO+MFA する。1 日 3 回ログインは
//       同一 IP からの連続アクセスとして検知対象になる可能性がある(様子見)。
cron.schedule(
  "0 4,13,19 * * *",
  async () => {
    await callJob("/api/jobs/cleanup-past-tasks", "cleanup-past-tasks");
    await callJob("/api/jobs/manaba-sync", "manaba-sync");
    await callJob("/api/jobs/cit-portal-sync", "cit-portal-sync");
  },
  { timezone: "Asia/Tokyo" },
);

// sync-google: 5 分間隔で Google カレンダー → モチカタ取り込み (Phase 1)。
// incremental sync (syncToken) なので 1 回あたりの転送量は少ない。
// 未連携の場合はサーバー側で skip 扱い(error にならない)。
cron.schedule(
  "*/5 * * * *",
  () => {
    void callJob("/api/jobs/sync-google", "sync-google");
  },
  { timezone: "Asia/Tokyo" },
);

process.on("SIGINT", () => {
  console.log("[worker] shutting down");
  process.exit(0);
});
