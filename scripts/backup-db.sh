#!/usr/bin/env bash
# Postgres バックアップ。pg_dump でスキーマ + データを 1 ファイルに出す。
#
# 使い方:
#   scripts/backup-db.sh              # ./backups/<timestamp>.sql.gz に保存
#   BACKUP_DIR=/path scripts/backup-db.sh
#
# cron 例 (crontab -e):
#   30 3 * * * cd /path/to/app && scripts/backup-db.sh >> backups.log 2>&1
#
# 古いバックアップは MAX_KEEP 件以上で自動削除(既定 14 個)

set -euo pipefail

# .env の DATABASE_URL を尊重(なければ既定の接続)
if [ -f ".env" ]; then
  set -o allexport
  # shellcheck disable=SC1091
  . ./.env
  set +o allexport
fi

BACKUP_DIR="${BACKUP_DIR:-./backups}"
MAX_KEEP="${MAX_KEEP:-14}"
TS="$(date +%Y%m%d_%H%M%S)"
mkdir -p "$BACKUP_DIR"

OUT="$BACKUP_DIR/mochikata_$TS.sql.gz"

# DATABASE_URL=postgresql://user:pass@host:port/db?... を pg_dump に渡す
if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is not set"
  exit 1
fi

# Docker compose 上の Postgres に接続するなら、コンテナ越しの方が安全。
# ホストから直接 pg_dump を打つ場合は postgres client が必要。
if docker compose ps postgres --status running 2>/dev/null | grep -q postgres; then
  echo "Using docker exec mochikata-postgres pg_dumpall..."
  docker exec -i mochikata-postgres pg_dump -U "${POSTGRES_USER:-mochikata}" -d "${POSTGRES_DB:-mochikata}" --clean --if-exists \
    | gzip > "$OUT"
else
  echo "Using host pg_dump on $DATABASE_URL"
  pg_dump --clean --if-exists --dbname="$DATABASE_URL" | gzip > "$OUT"
fi

echo "Wrote $OUT ($(du -h "$OUT" | cut -f1))"

# 古いものを削除(timestamp 順、MAX_KEEP 個まで残す)
find "$BACKUP_DIR" -maxdepth 1 -name "mochikata_*.sql.gz" -type f \
  | sort -r \
  | tail -n +$((MAX_KEEP + 1)) \
  | xargs -I {} rm -v "{}"

echo "Backup done."
