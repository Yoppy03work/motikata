import { describe, expect, it } from "vitest";
import { isTrustedSubmitTarget } from "@/lib/scrapeGuard";

const PORTAL = "https://portal.chibatech.ac.jp";
const MANABA = "https://cit.manaba.jp";

describe("isTrustedSubmitTarget", () => {
  it("CIT ポータル: 同一ホストと同じ組織の IdP は許可", () => {
    const o = { allowSiblingHosts: true };
    expect(isTrustedSubmitTarget(`${PORTAL}/uprx/x`, PORTAL, o)).toBe(true);
    expect(isTrustedSubmitTarget("https://sso.chibatech.ac.jp/realms/x/login", PORTAL, o)).toBe(true);
  });

  it("CIT ポータル: 外部ホスト・なりすましドメイン・http ダウングレードは拒否", () => {
    const o = { allowSiblingHosts: true };
    expect(isTrustedSubmitTarget("https://evil.example/collect", PORTAL, o)).toBe(false);
    expect(isTrustedSubmitTarget("https://chibatech.ac.jp.evil.example/", PORTAL, o)).toBe(false);
    expect(isTrustedSubmitTarget("https://evilchibatech.ac.jp/", PORTAL, o)).toBe(false);
    expect(isTrustedSubmitTarget("http://sso.chibatech.ac.jp/login", PORTAL, o)).toBe(false);
    expect(isTrustedSubmitTarget("javascript:alert(1)", PORTAL, o)).toBe(false);
  });

  it("manaba: 同一ホストのみ (他大学の *.manaba.jp も不可)", () => {
    const o = { allowSiblingHosts: false };
    expect(isTrustedSubmitTarget(`${MANABA}/ct/login`, MANABA, o)).toBe(true);
    expect(isTrustedSubmitTarget("https://other.manaba.jp/ct/login", MANABA, o)).toBe(false);
  });

  it("2 ラベルのドメインを親として広げない", () => {
    expect(
      isTrustedSubmitTarget("https://evil.manaba.jp/", MANABA, { allowSiblingHosts: true }),
    ).toBe(false);
  });
});
