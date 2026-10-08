#!/bin/sh
# Backup diário do Postgres — roda dentro do serviço `backup` do
# docker-compose.yml (imagem postgres:16-alpine, mesma versão do servidor,
# então pg_dump é sempre compatível). Ver docs/backup-restore.md.
#
# Além do dump, verifica se o arquivo é íntegro (gzip válido + rodapé do
# pg_dump presente) e grava $BACKUP_DIR/status.json — o backend lê esse
# arquivo (volume montado só-leitura) para mostrar a saúde do backup e
# alertar o administrador quando o último backup válido estiver velho.
set -u

BACKUP_DIR="${BACKUP_DIR:-/backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
FILE="$BACKUP_DIR/clinicmedia_${TIMESTAMP}.sql.gz"
STATUS_FILE="$BACKUP_DIR/status.json"

mkdir -p "$BACKUP_DIR"

write_status() {
  # $1 = ok|error  $2 = mensagem  $3 = arquivo  $4 = bytes
  NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  LAST_OK="null"
  if [ "$1" = "ok" ]; then
    LAST_OK="\"$NOW\""
  elif [ -f "$STATUS_FILE" ]; then
    # preserva o último sucesso conhecido
    PREV=$(sed -n 's/.*"lastSuccessAt": *\("[^"]*"\).*/\1/p' "$STATUS_FILE")
    [ -n "$PREV" ] && LAST_OK="$PREV"
  fi
  COUNT=$(ls "$BACKUP_DIR"/clinicmedia_*.sql.gz 2>/dev/null | wc -l | tr -d ' ')
  cat > "$STATUS_FILE.tmp" <<EOF
{"status": "$1", "checkedAt": "$NOW", "lastSuccessAt": $LAST_OK, "file": "$(basename "$3")", "bytes": $4, "retentionDays": $RETENTION_DAYS, "backupsKept": $COUNT, "message": "$2"}
EOF
  mv "$STATUS_FILE.tmp" "$STATUS_FILE"
}

echo "[backup] Iniciando dump em $FILE..."
# Sem pipefail no sh: uma falha do pg_dump aparece na verificação do rodapé abaixo.
if ! pg_dump "$DATABASE_URL" | gzip > "$FILE"; then
  echo "[backup] ERRO: pg_dump falhou"
  rm -f "$FILE"
  write_status "error" "pg_dump falhou" "$FILE" 0
  exit 1
fi

# Verificação: gzip íntegro e dump completo (o pg_dump escreve este rodapé
# só quando termina sem erro).
if ! gzip -t "$FILE"; then
  echo "[backup] ERRO: arquivo gzip corrompido"
  rm -f "$FILE"
  write_status "error" "arquivo gzip corrompido" "$FILE" 0
  exit 1
fi
if ! gzip -dc "$FILE" | tail -n 20 | grep -q "PostgreSQL database dump complete"; then
  echo "[backup] ERRO: dump incompleto (rodapé ausente)"
  rm -f "$FILE"
  write_status "error" "dump incompleto" "$FILE" 0
  exit 1
fi

BYTES=$(wc -c < "$FILE" | tr -d ' ')
echo "[backup] Dump verificado: $(du -h "$FILE" | cut -f1)"

echo "[backup] Removendo backups com mais de ${RETENTION_DAYS} dias..."
find "$BACKUP_DIR" -name 'clinicmedia_*.sql.gz' -type f -mtime "+${RETENTION_DAYS}" -delete

write_status "ok" "backup verificado" "$FILE" "$BYTES"

echo "[backup] Backups atuais:"
ls -lh "$BACKUP_DIR" | grep clinicmedia_ || echo "  (nenhum)"
