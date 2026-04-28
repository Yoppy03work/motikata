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
        }
      | null;
    if (
      json &&
      (json.sent ||
        json.failed ||
        json.skipped ||
        json.deleted)
    ) {
      const parts: string[] = [];
      if (json.examined !== undefined) parts.push(`examined=${json.examined}`);
      if (json.sent !== undefined) parts.push(`sent=${json.sent}`);
      if (json.failed !== undefined) parts.push(`failed=${json.failed}`);
      if (json.skipped !== undefined) parts.push(`skipped=${json.skipped}`);
      if (json.deleted !== undefined) parts.push(`deleted=${json.deleted}`);
      console.log(`[worker] ${label}: ${parts.join(" ")}`);
    }
  } catch (e) {
    console.error(`[worker] ${label} error:`, e instanceof Error ? e.message : e);
  }
}

// expand-today: 毎朝 05:00 JST(未実装。RECURRING / CLASS テンプレから今日のインスタンス展開)
cron.schedule(
  "0 5 * * *",
  async () => {
    console.log("[worker] expand-today fired");
  },
  { timezone: "Asia/Tokyo" },
);

// dispatch-reminders: 毎分。pending な Reminder を Slack に流す
cron.schedule("* * * * *", () => {
  void callJob("/api/jobs/dispatch-reminders", "dispatch-reminders");
});

// escalate: 毎朝 07:00 JST(未実装。前日の必須未完了を再リマインド)
cron.schedule(
  "0 7 * * *",
  async () => {
    console.log("[worker] escalate fired");
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
