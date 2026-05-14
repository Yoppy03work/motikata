-- Singleton 化: 並行書き込みでの重複行を DB で防ぐ。
--
-- 過去の race condition で複数行が出来ている可能性があるので、
-- まず最新 (updatedAt が新しい) の行だけ残して古い重複行を削除する。
-- そうしないと、デフォルト値 'default' の一意インデックス作成で
-- "duplicate key value" エラーが出てデプロイが止まる。
--
-- updatedAt の同点は id の大きい方を採用(自動採番 = 後から作られた方)。

DELETE FROM "ManabaCredential" t1
USING "ManabaCredential" t2
WHERE t1.id <> t2.id
  AND (t2."updatedAt", t2.id) > (t1."updatedAt", t1.id);

DELETE FROM "CitPortalCredential" t1
USING "CitPortalCredential" t2
WHERE t1.id <> t2.id
  AND (t2."updatedAt", t2.id) > (t1."updatedAt", t1.id);

-- 列追加 + 一意インデックス。dedupe 後なので default 'default' で衝突しない。

ALTER TABLE "ManabaCredential" ADD COLUMN "singletonKey" TEXT NOT NULL DEFAULT 'default';
ALTER TABLE "CitPortalCredential" ADD COLUMN "singletonKey" TEXT NOT NULL DEFAULT 'default';

CREATE UNIQUE INDEX "ManabaCredential_singletonKey_key" ON "ManabaCredential"("singletonKey");
CREATE UNIQUE INDEX "CitPortalCredential_singletonKey_key" ON "CitPortalCredential"("singletonKey");
