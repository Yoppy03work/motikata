import { describe, expect, it, beforeEach } from "vitest";
import { isSameOrigin } from "@/lib/csrf";

function req(method: string, headers: Record<string, string>): Request {
  return new Request("https://example.com/api/foo", {
    method,
    headers,
  });
}

describe("csrf isSameOrigin", () => {
  beforeEach(() => {
    process.env.APP_ORIGIN = "https://example.com";
  });

  it("GET は常に true", () => {
    expect(isSameOrigin(req("GET", {}))).toBe(true);
    expect(isSameOrigin(req("HEAD", {}))).toBe(true);
    expect(isSameOrigin(req("OPTIONS", {}))).toBe(true);
  });

  it("同一 Origin の POST は true", () => {
    expect(isSameOrigin(req("POST", { origin: "https://example.com" }))).toBe(true);
  });

  it("異なる Origin の POST は false", () => {
    expect(isSameOrigin(req("POST", { origin: "https://evil.example.com" }))).toBe(false);
  });

  it("Origin 無し + 同一 Referer の POST は true", () => {
    expect(
      isSameOrigin(req("POST", { referer: "https://example.com/page" })),
    ).toBe(true);
  });

  it("Origin 無し + 異 Referer の POST は false", () => {
    expect(
      isSameOrigin(req("POST", { referer: "https://evil.example.com/page" })),
    ).toBe(false);
  });

  it("Origin / Referer どちらも無い POST は false", () => {
    expect(isSameOrigin(req("POST", {}))).toBe(false);
  });

  it("APP_ORIGIN がカンマ区切りで複数許可", () => {
    process.env.APP_ORIGIN = "https://a.com,https://b.com";
    expect(isSameOrigin(req("POST", { origin: "https://a.com" }))).toBe(true);
    expect(isSameOrigin(req("POST", { origin: "https://b.com" }))).toBe(true);
    expect(isSameOrigin(req("POST", { origin: "https://c.com" }))).toBe(false);
  });
});
