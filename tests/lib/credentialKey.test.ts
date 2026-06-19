import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { deriveCredentialKey } from "@/lib/credentialKey";

describe("deriveCredentialKey", () => {
  const ORIG_CRED = process.env.CREDENTIAL_ENCRYPTION_KEY;
  const ORIG_SESSION = process.env.SESSION_SECRET;
  const ORIG_NODE_ENV = process.env.NODE_ENV;

  beforeEach(() => {
    delete process.env.CREDENTIAL_ENCRYPTION_KEY;
    delete process.env.SESSION_SECRET;
    process.env.NODE_ENV = "test";
  });

  afterEach(() => {
    if (ORIG_CRED === undefined) delete process.env.CREDENTIAL_ENCRYPTION_KEY;
    else process.env.CREDENTIAL_ENCRYPTION_KEY = ORIG_CRED;
    if (ORIG_SESSION === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = ORIG_SESSION;
    if (ORIG_NODE_ENV === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = ORIG_NODE_ENV;
  });

  const legacy = (): Buffer =>
    createHash("sha256").update("legacy-fallback-marker").digest();

  it("CREDENTIAL_ENCRYPTION_KEY 設定時は legacyKey を呼ばず新方式で導出する", () => {
    process.env.CREDENTIAL_ENCRYPTION_KEY = "x".repeat(32);
    let legacyCalled = false;
    const k = deriveCredentialKey("manaba", () => {
      legacyCalled = true;
      return legacy();
    });
    expect(legacyCalled).toBe(false);
    expect(k).toEqual(
      createHash("sha256").update(`manaba:${"x".repeat(32)}`).digest(),
    );
  });

  it("ドメイン分離: 同じ鍵でも domain が違えば異なる鍵を返す", () => {
    process.env.CREDENTIAL_ENCRYPTION_KEY = "y".repeat(40);
    const a = deriveCredentialKey("manaba", legacy);
    const b = deriveCredentialKey("cit-portal", legacy);
    expect(a).not.toEqual(b);
  });

  it("CREDENTIAL_ENCRYPTION_KEY が短い(<32)場合は legacy にフォールバック", () => {
    process.env.CREDENTIAL_ENCRYPTION_KEY = "short";
    const k = deriveCredentialKey("manaba", legacy);
    expect(k).toEqual(legacy());
  });

  it("CREDENTIAL_ENCRYPTION_KEY 未設定なら legacy にフォールバック", () => {
    const k = deriveCredentialKey("manaba", legacy);
    expect(k).toEqual(legacy());
  });
});
