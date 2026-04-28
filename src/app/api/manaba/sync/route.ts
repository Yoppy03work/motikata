// manaba 課題同期エンドポイント。
//
// 流れ:
//   1. ManabaCredential を読み出してパスワード復号
//   2. fetchManabaAssignments でスクレイプ
//   3. 取得した課題を TaskInstance に upsert
//      - 重複検知: (source=ACADEMIC, sourceExternalId=manaba:<title>:<dueAt>)
//      - 既に DONE / SKIPPED のタスクは更新しない
//   4. lastSyncedAt / lastError を ManabaCredential に書き戻す

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuthApi } from "@/lib/authGuard";
import { decryptManabaPassword } from "@/lib/manabaCrypto";
import {
  fetchManabaAssignments,
  ManabaError,
  type ManabaAssignment,
} from "@/lib/manabaScrape";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function externalIdOf(a: ManabaAssignment): string {
  // 同一課題の重複検知用キー。期限が変更されると別物として扱われる(意図的)
  const due = a.dueAt ? a.dueAt.toISOString() : "no-due";
  return `manaba:${a.course}:${a.title}:${due}`.slice(0, 200);
}

export async function POST() {
  const guard = await requireAuthApi();
  if (guard) return guard;

  const cred = await prisma.manabaCredential.findFirst();
  if (!cred) {
    return NextResponse.json(
      { error: "manaba 認証情報が登録されていません" },
      { status: 400 },
    );
  }

  let plainPassword: string;
  try {
    plainPassword = decryptManabaPassword(cred.passwordEnc);
  } catch {
    return NextResponse.json(
      { error: "認証情報の復号に失敗しました(SESSION_SECRET を変更しましたか?)" },
      { status: 500 },
    );
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
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  // 期限がある + まだ未来のものだけを取り込み対象にする。
  // 過去課題はノイズになるだけ(完了済みは manaba 側で消えるが、
  // 未提出のまま期限超過した課題も持ち越さない方針)
  const now = new Date();
  const target = assignments.filter((a) => a.dueAt && a.dueAt > now);
  const pastSkipped = assignments.filter((a) => a.dueAt && a.dueAt <= now).length;
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
      // 完了済 / スキップ済はそのまま
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

  return NextResponse.json({
    ok: true,
    fetched: assignments.length,
    target: target.length,
    pastSkipped,
    noDueSkipped,
    inserted,
    updated,
    skipped,
  });
}
