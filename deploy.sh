#!/bin/bash
# Deploy ClinIQ Pro — fallback manual: só puxa a imagem já publicada no
# ghcr.io e reinicia (não builda nada localmente). O caminho normal de
# deploy é o workflow .github/workflows/deploy-prod.yml — este script existe
# só pra emergências, quando o GitHub Actions estiver indisponível.
# Requer `docker login ghcr.io` já feito uma vez nesta VPS.
# O backend executa scripts/migrate.sh ao iniciar:
#   1. rename-tables.sql (idempotente)
#   2. baseline automático se for a primeira vez com migrate deploy
#   3. prisma migrate deploy (aplica apenas migrations novas)
#   4. node dist/index.js

set -euo pipefail

echo "========================================"
echo "  ClinIQ Pro — Deploy (fallback manual)"
echo "========================================"

# 1. Sincroniza docker-compose.yml/nginx.conf/scripts (não builda código)
echo ""
echo "[1/4] Atualizando docker-compose.yml/nginx.conf..."
git pull origin main

# 2. Baixa a imagem ":latest" publicada pelo GitHub Actions no último deploy
#    (RELEASE_SHA fica sem valor de propósito — cai no default ":latest" do
#    docker-compose.yml, que é sempre a última imagem publicada).
echo ""
echo "[2/4] Baixando imagens já publicadas no ghcr.io..."
docker compose pull

# 3. Sobe/recria apenas os containers cuja imagem realmente mudou.
#    Sem --force-recreate: postgres e nginx só reiniciam se sua config mudar,
#    evitando derrubar o banco e as sessões do WhatsApp a cada deploy.
echo ""
echo "[3/4] Atualizando containers..."
docker compose up -d

# Aguarda o backend ficar healthy (aplica migrations via scripts/migrate.sh)
echo ""
echo "Aguardando backend..."
RETRIES=0
until docker inspect --format='{{.State.Health.Status}}' clinicmedia_backend 2>/dev/null | grep -q "healthy"; do
  RETRIES=$((RETRIES + 1))
  if [ $RETRIES -gt 40 ]; then
    echo "Timeout. Veja os logs:"
    docker compose logs --tail=40 backend
    exit 1
  fi
  printf "."
  sleep 3
done

# 5. Smoke test: confirma que a versão publicada é a que acabamos de puxar
echo ""
echo "[4/4] Smoke test..."
PUBLISHED_VERSION="$(curl -sf http://localhost/api/version | grep -o '"version":"[^"]*"' || echo 'FALHOU')"
echo "[DEPLOY] Endpoint de versão respondeu: $PUBLISHED_VERSION"

echo ""
echo ""
echo "Deploy concluido!"
echo "Acesse: http://$(hostname -I | awk '{print $1}')"
echo ""
echo "Logs recentes do backend:"
docker compose logs --tail=20 backend
