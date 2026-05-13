import { describe, expect, it } from "vitest";
import { buildRrule, matchesOn, parseRrule, rruleLabel } from "@/lib/rrule";

describe("rrule helpers", () => {
  it("parse DAILY", () => {
    expect(parseRrule("FREQ=DAILY")).toEqual({ kind: "DAILY" });
  });

  it("parse WEEKLY with BYDAY", () => {
    expect(parseRrule("FREQ=WEEKLY;BYDAY=MO,WE,FR")).toEqual({
      kind: "WEEKLY",
      days: [1, 3, 5],
    });
  });

  it("parse MONTHLY with BYMONTHDAY", () => {
    expect(parseRrule("FREQ=MONTHLY;BYMONTHDAY=15")).toEqual({
      kind: "MONTHLY",
      day: 15,
    });
  });

  it("buildRrule round-trip", () => {
    expect(buildRrule({ kind: "DAILY" })).toBe("FREQ=DAILY");
    expect(buildRrule({ kind: "WEEKLY", days: [1, 3, 5] })).toBe(
      "FREQ=WEEKLY;BYDAY=MO,WE,FR",
    );
    expect(buildRrule({ kind: "MONTHLY", day: 15 })).toBe(
      "FREQ=MONTHLY;BYMONTHDAY=15",
    );
  });

  it("matchesOn DAILY always matches", () => {
    expect(matchesOn("FREQ=DAILY", "2026-05-05")).toBe(true);
    expect(matchesOn("FREQ=DAILY", "2026-12-31")).toBe(true);
  });

  it("matchesOn WEEKLY matches only selected days", () => {
    // 2026-05-04 は月曜
    expect(matchesOn("FREQ=WEEKLY;BYDAY=MO", "2026-05-04")).toBe(true);
    expect(matchesOn("FREQ=WEEKLY;BYDAY=MO", "2026-05-05")).toBe(false);
    expect(matchesOn("FREQ=WEEKLY;BYDAY=MO,WE,FR", "2026-05-04")).toBe(true);
    expect(matchesOn("FREQ=WEEKLY;BYDAY=MO,WE,FR", "2026-05-06")).toBe(true);
    expect(matchesOn("FREQ=WEEKLY;BYDAY=MO,WE,FR", "2026-05-08")).toBe(true);
    expect(matchesOn("FREQ=WEEKLY;BYDAY=MO,WE,FR", "2026-05-07")).toBe(false);
  });

  it("matchesOn MONTHLY matches by day-of-month", () => {
    expect(matchesOn("FREQ=MONTHLY;BYMONTHDAY=15", "2026-05-15")).toBe(true);
    expect(matchesOn("FREQ=MONTHLY;BYMONTHDAY=15", "2026-06-15")).toBe(true);
    expect(matchesOn("FREQ=MONTHLY;BYMONTHDAY=15", "2026-05-16")).toBe(false);
  });

  it("matchesOn null/empty returns false", () => {
    expect(matchesOn(null, "2026-05-05")).toBe(false);
    expect(matchesOn("", "2026-05-05")).toBe(false);
  });

  it("rruleLabel human-readable", () => {
    expect(rruleLabel("FREQ=DAILY")).toBe("毎日");
    expect(rruleLabel("FREQ=WEEKLY;BYDAY=MO,WE,FR")).toBe("毎週 月水金");
    expect(rruleLabel("FREQ=MONTHLY;BYMONTHDAY=15")).toBe("毎月 15日");
    expect(rruleLabel(null)).toBe("繰り返しなし");
  });
});
