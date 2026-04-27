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
      | { sent?: number; failed?: number; skipped?: number; examined?: number }
      | null;
    if (json && (json.sent || json.failed || json.skipped)) {
      console.log(
        `[worker] ${label}: examined=${json.examined ?? 0} sent=${json.sent ?? 0} failed=${json.failed ?? 0} skipped=${json.skipped ?? 0}`,
      );
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

process.on("SIGINT", () => {
  console.log("[worker] shutting down");
  process.exit(0);
});
