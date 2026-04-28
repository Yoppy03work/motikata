import cron from "node-cron";

console.log("[worker] starting — TZ=" + process.env.TZ);

const WEB_URL = process.env.WEB_URL ?? "http://localhost:3000";
const JOBS_TOKEN = process.env.JOBS_TOKEN;

if (!JOBS_TOKEN) {
  console.error("[worker] JOBS_TOKEN not set; dispatch will be skipped");
}

async function callJob(path: string, label: string): Promise<void> {
  if (!JOBS_TOKEN) return;
  const url = `${WEB_URL}${path}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${JOBS_TOKEN}` },
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
        json.scanned)
    ) {
      const parts: string[] = [];
      if (json.examined !== undefined) parts.push(`examined=${json.examined}`);
      if (json.classes !== undefined) parts.push(`classes=${json.classes}`);
      if (json.scanned !== undefined) parts.push(`scanned=${json.scanned}`);
      if (json.sent !== undefined) parts.push(`sent=${json.sent}`);
      if (json.failed !== undefined) parts.push(`failed=${json.failed}`);
      if (json.inserted !== undefined) parts.push(`inserted=${json.inserted}`);
      if (json.scheduled !== undefined) parts.push(`scheduled=${json.scheduled}`);
      if (json.skipped !== undefined) parts.push(`skipped=${json.skipped}`);
      if (json.deleted !== undefined) parts.push(`deleted=${json.deleted}`);
      console.log(`[worker] ${label}: ${parts.join(" ")}`);
    }
  } catch (e) {
    console.error(`[worker] ${label} error:`, e instanceof Error ? e.message : e);
  }
}

// expand-today: 毎朝 05:00 JST。今日の授業 (ClassSchedule × ClassDay) を
// TaskInstance に EVENT として展開し、持ち物 ChecklistTemplate を
// チェックリストとしてコピーする
cron.schedule(
  "0 5 * * *",
  () => {
    void callJob("/api/jobs/expand-today", "expand-today");
  },
  { timezone: "Asia/Tokyo" },
);

// dispatch-reminders: 毎分。pending な Reminder を Slack に流す
cron.schedule("* * * * *", () => {
  void callJob("/api/jobs/dispatch-reminders", "dispatch-reminders");
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

// cleanup-past-tasks + manaba-sync: 毎朝 04:00 JST。
// 順序:
//   1. cleanup で締切超過の TASK を消す
//   2. manaba-sync で未来の課題を取り直す
// (cleanup → sync の順は、消した直後に最新を取り直すため)
cron.schedule(
  "0 4 * * *",
  async () => {
    await callJob("/api/jobs/cleanup-past-tasks", "cleanup-past-tasks");
    await callJob("/api/jobs/manaba-sync", "manaba-sync");
  },
  { timezone: "Asia/Tokyo" },
);

process.on("SIGINT", () => {
  console.log("[worker] shutting down");
  process.exit(0);
});
