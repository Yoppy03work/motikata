-- Singleton 化: 並行書き込みでの重複行を DB で防ぐ。
-- 既存行(1行のみ想定)はデフォルト値 'default' が入る。

ALTER TABLE "ManabaCredential" ADD COLUMN "singletonKey" TEXT NOT NULL DEFAULT 'default';
ALTER TABLE "CitPortalCredential" ADD COLUMN "singletonKey" TEXT NOT NULL DEFAULT 'default';

CREATE UNIQUE INDEX "ManabaCredential_singletonKey_key" ON "ManabaCredential"("singletonKey");
CREATE UNIQUE INDEX "CitPortalCredential_singletonKey_key" ON "CitPortalCredential"("singletonKey");
