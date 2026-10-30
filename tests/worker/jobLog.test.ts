import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { appendJobLog } from "../../worker/jobLog";

const NOW = new Date("2026-10-30T04:00:00Z");

describe("appendJobLog", () => {
  it("1 job を 1 行で追記する", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "joblog-"));
    appendJobLog("manaba-sync", "ok", "inserted=2", dir, NOW);
    appendJobLog("manaba-sync", "error", "fetch\nfailed", dir, NOW);
    expect(readFileSync(path.join(dir, "jobs.log"), "utf8")).toBe(
      "2026-10-30T04:00:00.000Z manaba-sync ok inserted=2\n" +
        "2026-10-30T04:00:00.000Z manaba-sync error fetch failed\n",
    );
  });

  it("1MB を超えたら jobs.log.1 に退避する", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "joblog-"));
    writeFileSync(path.join(dir, "jobs.log"), "x".repeat(1024 * 1024));
    appendJobLog("escalate", "ok", "", dir, NOW);
    expect(existsSync(path.join(dir, "jobs.log.1"))).toBe(true);
    expect(readFileSync(path.join(dir, "jobs.log"), "utf8")).toBe(
      "2026-10-30T04:00:00.000Z escalate ok\n",
    );
  });

  it("JOB_LOG_DIR 未設定なら何もしない", () => {
    expect(() => appendJobLog("escalate", "ok", "", undefined, NOW)).not.toThrow();
  });
});
