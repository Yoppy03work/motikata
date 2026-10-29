import { describe, it, expect } from "vitest";
import { extractManabaUrl } from "@/lib/manabaUrl";

describe("extractManabaUrl", () => {
  it("returns URL from short sourceExternalId (manaba:url:<URL>)", () => {
    const url = "https://cit.manaba.jp/ct/course_123_query_456";
    expect(
      extractManabaUrl({
        source: "ACADEMIC",
        sourceExternalId: `manaba:url:${url}`,
        notes: null,
      }),
    ).toBe(url);
  });

  it("falls back to notes when sourceExternalId is hashed (manaba:url:hash:<sha>)", () => {
    const url = "https://cit.manaba.jp/ct/course_123_query_456";
    expect(
      extractManabaUrl({
        source: "ACADEMIC",
        sourceExternalId: "manaba:url:hash:abc123",
        notes: `manaba: ${url}`,
      }),
    ).toBe(url);
  });

  it("falls back to notes when sourceExternalId is course/title form", () => {
    const url = "https://cit.manaba.jp/ct/course_xyz";
    expect(
      extractManabaUrl({
        source: "ACADEMIC",
        sourceExternalId: "manaba:数学I:第3回レポート",
        notes: `manaba: ${url}`,
      }),
    ).toBe(url);
  });

  it("returns null when source is not ACADEMIC (no URL leak for MANUAL)", () => {
    expect(
      extractManabaUrl({
        source: "MANUAL",
        sourceExternalId: "manaba:url:https://example.com",
        notes: "manaba: https://example.com",
      }),
    ).toBeNull();
  });

  it("returns null when nothing is recoverable", () => {
    expect(
      extractManabaUrl({
        source: "ACADEMIC",
        sourceExternalId: "manaba:hash:abc123",
        notes: null,
      }),
    ).toBeNull();
  });

  it("returns null for non-manaba sourceExternalId (defense)", () => {
    expect(
      extractManabaUrl({
        source: "ACADEMIC",
        sourceExternalId: "google:abc123",
        notes: "manaba: https://example.com",
      }),
    ).toBeNull();
  });

  it("rejects javascript: scheme in sourceExternalId", () => {
    expect(
      extractManabaUrl({
        source: "ACADEMIC",
        sourceExternalId: "manaba:url:javascript:alert(1)",
        notes: null,
      }),
    ).toBeNull();
  });

  it("rejects javascript: scheme in notes", () => {
    expect(
      extractManabaUrl({
        source: "ACADEMIC",
        sourceExternalId: "manaba:url:hash:x",
        // notes prefix regex requires `https?://` so this should not match
        notes: "manaba: javascript:alert(1)",
      }),
    ).toBeNull();
  });

  it("handles missing fields without throwing", () => {
    expect(extractManabaUrl({})).toBeNull();
    expect(extractManabaUrl({ source: null, sourceExternalId: null, notes: null })).toBeNull();
  });

  it("trims to URL boundary in notes (stops at whitespace)", () => {
    expect(
      extractManabaUrl({
        source: "ACADEMIC",
        sourceExternalId: "manaba:url:hash:x",
        notes: "manaba: https://cit.manaba.jp/ct/abc and trailing garbage",
      }),
    ).toBe("https://cit.manaba.jp/ct/abc");
  });
});
