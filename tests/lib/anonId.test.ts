import { describe, expect, it, beforeEach } from "vitest";
import { issueAnonId, verifyAnonId } from "@/lib/anonId";

describe("anonId", () => {
  beforeEach(() => {
    process.env.SESSION_SECRET = "test-secret-32-chars-minimum-required-xx";
    process.env.NODE_ENV = "test";
  });

  it("発行した値は検証成功する", () => {
    const signed = issueAnonId();
    const id = verifyAnonId(signed);
    expect(id).not.toBeNull();
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("生 UUID(署名なし)は検証失敗する", () => {
    expect(verifyAnonId("00000000-0000-0000-0000-000000000000")).toBeNull();
  });

  it("不正な形式は null", () => {
    expect(verifyAnonId(null)).toBeNull();
    expect(verifyAnonId("")).toBeNull();
    expect(verifyAnonId("foo")).toBeNull();
    expect(verifyAnonId("foo.bar")).toBeNull();
  });

  it("MAC を改竄したら検証失敗", () => {
    const signed = issueAnonId();
    const lastDot = signed.lastIndexOf(".");
    const tampered = signed.slice(0, lastDot) + "." + "X".repeat(22);
    expect(verifyAnonId(tampered)).toBeNull();
  });

  it("body を改竄したら検証失敗", () => {
    const signed = issueAnonId();
    const tampered = "00000000-0000-0000-0000-000000000000" + signed.slice(36);
    expect(verifyAnonId(tampered)).toBeNull();
  });
});
