// Slack Incoming Webhook ヘルパー。
// SLACK_WEBHOOK_URL は秘匿情報。クライアント側に渡らないよう、必ずサーバ経由で使う。

export type SlackBlock = Record<string, unknown>;
export type SlackMessage = {
  text: string;
  blocks?: SlackBlock[];
};

export class SlackError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "SlackError";
  }
}

export function isSlackEnabled(): boolean {
  const v = process.env.SLACK_WEBHOOK_URL;
  return !!v && v.length > 0;
}

export async function sendSlackMessage(msg: SlackMessage): Promise<void> {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) throw new SlackError("SLACK_WEBHOOK_URL is not configured");

  // Slack 側はだいたい 1 秒以内で返す。長時間ぶら下がるのを避けるため timeout を切る。
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 5000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(msg),
      signal: ac.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new SlackError(
        `Slack POST failed: ${res.status} ${body.slice(0, 200)}`,
        res.status,
      );
    }
  } catch (e) {
    if (e instanceof SlackError) throw e;
    throw new SlackError(e instanceof Error ? e.message : String(e));
  } finally {
    clearTimeout(timer);
  }
}
