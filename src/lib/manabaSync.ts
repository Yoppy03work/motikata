// manaba 同期の共有実装。
// /api/manaba/sync(ユーザ手動)と /api/jobs/manaba-sync(cron)の両方から呼ぶ。
//
// 流れ:
//   1. ManabaCredential を読んでパスワード復号
//   2. fetchManabaAssignments でスクレイプ
//   3. 期限ありかつ未来の課題だけを TaskInstance に upsert
//      - 重複検知: source=ACADEMIC, sourceExternalId=manaba:<course>:<title>:<dueAt>
//      - DONE / SKIPPED の既存タスクはそのまま
//   4. lastSyncedAt / lastError を書き戻し

import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { decryptManabaPassword } from "@/lib/manabaCrypto";
import {
  fetchManabaAssignments,
  ManabaError,
  type ManabaAssignment,
} from "@/lib/manabaScrape";

export type ManabaSyncResult =
  | {
      ok: true;
      fetched: number;
      target: number;
      pastSkipped: number;
      noDueSkipped: number;
      inserted: number;
      updated: number;
      skipped: number;
    }
  | {
      ok: false;
      error: string;
      stage: "no-credential" | "decrypt" | "scrape";
    };

function externalIdOf(a: ManabaAssignment): string {
  const due = a.dueAt ? a.dueAt.toISOString() : "no-due";
  const natural = `manaba:${a.course}:${a.title}:${due}`;
  // 200 文字以内ならそのまま使う(後方互換: 既存の externalId と一致するため)。
  // それを超える場合だけ SHA-256 で安定的に短縮する。
  // truncate(slice 200) は別アサインメントが先頭一致で衝突するので NG。
  if (natural.length <= 200) return natural;
  const hash = createHash("sha256").update(natural).digest("hex");
  return `manaba:hash:${hash}`;
}

export async function runManabaSync(): Promise<ManabaSyncResult> {
  const cred = await prisma.manabaCredential.findFirst();
  if (!cred) {
    return {
      ok: false,
      error: "manaba 認証情報が登録されていません",
      stage: "no-credential",
    };
  }

  let plainPassword: string;
  try {
    plainPassword = decryptManabaPassword(cred.passwordEnc);
  } catch {
    return {
      ok: false,
      error: "認証情報の復号に失敗(SESSION_SECRET を変更しましたか?)",
      stage: "decrypt",
    };
  }

  let assignments: ManabaAssignment[];
  try {
    assignments = await fetchManabaAssignments(cred.username, plainPassword);
  } catch (e) {
    const msg =
      e instanceof ManabaError
        ? `${e.stage}: ${e.message}`
        : e instanceof Error
          ? e.message
          : "unknown error";
    await prisma.manabaCredential.update({
      where: { id: cred.id },
      data: { lastError: msg.slice(0, 500) },
    });
    return { ok: false, error: msg, stage: "scrape" };
  }

  const now = new Date();
  const target = assignments.filter((a) => a.dueAt && a.dueAt > now);
  const pastSkipped = assignments.filter(
    (a) => a.dueAt && a.dueAt <= now,
  ).length;
  const noDueSkipped = assignments.filter((a) => !a.dueAt).length;

  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  for (const a of target) {
    const externalId = externalIdOf(a);
    const title = `${a.course} / ${a.title}`;
    const notes = a.url ? `manaba: ${a.url}` : null;
    // 並行 run(cron + 手動 / リトライ重複)で同じ assignment を2回 create
    // しないよう、(source, sourceExternalId) の DB ユニーク制約に頼って upsert。
    // findFirst + create の non-atomic だと両方が「存在しない」と判定して両方
    // insert → 重複行になる。
    // ユーザーが手で DONE/SKIPPED に切替えたタスクは上書きしない仕様のため、
    // 単純な prisma.upsert は使わず:
    //   - まず status=OPEN の行に updateMany を試みる(原子的に1件更新できれば終了)
    //   - 更新なしなら findUnique。 DONE/SKIPPED が存在すれば skipped。
    //   - 存在しなければ create を試み、P2002(unique violation)が出たら
    //     並行 run が先に insert したと見なして skipped 扱い。
    const updRes = await prisma.taskInstance.updateMany({
      where: {
        source: "ACADEMIC",
        sourceExternalId: externalId,
        status: "OPEN",
      },
      data: { title, dueAt: a.dueAt!, notes },
    });
    if (updRes.count > 0) {
      updated++;
      continue;
    }
    const existing = await prisma.taskInstance.findUnique({
      where: {
        unique_source_external: {
          source: "ACADEMIC",
          sourceExternalId: externalId,
        },
      },
      select: { id: true, status: true },
    });
    if (existing) {
      // status は DONE / SKIPPED(updateMany が拾わなかった)
      skipped++;
      continue;
    }
    try {
      await prisma.taskInstance.create({
        data: {
          title,
          dueAt: a.dueAt!,
          itemType: "TASK",
          required: true,
          priority: "MID",
          source: "ACADEMIC",
          sourceExternalId: externalId,
          notes,
        },
      });
      inserted++;
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2002"
      ) {
        // 並行 run が先に insert した → 何もしない
        skipped++;
      } else {
        throw e;
      }
    }
  }

  await prisma.manabaCredential.update({
    where: { id: cred.id },
    data: { lastSyncedAt: new Date(), lastError: null },
  });

  return {
    ok: true,
    fetched: assignments.length,
    target: target.length,
    pastSkipped,
    noDueSkipped,
    inserted,
    updated,
    skipped,
  };
}
