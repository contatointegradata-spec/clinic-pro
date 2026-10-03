# Ativar HTTPS (quando o domínio estiver comprado e apontado)

O sistema roda hoje em HTTP puro pelo IP da VPS. Tudo abaixo é o passo a passo
para ativar HTTPS com Let's Encrypt quando o domínio existir — até lá, nada
muda no comportamento atual.

## Pré-requisito

O domínio (ex. `app.suaclinica.com.br`) precisa já estar com o DNS (registro
`A`) apontando para o IP da VPS **antes** do passo 3 — o Let's Encrypt valida
isso.

## Passos

1. **Configurar o `.env` na VPS**

   ```
   DOMAIN=app.suaclinica.com.br
   LETSENCRYPT_EMAIL=seu-email@dominio.com
   ```

   Suba essa mudança com `docker compose up -d nginx` (só recria o nginx, que
   já vai ler `DOMAIN` para o envsubst).

2. **Confirmar que o desafio HTTP funciona**

   Acesse `http://SEU_DOMINIO/.well-known/acme-challenge/teste` — deve dar
   404 (não erro de conexão/DNS). Se der erro de conexão, o DNS ainda não
   propagou ou a porta 80 não está acessível.

3. **Emitir o certificado** (primeira vez, método webroot)

   ```bash
   docker compose run --rm certbot certonly \
     --webroot -w /var/www/certbot \
     -d "$DOMAIN" \
     --email "$LETSENCRYPT_EMAIL" \
     --agree-tos --no-eff-email
   ```

   Isso grava o certificado no volume `certbot_certs` (`/etc/letsencrypt/live/$DOMAIN/`).

4. **Ativar o bloco HTTPS no nginx**

   ```bash
   mv nginx/templates/https.conf.template.disabled nginx/templates/https.conf.template
   ```

   Edite `nginx/templates/default.conf.template` e descomente o bloco de
   redirecionamento HTTP → HTTPS (procure por "Ativação do HTTPS" no
   arquivo).

5. **Reiniciar o nginx**

   ```bash
   docker compose up -d nginx
   ```

   O envsubst do container substitui `${DOMAIN}` automaticamente no template
   HTTPS a cada start.

6. **Testar tudo antes de confiar no CSP**

   O bloco HTTPS já vem com headers de segurança (HSTS, X-Frame-Options,
   Referrer-Policy e um Content-Security-Policy). Depois de ativar, navegue
   pelo sistema inteiro (login, agenda, pacientes, prontuário, financeiro,
   configurações, admin, upload de avatar, QR code do WhatsApp) e observe o
   console do navegador por erros de CSP (`Content-Security-Policy:
   ... blocked`). Se algo quebrar, ajuste a diretiva correspondente em
   `nginx/templates/https.conf.template` (não precisa reemitir certificado,
   só `docker compose up -d nginx` depois de editar). Se preferir validar com
   mais segurança antes de bloquear de verdade, troque temporariamente o
   header `Content-Security-Policy` por
   `Content-Security-Policy-Report-Only` — ele só reporta violações no
   console sem bloquear nada.

## Renovação do certificado

Certificados Let's Encrypt duram 90 dias. Renovar (pode rodar manualmente a
cada ~60 dias, ou agendar via cron na VPS):

```bash
docker compose run --rm certbot renew
docker compose exec nginx nginx -s reload
```

## Rollback

Se algo der errado depois de ativar, desfazer é só reverter o passo 4 (volte
a renomear `https.conf.template` para `.disabled` e comente de novo o
redirecionamento) e `docker compose up -d nginx` — o sistema volta a servir
só por HTTP, exatamente como hoje. Nenhum dado é alterado por esse processo.
