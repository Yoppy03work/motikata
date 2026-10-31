// Client Component でマウント時に API を読むときの小さなヘルパ。
// 失敗(ネットワークエラー / 非 2xx / JSON でない)は null にまとめる。
//
// 使い方: useEffect の中で `fetchJsonOrNull(url).then(apply)` のように、
// state の更新を Promise のコールバック側に置く。effect 本体で同期的に
// setState すると react-hooks/set-state-in-effect の警告(余分な再描画)になるため。
// アンマウント後に古い結果を反映しないよう、呼び出し側で ignore フラグを持つこと。
export async function fetchJsonOrNull<T = unknown>(
  input: string,
  init?: RequestInit,
): Promise<T | null> {
  try {
    const res = await fetch(input, init);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}
