# Backup e restauração do Postgres

## Como funciona

O serviço `backup` (ver `docker-compose.yml`) roda `scripts/backup-db.sh` uma
vez por dia: gera um `pg_dump` compactado (`.sql.gz`) com timestamp e grava
no volume nomeado `postgres_backups`, e apaga automaticamente backups mais
antigos que `BACKUP_RETENTION_DAYS` (padrão: 14 dias, configurável no
`.env`).

Os backups ficam **na própria VPS** (volume Docker) — se a VPS inteira for
perdida, os backups vão junto. Enviar uma cópia para armazenamento externo
(S3, Backblaze B2 etc.) fica para uma próxima rodada, quando houver
credencial de algum provedor.

## Rodar um backup manualmente

```bash
docker compose exec backup /scripts/backup-db.sh
```

## Listar backups existentes

```bash
docker compose exec backup ls -lh /backups
```

## Copiar um backup para fora da VPS

```bash
docker compose cp backup:/backups/clinicmedia_20261003_120000.sql.gz ./
```

## Restaurar um backup

**Atenção:** isto sobrescreve os dados atuais do banco. Confirme que é
exatamente o que você quer antes de rodar, e se possível tire um backup do
estado atual primeiro (passo acima).

```bash
# 1. Copiar o arquivo de backup para dentro do container do backup (se ainda
#    não estiver no volume /backups)
docker compose cp ./clinicmedia_20261003_120000.sql.gz backup:/backups/

# 2. Restaurar (ajuste o nome do arquivo)
docker compose exec backup sh -c \
  "gunzip -c /backups/clinicmedia_20261003_120000.sql.gz | psql \"\$DATABASE_URL\""
```

Depois de restaurar, reinicie o backend para garantir que ele não fique com
nenhuma conexão/estado em cache do banco anterior:

```bash
docker compose restart backend
```
