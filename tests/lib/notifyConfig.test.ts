import { describe, expect, it } from "vitest";
import { parseNotifyConfig, summarizeConfig, toPlainText } from "@/lib/notifyConfig";

describe("parseNotifyConfig", () => {
  it("Slack は hooks.slack.com の URL だけ受け付ける", () => {
    expect(parseNotifyConfig("SLACK", { webhookUrl: " https://hooks.slack.com/services/T0/B0/abc " }).ok).toBe(true);
    expect(parseNotifyConfig("SLACK", { webhookUrl: "https://evil.example.com/services/T0" }).ok).toBe(false);
    expect(parseNotifyConfig("SLACK", { webhookUrl: "http://hooks.slack.com/services/T0/B0/abc" }).ok).toBe(false);
  });

  it("Discord は discord.com / discordapp.com の webhook だけ", () => {
    expect(parseNotifyConfig("DISCORD", { webhookUrl: "https://discord.com/api/webhooks/123/abc-DEF_1" }).ok).toBe(true);
    expect(parseNotifyConfig("DISCORD", { webhookUrl: "https://discordapp.com/api/webhooks/123/abc" }).ok).toBe(true);
    expect(parseNotifyConfig("DISCORD", { webhookUrl: "https://discord.com.evil.io/api/webhooks/1/a" }).ok).toBe(false);
    expect(parseNotifyConfig("DISCORD", { webhookUrl: "https://discord.com/api/webhooks/123/abc?x=1" }).ok).toBe(false);
  });

  it("LINE はトークンとユーザー ID の形式を確認する", () => {
    const userId = "U" + "0123456789abcdef".repeat(2);
    const ok = parseNotifyConfig("LINE", { channelAccessToken: "x".repeat(40), userId });
    expect(ok.ok).toBe(true);
    const bad = parseNotifyConfig("LINE", { channelAccessToken: "x".repeat(40), userId: "someone" });
    expect(bad).toEqual({ ok: false, error: "LINE のユーザー ID は U から始まる 33 文字です" });
  });
});

describe("summarizeConfig", () => {
  it("秘密部分を出さない", () => {
    const s = summarizeConfig("SLACK", { webhookUrl: "https://hooks.slack.com/services/T0/B0/secretXYZ9" });
    expect(s).toBe("hooks.slack.com/…XYZ9");
    expect(s).not.toContain("secret");
  });
});

describe("toPlainText", () => {
  it("タイトルと本文を改行でつなぐ", () => {
    expect(toPlainText({ title: "A", body: "B" })).toBe("A\nB");
    expect(toPlainText({ title: "A", body: "" })).toBe("A");
  });
});
