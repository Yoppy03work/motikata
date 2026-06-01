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
      /** 取消し / 取り下げ済み(スクレイプに出なかった既存 OPEN 行) */
      canceled: number;
      /**
       * スクレイプ結果が不完全に見えたので取消し検知を見送ったか。
       * true のとき canceled は常に 0。次回 sync で正常パースできれば
       * 自動回復する。
       */
      cancellationSkipped: boolean;
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
  // dueAt が無い行はそもそも識別子も振りようがないのでここでスキップ。
  const withDue = assignments.filter((a) => !!a.dueAt);
  const noDueSkipped = assignments.length - withDue.length;
  // 旧版は ここで「dueAt > now」だけを target にして past を完全に捨てていた。
  // しかし教員が締切を「未来 → 過去(短縮)」に動かしたケースでは、DB 上の
  // 既存 OPEN 行は古い未来の dueAt のまま残り、cleanup ジョブの dueAt<now
  // 条件にも引っかからず、stale な通知が発火し続けていた。
  // 修正方針: 全 assignment(過去/未来問わず)を update ループに流す。
  //   - 既存行があれば dueAt を上書きする(未来から過去への変更を反映)。
  //     → status=OPEN かつ過去 dueAt になった行は次の cleanup-past-tasks で消える。
  //   - 既存行が無い新規 assignment は、過去の dueAt の場合のみ insert を抑止。
  //     (parseDueDate の yearless rollover 抑制と同じ「ファントム課題」防止)
  const target = withDue;
  let pastSkipped = 0; // 「過去 dueAt の新規 → insert 抑止」だけを集計する。

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
    // ここまで来た = 新規 assignment(対応する既存 TaskInstance が無い)。
    // 過去 dueAt の新規行は insert しない: 「閉じている課題」「年なし日付の
    // 誤推定」を ファントムタスクとして materialize するのを避ける。
    if (a.dueAt! <= now) {
      pastSkipped++;
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

  // 取り消し検知: スクレイプ結果に現れなくなった既存 OPEN 行は、教員が
  // 課題を削除/取り下げ/withdraw した可能性が高い。そのまま放置すると
  // 古い deadline で通知が飛ぶし、cleanup-past-tasks はその deadline を
  // 超えるまで消してくれない。
  //
  // 戦略: 「今回スクレイプで生きていた externalId」のセットを作り、それ
  // 以外で source=ACADEMIC + status=OPEN + manaba プレフィクスのものを
  // SKIPPED に倒す。紐づく未送信 Reminder も SKIPPED にする(ただし
  // dispatch 中のものは触らない: completion endpoint と同じ claimedAt
  // 保護を踏襲)。
  //
  // 注意: 上の update ループで legacy adoption により sourceExternalId を
  // 新キー(externalIdOf(a))に書き換えているので、ここでは「livesExternalIds
  // が新キーだけ」で確認すれば足りる。
  //
  // 安全装置 (Codex P1 3333846942): manaba 側で HTML 構造や日付表記が変わると
  // parseAssignmentsHtml が 0 行を返したり、parseDueDate が一括 null を返したり
  // することがあり、その状態のまま reconciliation を走らせると「全 OPEN 課題が
  // 取り消された」と誤判定して全部 SKIPPED に倒れる。citPortalSync と同じく
  // 「明らかに壊れた scrape」の場合は破壊的更新を見送る。
  const existingOpenCount = await prisma.taskInstance.count({
    where: {
      source: "ACADEMIC",
      status: "OPEN",
      sourceExternalId: { startsWith: "manaba:" },
    },
  });
  // 壊れたとみなすパターン:
  //   - assignments=0 (HTML 構造変更でテーブル行を 1 つも掴めなかった)
  //   - withDue=0 だが assignments>0 (テーブル行はあるが dueAt が一切
  //     パースできなかった = 日付フォーマット regression)
  const scrapeLooksBroken =
    assignments.length === 0 ||
    (withDue.length === 0 && assignments.length > 0);
  const shouldReconcileCancellation =
    !scrapeLooksBroken || existingOpenCount === 0;
  let canceled = 0;
  let cancellationSkipped = false;
  if (shouldReconcileCancellation) {
    // 重要: liveExternalIds は target (= withDue) ではなく assignments 全件
    // から作る。externalIdOf は URL / course / title だけを使って dueAt に
    // 依存しないので、dueAt のパースに失敗した行も「ページ上には存在する =
    // 取消しではない」とちゃんと判定できる。
    // target にすると、部分的に日付フォーマットが regression した時に
    // 「dueAt が読めなかった既存課題」を 取消し と誤判定して SKIPPED に
    // 倒す事故になる (Codex P1 3333885417)。
    const liveExternalIds = assignments.map((a) => externalIdOf(a));
    const orphans = await prisma.taskInstance.findMany({
      where: {
        source: "ACADEMIC",
        status: "OPEN",
        sourceExternalId: { startsWith: "manaba:" },
        NOT: { sourceExternalId: { in: liveExternalIds } },
      },
      select: { id: true },
    });
    if (orphans.length > 0) {
      const orphanIds = orphans.map((o) => o.id);
      const upd = await prisma.taskInstance.updateMany({
        where: { id: { in: orphanIds }, status: "OPEN" },
        data: { status: "SKIPPED" },
      });
      canceled = upd.count;
      const staleClaim = new Date(Date.now() - 5 * 60_000);
      await prisma.reminder.updateMany({
        where: {
          instanceId: { in: orphanIds },
          status: "PENDING",
          OR: [{ claimedAt: null }, { claimedAt: { lt: staleClaim } }],
        },
        data: { status: "SKIPPED" },
      });
    }
  } else {
    cancellationSkipped = true;
  }

  // lastError: 取消し検知を見送ったときだけ warning メッセージを残す。
  // 通常成功時はクリアする(過去のエラーが残っていれば消す)。
  const warnMsg = cancellationSkipped
    ? `スクレイプが不完全(assignments=${assignments.length}, withDue=${withDue.length})` +
      ` のため取消し検知を見送り(既存 OPEN ${existingOpenCount} 件を保護)`
    : null;
  await prisma.manabaCredential.update({
    where: { id: cred.id },
    data: { lastSyncedAt: new Date(), lastError: warnMsg },
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
    canceled,
    cancellationSkipped,
  };
}
