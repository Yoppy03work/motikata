import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hasJobsToken, requireJobsToken } from "@/lib/jobsAuth";

const req = (auth?: string) =>
  new Request("http://localhost/api/jobs/x", {
    method: "POST",
    headers: auth ? { authorization: auth } : {},
  });

describe("jobsAuth", () => {
  const prev = process.env.JOBS_TOKEN;
  beforeEach(() => {
    process.env.JOBS_TOKEN = "s3cret-token";
  });
  afterEach(() => {
    process.env.JOBS_TOKEN = prev;
  });

  it("正しい Bearer だけ通す", () => {
    expect(hasJobsToken(req("Bearer s3cret-token"))).toBe(true);
    expect(hasJobsToken(req("Bearer s3cret-tokenX"))).toBe(false);
    expect(hasJobsToken(req("Bearer s3cret"))).toBe(false);
    expect(hasJobsToken(req())).toBe(false);
  });

  it("JOBS_TOKEN 未設定なら常に拒否し、require は 500", () => {
    delete process.env.JOBS_TOKEN;
    expect(hasJobsToken(req("Bearer "))).toBe(false);
    expect(requireJobsToken(req("Bearer "))?.status).toBe(500);
  });

  it("不一致は 403、一致は null", () => {
    expect(requireJobsToken(req("Bearer nope"))?.status).toBe(403);
    expect(requireJobsToken(req("Bearer s3cret-token"))).toBeNull();
  });
});
