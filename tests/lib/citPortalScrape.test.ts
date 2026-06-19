import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { generateTotpCode, parseTimetableHtml } from "@/lib/citPortalScrape";

const SAMPLE_PATH = resolve(process.cwd(), "tmp/timetable-sample.html");

describe("generateTotpCode", () => {
  it("BASE32 シークレットから 6 桁の数値文字列を生成する", () => {
    // RFC 6238 で定義されたテストベクタの secret(=GeeksforGeeksでもおなじみ)
    const code = generateTotpCode("JBSWY3DPEHPK3PXP");
    expect(code).toMatch(/^\d{6}$/);
  });
});

describe("parseTimetableHtml (sample fixture)", () => {
  // tmp/ は .gitignore されているので CI 環境では存在しない可能性あり。
  // ローカルでサンプルがあるときだけ走らせる。
  const has = existsSync(SAMPLE_PATH);
  const it2 = has ? it : it.skip;

  it2("時間割サンプルから 前期/後期 の授業を抽出する", () => {
    const html = readFileSync(SAMPLE_PATH, "utf8");
    const classes = parseTimetableHtml(html);
    expect(classes.length).toBeGreaterThan(0);

    const haru = classes.filter(
      (c) =>
        c.effectiveFrom &&
        c.effectiveFrom.toISOString().slice(5, 7) === "03",
    );
    const aki = classes.filter(
      (c) =>
        c.effectiveFrom &&
        c.effectiveFrom.toISOString().slice(5, 7) === "09",
    );
    expect(haru.length).toBeGreaterThan(0);
    expect(aki.length).toBeGreaterThan(0);
  });

  it2("連続コマがマージされ endPeriod が伸びる", () => {
    const html = readFileSync(SAMPLE_PATH, "utf8");
    const classes = parseTimetableHtml(html);
    const merged = classes.filter((c) => c.endPeriod > c.period);
    expect(merged.length).toBeGreaterThan(0);
    for (const m of merged) {
      // 連続コマでは startTime が period から、endTime が endPeriod から導出
      const startHour = 8 + m.period;
      const endHour = 9 + m.endPeriod;
      expect(m.startTime).toBe(
        `${String(startHour).padStart(2, "0")}:00`,
      );
      expect(m.endTime).toBe(`${String(endHour).padStart(2, "0")}:00`);
    }
  });

  it2("dayOfWeek は月=1, 火=2, ..., 土=6 で揃う", () => {
    const html = readFileSync(SAMPLE_PATH, "utf8");
    const classes = parseTimetableHtml(html);
    for (const c of classes) {
      expect(c.dayOfWeek).toBeGreaterThanOrEqual(1);
      expect(c.dayOfWeek).toBeLessThanOrEqual(6);
    }
  });
});
