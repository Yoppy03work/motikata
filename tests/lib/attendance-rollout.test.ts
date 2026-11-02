import { afterEach, describe, expect, it } from "vitest";
import {
  isAutoDevCodeConfigured,
  verifyAutoDevCode,
  isAutoDryRun,
} from "@/lib/attendance/rollout";

const ORIG_CODE = process.env.ATTENDANCE_AUTO_DEV_CODE;
const ORIG_DRY = process.env.ATTENDANCE_AUTO_DRY_RUN;

afterEach(() => {
  if (ORIG_CODE === undefined) delete process.env.ATTENDANCE_AUTO_DEV_CODE;
  else process.env.ATTENDANCE_AUTO_DEV_CODE = ORIG_CODE;
  if (ORIG_DRY === undefined) delete process.env.ATTENDANCE_AUTO_DRY_RUN;
  else process.env.ATTENDANCE_AUTO_DRY_RUN = ORIG_DRY;
});

describe("auto 開発者コード", () => {
  it("未設定なら解禁不可 (configured=false, verify は常に false)", () => {
    delete process.env.ATTENDANCE_AUTO_DEV_CODE;
    expect(isAutoDevCodeConfigured()).toBe(false);
    expect(verifyAutoDevCode("anything")).toBe(false);
    expect(verifyAutoDevCode("")).toBe(false);
  });

  it("設定済みなら完全一致のときだけ true", () => {
    process.env.ATTENDANCE_AUTO_DEV_CODE = "s3cret-dev-code";
    expect(isAutoDevCodeConfigured()).toBe(true);
    expect(verifyAutoDevCode("s3cret-dev-code")).toBe(true);
    expect(verifyAutoDevCode("wrong")).toBe(false);
    expect(verifyAutoDevCode("s3cret-dev-cod")).toBe(false);
  });

  it("空白のみのコードは未設定扱い", () => {
    process.env.ATTENDANCE_AUTO_DEV_CODE = "   ";
    expect(isAutoDevCodeConfigured()).toBe(false);
    expect(verifyAutoDevCode("   ")).toBe(false);
  });
});

describe("isAutoDryRun (fail-toward-dry-run)", () => {
  it("未設定/false/0/no は実送信 (dry-run ではない)", () => {
    for (const v of ["", "false", "0", "no"]) {
      process.env.ATTENDANCE_AUTO_DRY_RUN = v;
      expect(isAutoDryRun()).toBe(false);
    }
  });
  it("それ以外 (typo 含む) は全て dry-run", () => {
    for (const v of ["true", "1", "yes", "tru"]) {
      process.env.ATTENDANCE_AUTO_DRY_RUN = v;
      expect(isAutoDryRun()).toBe(true);
    }
  });
});
