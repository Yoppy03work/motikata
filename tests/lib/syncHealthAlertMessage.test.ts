import { describe, expect, it } from "vitest";
import { buildHealthAlertMessage } from "../../src/lib/syncHealthAlertMessage";

describe("buildHealthAlertMessage", () => {
  it("includes count and each entry source", () => {
    const msg = buildHealthAlertMessage([
      {
        source: "manaba",
        detail: "timeout",
        lastAt: new Date("2026-06-20T04:00:00+09:00"),
      },
      {
        source: "CIT ポータル",
        detail: "OTP rejected",
        lastAt: new Date("2026-06-20T04:01:00+09:00"),
      },
    ]);
    expect(msg.text).toContain("同期エラー 2 件");
    expect(msg.text).toContain("[manaba]");
    expect(msg.text).toContain("timeout");
    expect(msg.text).toContain("[CIT ポータル]");
    expect(msg.text).toContain("OTP rejected");
    expect(msg.text).toContain("2026-06-20 04:00");
  });

  it("truncates to 10 entries with '他 N 件' suffix", () => {
    const entries = Array.from({ length: 15 }, (_, i) => ({
      source: `src-${i}`,
      detail: `err-${i}`,
      lastAt: new Date("2026-06-20T04:00:00+09:00"),
    }));
    const msg = buildHealthAlertMessage(entries);
    expect(msg.text).toContain("同期エラー 15 件");
    expect(msg.text).toContain("...他 5 件");
    // First 10 shown
    expect(msg.text).toContain("src-0");
    expect(msg.text).toContain("src-9");
    expect(msg.text).not.toContain("src-10");
  });

  it("handles null lastAt as '未実行'", () => {
    const msg = buildHealthAlertMessage([
      { source: "Google (foo@example.com)", detail: "auth", lastAt: null },
    ]);
    expect(msg.text).toContain("最終: 未実行");
  });

  it("truncates long detail", () => {
    const longDetail = "a".repeat(500);
    const msg = buildHealthAlertMessage([
      {
        source: "x",
        detail: longDetail,
        lastAt: new Date("2026-06-20T04:00:00+09:00"),
      },
    ]);
    // Should not contain the full 500 char string
    expect(msg.text.length).toBeLessThan(longDetail.length + 200);
  });

  it("empty detail falls back to (不明)", () => {
    const msg = buildHealthAlertMessage([
      { source: "x", detail: "", lastAt: null },
    ]);
    expect(msg.text).toContain("(不明)");
  });
});
