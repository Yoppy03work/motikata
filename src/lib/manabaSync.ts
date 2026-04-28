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
  return `manaba:${a.course}:${a.title}:${due}`.slice(0, 200);
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
    const existing = await prisma.taskInstance.findFirst({
      where: { source: "ACADEMIC", sourceExternalId: externalId },
    });
    if (existing) {
      if (existing.status !== "OPEN") {
        skipped++;
        continue;
      }
      await prisma.taskInstance.update({
        where: { id: existing.id },
        data: {
          title: `${a.course} / ${a.title}`,
          dueAt: a.dueAt!,
          notes: a.url ? `manaba: ${a.url}` : null,
        },
      });
      updated++;
    } else {
      await prisma.taskInstance.create({
        data: {
          title: `${a.course} / ${a.title}`,
          dueAt: a.dueAt!,
          itemType: "TASK",
          required: true,
          priority: "MID",
          source: "ACADEMIC",
          sourceExternalId: externalId,
          notes: a.url ? `manaba: ${a.url}` : null,
        },
      });
      inserted++;
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
