#!/bin/sh
# Backup diário do Postgres — roda dentro do serviço `backup` do
# docker-compose.yml (imagem postgres:16-alpine, mesma versão do servidor,
# então pg_dump é sempre compatível). Ver docs/backup-restore.md.
set -eu

BACKUP_DIR="${BACKUP_DIR:-/backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
FILE="$BACKUP_DIR/clinicmedia_${TIMESTAMP}.sql.gz"

mkdir -p "$BACKUP_DIR"

echo "[backup] Iniciando dump em $FILE..."
pg_dump "$DATABASE_URL" | gzip > "$FILE"
echo "[backup] Dump concluído: $(du -h "$FILE" | cut -f1)"

echo "[backup] Removendo backups com mais de ${RETENTION_DAYS} dias..."
find "$BACKUP_DIR" -name 'clinicmedia_*.sql.gz' -type f -mtime "+${RETENTION_DAYS}" -delete

echo "[backup] Backups atuais:"
ls -lh "$BACKUP_DIR" | grep clinicmedia_ || echo "  (nenhum)"
