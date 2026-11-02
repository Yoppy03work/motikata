/**
 * 教室名 (room) の正規化と一致判定 (純粋関数)
 *
 * ChibaTechPortal から clean copy (2026-11-02)。副作用なし・I/O なし・env 非依存。
 *
 * WHY: 時間割側の room (UNIPA 由来の日本語表示 "７３１講義室") と、QR / 出席システム側の
 * roomId ("7301") は表記体系が違う。緩めすぎると別教室を誤一致させて「別授業の出席を送る」
 * 事故になるため、確信のある正規化のみ行い、未知のフォーマット差異は不一致側に倒す。
 *
 * 実機検証 (2026-06-26, 津田沼 "731講義室" の QR roomId = "7301") で規則を確証済み。
 * 新習志野は 7 始まりでも native 4 桁 (ユーザー談) のため、畳み込みは一方向にして衝突を防ぐ。
 */

/** 全角英数字・全角スペース・全角ハイフンを半角へ寄せる。 */
function toHalfWidthAlphanumeric(input: string): string {
  let out = "";
  for (const ch of input) {
    const code = ch.codePointAt(0)!;
    if (code >= 0xff01 && code <= 0xff5e) {
      out += String.fromCodePoint(code - 0xfee0);
      continue;
    }
    if (code === 0x3000) {
      out += " ";
      continue;
    }
    if (code === 0xff0d || code === 0x2212) {
      out += "-";
      continue;
    }
    out += ch;
  }
  return out;
}

const ROOM_TYPE_SUFFIXES = [
  "講義室",
  "演習室",
  "実験室",
  "実習室",
  "会議室",
  "研究室",
  "製図室",
  "体育館",
  "教室",
  "室",
] as const;

function stripRoomTypeSuffix(input: string): string {
  for (const suffix of ROOM_TYPE_SUFFIXES) {
    if (input.length > suffix.length && input.endsWith(suffix)) {
      return input.slice(0, input.length - suffix.length);
    }
  }
  return input;
}

export interface NormalizedRoom {
  canonical: string;
  core: string | null;
  isEmpty: boolean;
}

/** 教室名を正規化する (半角化 + 空白除去 + suffix 除去 + 大文字化 + 英数字コア抽出)。 */
export function normalizeRoom(raw: string | null | undefined): NormalizedRoom {
  if (raw == null) {
    return { canonical: "", core: null, isEmpty: true };
  }

  const halfWidth = toHalfWidthAlphanumeric(raw);
  const noSpace = halfWidth.replace(/\s+/g, "");
  if (noSpace.length === 0) {
    return { canonical: "", core: null, isEmpty: true };
  }

  const withoutSuffix = stripRoomTypeSuffix(noSpace);
  const upper = withoutSuffix.toUpperCase();
  const canonical = upper.length > 0 ? upper : noSpace.toUpperCase();

  // canonical 全体が ASCII [A-Z0-9_-] のときのみコアとして採用 (漢字混在は core=null)。
  const core = /^[A-Z0-9_-]+$/.test(canonical) ? canonical : null;

  return { canonical, core, isEmpty: false };
}

/**
 * CIT 出席システム固有の教室コード対応規則を加味して、
 * 時間割 (UNIPA) の room と QR (出席システム) の roomId が同一教室かを判定する。
 *
 * 畳み込みは一方向: 完全一致は常に true。時間割側が 7 始まり 3 桁 "7XY" のときだけ
 * QR 側 4 桁 "7X0Y" (0 挿入) を畳んで突合する (津田沼)。時間割が 4 桁 (新習志野) は畳まない。
 */
export function attendanceRoomMatches(
  timetableRoom: string | null | undefined,
  qrRoomId: string | null | undefined,
): boolean {
  const t = normalizeRoom(timetableRoom);
  const q = normalizeRoom(qrRoomId);

  if (t.isEmpty || q.isEmpty) return false;

  if (t.core !== null && q.core !== null) {
    if (t.core === q.core) return true;
    if (
      /^7\d\d$/.test(t.core) &&
      /^7\d0\d$/.test(q.core) &&
      q.core[0] + q.core[1] + q.core[3] === t.core
    ) {
      return true;
    }
    return false;
  }

  if (t.core !== null || q.core !== null) {
    return false;
  }

  return t.canonical === q.canonical;
}
