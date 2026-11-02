/**
 * 出席システム QR URL のパース
 *
 * ChibaTechPortal から clean copy (2026-11-02)。QR 文字列は untrusted 入力。
 * Zod で厳密検証し、roomId 形式以外を受け付けない。QR 文字列をログ / 例外メッセージに
 * 出さない (reason はコード ID のみ)。
 *
 * 出席システムの QR は典型的に:
 *   https://attendance.is.chibatech.ac.jp/attendance/class_room/{roomId}
 */
import { z } from "zod";

/**
 * 許可するホスト名のサフィックス。
 * WHY: CIT は it-chiba.ac.jp → chibatech.ac.jp に改称。現行の native 出席 QR は
 * attendance.is.chibatech.ac.jp。旧 it-chiba も後方互換で残す。env で上書き可。
 */
const DEFAULT_ALLOWED_QR_HOST_SUFFIXES = [
  ".cit.ac.jp",
  ".chibatech.ac.jp",
  ".it-chiba.ac.jp",
];

function getAllowedHostSuffixes(): string[] {
  if (typeof process === "undefined") return DEFAULT_ALLOWED_QR_HOST_SUFFIXES;
  const fromEnv = process.env.ATTENDANCE_QR_ALLOWED_HOST_SUFFIXES;
  if (!fromEnv) return DEFAULT_ALLOWED_QR_HOST_SUFFIXES;
  return fromEnv
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

const roomIdSchema = z
  .string()
  .min(1, "roomId is empty")
  .max(32, "roomId is too long")
  .regex(/^[A-Za-z0-9_-]+$/, "roomId contains invalid characters");

export type AttendanceQrParseResult =
  | { ok: true; roomId: string }
  | {
      ok: false;
      reason:
        | "invalid_url"
        | "unsupported_protocol"
        | "host_not_allowed"
        | "unsupported_path"
        | "invalid_room_id";
    };

/**
 * QR の読み取り文字列を { roomId } に変換する。
 * 受け入れ: https / ホストが許可サフィックスで終わる / パス /attendance/class_room/{roomId} /
 *           roomId が roomIdSchema を満たす。受け入れ外は ok=false + reason (raw は返さない)。
 */
export function parseAttendanceQrUrl(raw: string): AttendanceQrParseResult {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "invalid_url" };
  }

  if (url.protocol !== "https:") {
    return { ok: false, reason: "unsupported_protocol" };
  }

  const allowedSuffixes = getAllowedHostSuffixes();
  const host = url.hostname.toLowerCase();
  if (!allowedSuffixes.some((suffix) => host.endsWith(suffix.toLowerCase()))) {
    return { ok: false, reason: "host_not_allowed" };
  }

  const segments = url.pathname.split("/").filter(Boolean);
  if (
    segments.length !== 3 ||
    segments[0] !== "attendance" ||
    segments[1] !== "class_room"
  ) {
    return { ok: false, reason: "unsupported_path" };
  }

  const parsed = roomIdSchema.safeParse(segments[2]);
  if (!parsed.success) {
    return { ok: false, reason: "invalid_room_id" };
  }

  return { ok: true, roomId: parsed.data };
}
