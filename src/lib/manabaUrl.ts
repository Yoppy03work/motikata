// manaba 課題 TaskInstance から元の課題ページ URL を復元する read 側ヘルパ。
// write 側は src/lib/manabaSync.ts (externalIdOf + notes 生成)。
//
// 復元優先順:
//   1. sourceExternalId が "manaba:url:<URL>" (短い URL) なら直接スライス。
//   2. それでも取れなければ notes ("manaba: <URL>" prefix) から regex 抽出。
//      URL > 200 char で sourceExternalId が "manaba:url:hash:<sha>" になった
//      ケースの fallback。
//
// 何も取れなければ null。UI 側ではこの場合 link を描画しない (静かに no-op)。

const MANABA_URL_PREFIX = "manaba:url:";
const MANABA_URL_HASH_PREFIX = "manaba:url:hash:";
const NOTES_RE = /manaba:\s+(https?:\/\/[^\s<>"']+)/;

export function extractManabaUrl(opts: {
  source?: string | null;
  sourceExternalId?: string | null;
  notes?: string | null;
}): string | null {
  if (opts.source !== "ACADEMIC") return null;
  const ext = opts.sourceExternalId ?? "";
  if (!ext.startsWith("manaba:")) return null;

  // 1) "manaba:url:<URL>" (NOT hash 形式)
  if (ext.startsWith(MANABA_URL_PREFIX) && !ext.startsWith(MANABA_URL_HASH_PREFIX)) {
    const u = ext.slice(MANABA_URL_PREFIX.length);
    const safe = sanitize(u);
    if (safe) return safe;
  }

  // 2) notes "manaba: <URL>" prefix
  const notes = opts.notes ?? "";
  const m = notes.match(NOTES_RE);
  if (m) {
    const safe = sanitize(m[1]);
    if (safe) return safe;
  }

  return null;
}

// http / https のみを許可。javascript: 等のスキーム差し込みを遮断する二段防御
// (regex の段階で `https?://` 始まりを要求しているが、念押し)。
function sanitize(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol === "http:" || url.protocol === "https:") return raw;
  } catch {
    // URL コンストラクタが投げるケース (改行混入等) は no-op
  }
  return null;
}
