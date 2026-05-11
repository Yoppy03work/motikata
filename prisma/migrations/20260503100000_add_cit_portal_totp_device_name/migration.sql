-- AlterTable: Keycloakクレデンシャル選択画面用のデバイス名(任意)
ALTER TABLE "CitPortalCredential" ADD COLUMN "totpDeviceName" TEXT;
