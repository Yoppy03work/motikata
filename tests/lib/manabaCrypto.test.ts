import { describe, expect, it, beforeEach } from "vitest";
import {
  decryptManabaPassword,
  encryptManabaPassword,
} from "@/lib/manabaCrypto";

describe("manabaCrypto", () => {
  beforeEach(() => {
    process.env.SESSION_SECRET = "test-secret-32-chars-minimum-required-xx";
    process.env.NODE_ENV = "test";
  });

  it("encrypt → decrypt で元の値が戻る", () => {
    const plain = "P@ssw0rd!";
    const enc = encryptManabaPassword(plain);
    expect(enc).toMatch(/^[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/);
    const dec = decryptManabaPassword(enc);
    expect(dec).toBe(plain);
  });

  it("空パスワードは throw", () => {
    expect(() => encryptManabaPassword("")).toThrow();
  });

  it("不正な形式は throw", () => {
    expect(() => decryptManabaPassword("nothing")).toThrow();
    expect(() => decryptManabaPassword("a:b")).toThrow();
  });

  it("auth tag を改竄すると throw", () => {
    const enc = encryptManabaPassword("hello");
    const parts = enc.split(":");
    const tampered = `${parts[0]}:${parts[1]}:AAAAAAAAAAAAAAAAAAAAAA`;
    expect(() => decryptManabaPassword(tampered)).toThrow();
  });
});
