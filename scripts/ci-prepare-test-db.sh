#!/bin/sh
# Prepara um banco de TESTE no mesmo estado da produção e valida as migrations
# novas — usado pelo CI antes da suíte de integração.
#
#   DATABASE_URL=postgresql://…/clinic_test sh scripts/ci-prepare-test-db.sh <BASE_SHA>
#
# 1. Cria o schema da produção a partir do schema.prisma do commit BASE_SHA
#    (o último já implantado). As migrations antigas não sobem um banco do
#    zero — o banco de produção nasceu de `prisma db push` (ver
#    scripts/migrate.sh e docs/plano-de-melhorias.md, item 1.5).
# 2. Marca como aplicadas as migrations que já existiam em BASE_SHA.
# 3. Roda `prisma migrate deploy` → aplica só as migrations novas, como a VPS fará.
# 4. Confere que o banco resultante bate com o schema.prisma atual; qualquer
#    diferença (migration faltando ou errada) falha o CI.
set -eu

BASE_SHA="${1:-HEAD~1}"
BACKEND=packages/backend
SCHEMA="$BACKEND/prisma/schema.prisma"
PRISMA="npx --no-install prisma"
TMP=$(mktemp -d)

case "$DATABASE_URL" in
  *test*) ;;
  *) echo "[ci-db] Recusado: DATABASE_URL não parece ser de teste"; exit 2 ;;
esac

if git cat-file -e "$BASE_SHA:$SCHEMA" 2>/dev/null; then
  git show "$BASE_SHA:$SCHEMA" > "$TMP/base.prisma"
  git ls-tree --name-only "$BASE_SHA" "$BACKEND/prisma/migrations/" | xargs -n1 basename | grep -E '^[0-9]{8,}' > "$TMP/base-migrations.txt" || true
  echo "[ci-db] Base: $BASE_SHA ($(wc -l < "$TMP/base-migrations.txt" | tr -d ' ') migrations já aplicadas na produção)"
else
  echo "[ci-db] Base $BASE_SHA indisponível — usando o schema atual sem migrations novas"
  cp "$SCHEMA" "$TMP/base.prisma"
  ls "$BACKEND/prisma/migrations" | grep -E '^[0-9]{8,}' > "$TMP/base-migrations.txt"
fi

echo "[ci-db] 1/4 schema da produção (db push)"
$PRISMA db push --schema "$TMP/base.prisma" --skip-generate --accept-data-loss

echo "[ci-db] 2/4 marcando migrations da base como aplicadas"
while read -r m; do
  [ -d "$BACKEND/prisma/migrations/$m" ] || continue
  $PRISMA migrate resolve --schema "$SCHEMA" --applied "$m" > /dev/null
done < "$TMP/base-migrations.txt"

echo "[ci-db] 3/4 aplicando migrations novas"
$PRISMA migrate deploy --schema "$SCHEMA"

echo "[ci-db] 4/4 conferindo banco x schema.prisma"
if ! $PRISMA migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel "$SCHEMA" --exit-code > "$TMP/diff.sql"; then
  echo "[ci-db] ERRO: o banco após as migrations não bate com o schema.prisma. Falta migration ou ela está incompleta:"
  cat "$TMP/diff.sql"
  exit 1
fi
echo "[ci-db] OK — migrations consistentes com o schema"
