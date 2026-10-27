// スクレイパーが認証情報 (パスワード / OTP / SAMLResponse) を POST する先の検査。
//
// フォームの action や 307/308 の Location はスクレイプ先の HTML / レスポンス任せなので、
// 相手側の改ざんや経路上の書き換えがあると、平文の認証情報を任意のホストへ送ってしまう。
// 送信先を「設定済みの基準 URL と同じスキーム」かつ「基準ホスト(か同じ組織のサブドメイン)」
// に限定する。

/** "portal.chibatech.ac.jp" → "chibatech.ac.jp"。ラベルが少なすぎる場合は null。 */
function parentDomain(host: string): string | null {
  const labels = host.split(".");
  // "example.jp" のような 2 ラベルを親にすると公開サフィックス相当まで広がるので不可
  if (labels.length < 4) return null;
  return labels.slice(1).join(".");
}

export function isTrustedSubmitTarget(
  target: string,
  base: string,
  opts: { allowSiblingHosts: boolean },
): boolean {
  let t: URL;
  let b: URL;
  try {
    t = new URL(target);
    b = new URL(base);
  } catch {
    return false;
  }
  // https → http へのダウングレードを拒否 (基準自体が http のローカル検証時だけ http を許す)
  if (t.protocol !== b.protocol) return false;
  if (t.protocol !== "https:" && t.protocol !== "http:") return false;
  if (t.host === b.host) return true;
  if (!opts.allowSiblingHosts) return false;
  const parent = parentDomain(b.hostname);
  return parent !== null && t.hostname.endsWith(`.${parent}`);
}
