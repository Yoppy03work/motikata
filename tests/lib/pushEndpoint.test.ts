import { describe, expect, it } from "vitest";
import { isAllowedPushEndpoint } from "@/lib/pushEndpoint";

describe("isAllowedPushEndpoint", () => {
  it("主要ブラウザのプッシュサービスは許可", () => {
    for (const u of [
      "https://fcm.googleapis.com/fcm/send/abc:def",
      "https://web.push.apple.com/QGx",
      "https://updates.push.services.mozilla.com/wpush/v2/gAAA",
      "https://wns2-par02p.notify.windows.com/w/?token=x",
    ]) {
      expect(isAllowedPushEndpoint(u), u).toBe(true);
    }
  });

  it("内部アドレス・任意ホスト・http・ポート指定は拒否", () => {
    for (const u of [
      "http://169.254.169.254/latest/meta-data/",
      "https://localhost/x",
      "https://evil.example/fcm.googleapis.com",
      "https://fcm.googleapis.com.evil.example/x",
      "http://fcm.googleapis.com/fcm/send/x",
      "https://fcm.googleapis.com:8443/x",
      "https://evilpush.apple.com/x",
      "not a url",
    ]) {
      expect(isAllowedPushEndpoint(u), u).toBe(false);
    }
  });
});
