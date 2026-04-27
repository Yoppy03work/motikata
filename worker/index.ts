import cron from "node-cron";

console.log("[worker] starting — TZ=" + process.env.TZ);

// expand-today: 毎朝 05:00 JST
cron.schedule(
  "0 5 * * *",
  async () => {
    console.log("[worker] expand-today fired");
  },
  { timezone: "Asia/Tokyo" },
);

// dispatch-reminders: 毎分
cron.schedule("* * * * *", async () => {
  // noop for now
});

// escalate: 毎朝 07:00 JST
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
