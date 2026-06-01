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

// 課題 1 つを安定的に識別するキー。
//
// 設計上の注意:
//   旧版は dueAt を含めていたため、教員が締切を延長/短縮するたびに同じ
//   課題なのに別の externalId が生まれ、updateMany が外して INSERT が走り
//   重複行を作っていた(古い締切のまま OPEN な行が残り、Reminder も二重)。
//
//   URL は manaba 上の課題詳細ページのリンクで、締切とは独立に安定する。
//   URL が取れる場合はそれを採用し、取れない場合のみ (course, title) で
//   フォールバックする(dueAt は絶対に含めない)。
function externalIdOf(a: ManabaAssignment): string {
  if (a.url) {
    const key = `manaba:url:${a.url}`;
    if (key.length <= 200) return key;
    const hash = createHash("sha256").update(a.url).digest("hex");
    return `manaba:url:hash:${hash}`;
  }
  const natural = `manaba:${a.course}:${a.title}`;
  if (natural.length <= 200) return natural;
  const hash = createHash("sha256").update(natural).digest("hex");
  return `manaba:hash:${hash}`;
}

// 旧キー (manaba:<course>:<title>:<dueAt>) で既存行を探す。
// 移行期間用の adoption ヘルパ。
function legacyKeyPrefix(a: ManabaAssignment): string {
  return `manaba:${a.course}:${a.title}:`;
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
    // Adoption: 旧版は externalId に dueAt を含めていたので、現行 URL ベース
    // キーでは新規扱いになるが、同じ (course, title) を旧スキームで持つ
    // OPEN 行がまだ DB に残っていれば、それを再 key して使い回す。
    // 同じ assignment が「締切延長で重複」する根本原因の修復。
    const legacyOpen = await prisma.taskInstance.findFirst({
      where: {
        source: "ACADEMIC",
        sourceExternalId: { startsWith: legacyKeyPrefix(a) },
        status: "OPEN",
      },
      select: { id: true },
    });
    if (legacyOpen) {
      try {
        await prisma.taskInstance.update({
          where: { id: legacyOpen.id },
          data: {
            title,
            dueAt: a.dueAt!,
            notes,
            sourceExternalId: externalId,
          },
        });
        updated++;
      } catch (e) {
        // 同じ URL key の新規行が並行 run で既に作られていれば P2002。
        // その場合は今回の adoption は捨てて skip 扱い(新行が正)。
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === "P2002"
        ) {
          skipped++;
        } else {
          throw e;
        }
      }
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
    // 旧スキームの DONE / SKIPPED 行も保護する。完了済み課題を再 INSERT
    // して未完了状態に巻き戻さない。
    const legacyDone = await prisma.taskInstance.findFirst({
      where: {
        source: "ACADEMIC",
        sourceExternalId: { startsWith: legacyKeyPrefix(a) },
        status: { not: "OPEN" },
      },
      select: { id: true },
    });
    if (legacyDone) {
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
