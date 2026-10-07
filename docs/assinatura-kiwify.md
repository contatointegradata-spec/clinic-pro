# Assinatura Clinic Pro via Kiwify

## Modelo comercial

- Produto único: **Clinic Pro**, R$ 49,90/mês, **3 dias de teste grátis** (`CLINIC_PRO_TRIAL_DAYS`).
- Sem tiers, sem upgrade/downgrade, sem cobrança por módulo.
- A assinatura é por "tenant" — no modelo de dados atual isso é o **doctorId**
  (o `User` com `role=DOCTOR` é o médico/especialista responsável e dono do
  tenant; não existe um model `Clinic`/`Tenant` separado neste projeto, nem um
  role `SPECIALIST` distinto — "Médico" e "Especialista" são o mesmo
  `role=DOCTOR` tecnicamente, só terminologia comercial diferente). Secretárias
  herdam o acesso da assinatura do médico a que estão vinculadas via
  `getEffectiveDoctorId()` — nunca têm trial, checkout ou assinatura própria.
- **Isso já era garantido antes desta entrega**: `POST /api/auth/register`
  (cadastro público) sempre cria `role: 'DOCTOR'` — não existe cadastro
  público de `SECRETARY`. Secretárias só são criadas via
  `POST /api/team/secretary` (autenticado, restrito a `DOCTOR`/`ADMIN`,
  `packages/backend/src/routes/team.ts`), já nascendo vinculadas ao
  `doctorId` de quem convidou. Não há como uma secretária criar um tenant
  independente, acidentalmente ou não.
- O bloqueio já é por tenant inteiro, não por usuário: o middleware resolve
  `getEffectiveDoctorId()` (médico → o próprio id; secretária → o id do
  médico vinculado) e consulta uma única `DoctorSubscription` — quando o
  médico está bloqueado, a secretária correspondente é bloqueada junto, sem
  precisar iterar usuário por usuário.

## O que foi implementado

### Backend
- `src/lib/billing-config.ts` — preço/trial/feature flags centralizados.
- `src/lib/subscription-access.ts` — `calculateClinicAccess()` (regra única de
  acesso, usada tanto no middleware quanto no endpoint de status),
  `ensureTrialSubscription()` (cria o trial de 7 dias, chamado dentro da
  transação de `POST /api/auth/register`), transições de estado válidas, e o
  watchdog que marca trials vencidos como `BLOCKED` a cada hora.
- `src/middleware/subscription.ts` — `requireActiveSubscription`, aplicado em
  `src/index.ts` nas rotas operacionais (`/api/appointments`, `/api/patients`,
  `/api/financial`, `/api/medical-records`, `/api/chatbot-light`,
  `/api/rooms`, `/api/documents`, `/api/notifications`,
  `/api/payment-methods`, `/api/integrations`, `/api/team`,
  `/api/my/rooms`, `/api/appointment-types`, `/api/appointment-blocks`,
  `/api/health-plans`). **Não** gateado: `/api/auth`, `/api/users`,
  `/api/doctors`, `/api/admin*` (admin de plataforma), `/api/version`,
  `/api/readiness`, `/api/subscription/*`, `/api/webhooks/kiwify`.
- `src/integrations/kiwify/` — `kiwify.types.ts` (payload cru), `kiwify.mapper.ts`
  (normaliza pra `NormalizedBillingEvent`), `kiwify.client.ts` (verificação de
  assinatura do webhook + montagem da URL de checkout + consulta best-effort
  de venda via API), `kiwify.service.ts` (processamento idempotente do
  webhook com transação).
- `src/routes/subscriptions.ts` — `GET /api/subscription/status`,
  `POST /api/subscription/checkout`, `POST /api/subscription/reconcile`.
- `src/routes/webhooks-kiwify.ts` — `POST /api/webhooks/kiwify` (público).
- `scripts/backfill-subscriptions.ts` — migração explícita para contas
  existentes (ver seção própria abaixo).
- Prisma: `DoctorSubscription`, `SubscriptionPayment`, `KiwifyWebhookEvent`,
  `SubscriptionCheckoutAttempt` (migration `20260713140000_add_kiwify_subscription`),
  `KiwifyIntegrationConfig` (migration `20260715120000_add_kiwify_integration_config`,
  linha única id="kiwify" — configuração administrável, ver seção abaixo).
- `src/lib/kiwify-config.ts` — resolve a configuração efetiva da integração:
  valores salvos no banco (via Admin > Integrações) têm prioridade, variáveis
  de ambiente `KIWIFY_*` entram só como fallback. `kiwify.client.ts` e
  `routes/webhooks-kiwify.ts` consultam essa função em vez de ler `process.env`
  diretamente.
- `src/routes/admin-integrations.ts` — `GET/PUT /api/admin/integrations/kiwify`
  (config, segredos mascarados), `POST .../webhook-secret/regenerate` (gera e
  devolve o segredo em texto puro uma única vez), `GET .../webhook-secret`
  (revela o segredo atual, auditado), `GET .../events` (últimos webhooks
  recebidos, pra debug).
- Status da assinatura (`SubscriptionStatusValue`, TypeScript, não enum
  Postgres): `TRIAL`, `ACTIVE`, `PENDING_PAYMENT`, `PAST_DUE`, `CANCELED`,
  `BLOCKED`. `PENDING_PAYMENT` existe para o caso de Pix/boleto gerado e ainda
  não confirmado — `kiwify.service.ts` só rebaixa o tenant pra esse status se
  ele **já não tiver** acesso garantido no momento (trial ou período pago
  ainda vigentes, calculado em tempo real via `calculateClinicAccess`, não
  pelo rótulo gravado no banco).

### Frontend
- `src/hooks/useSubscription.ts` — consulta `/api/subscription/status`.
- `src/components/SubscriptionGate.tsx` — envolve **apenas o `<Outlet/>`**
  dentro de `<main>` em `Layout.tsx` (não o shell inteiro). Cabeçalho, menu
  lateral e botão de sair continuam sempre visíveis e funcionais mesmo com o
  tenant bloqueado — importante pro médico conseguir navegar até a cobrança e
  pra equipe conseguir sair da conta. Bloqueia apenas o conteúdo da página
  quando `accessAllowed=false`, exceto `/configuracoes/assinatura*`,
  `/configuracoes/perfil` (conta) e `/configuracoes/ajuda` (suporte), que
  ficam sempre acessíveis. Médico (responsável) vê CTA de assinar; secretária
  vê aviso pra contatar o responsável.
- `src/components/ui/TrialBanner.tsx` — banner de trial (últimos 3 dias),
  montado ao lado do `VersionUpdateBanner` em `Layout.tsx` (sempre visível,
  independente da rota).
- `src/pages/configuracoes/Assinatura.tsx` — status, preço, trial, histórico
  de pagamentos, botão "Assinar" (abre checkout da Kiwify em nova aba) e
  "Já realizei o pagamento" (reconciliação).
- `src/pages/configuracoes/AssinaturaPendente.tsx` — polling de status a cada
  7s, redireciona pro dashboard assim que `accessAllowed=true`.
- `src/lib/api.ts` — interceptor redireciona pra `/configuracoes/assinatura`
  em qualquer resposta `402 SUBSCRIPTION_REQUIRED`.
- `src/pages/AdminIntegracoes.tsx` — menu **Admin > Integrações**
  (`/admin/integracoes`, só `role=ADMIN`): mostra o endpoint do webhook
  (`https://SEU_DOMINIO/api/webhooks/kiwify`) com botão de copiar, gera/revela/
  regenera o segredo do webhook, edita URL de checkout, product ID e (numa
  seção avançada colapsável) account ID/client ID/client secret pra
  reconciliação via API. Toggle "Integração ativa" liga/desliga o
  processamento do webhook sem precisar redeploy. Lista os últimos 20 eventos
  recebidos (tipo, pedido, status, erro) pra debug.

### Módulos removidos do produto (NFe, Teleconsulta, Avaliação)
NFe e Teleconsulta já tinham sido removidos numa entrega anterior (só existiam
como telas "em breve", sem integração real). Nesta entrega, **Avaliação**
(prontuário cognitivo — WISC-IV, WASI etc.) seguiu a mesma estratégia
incremental:
1. **Etapa 1 (feito)**: página `Avaliacoes.tsx` deletada, rota `/avaliacoes`
   removida do `App.tsx`, item removido do `Sidebar.tsx`.
2. **Etapa 2 (feito)**: rota `/api/assessments` desmontada em `src/index.ts`
   (comentário explica o porquê).
3. **Etapa 3 (feito)**: `src/routes/assessments.ts` e o model Prisma
   `Assessment`/tabela `TBLAVALIACAO` **continuam intactos**, só não são mais
   chamados por nada — reativar é só remontar a rota em `index.ts` e
   restaurar a página no frontend (o arquivo `Laudos.tsx`, órfão e não
   roteado, foi removido junto por ser do mesmo domínio).
4. **Etapa 4 (não feito, de propósito)**: remoção física da tabela/coluna só
   deve acontecer numa migration futura, depois de confirmar que ninguém
   precisa mais desses dados.

## Por que duas tabelas novas em vez de reaproveitar TBLASSINATURA

O sistema antigo de assinatura (MercadoPago, removido do código numa entrega
anterior) já criou as tabelas `TBLASSINATURA`/`TBLPAGAMENTOASSINATURA` em
produção, com colunas específicas do MercadoPago (`mpPaymentId`,
`billingCycle`, `adminNote` etc.) e sem conversão de tipo alguma pro Kiwify.
Reaproveitar essas tabelas exigiria uma migration de `ALTER COLUMN`/conversão
de dados que eu não consigo validar sem inspecionar o banco de produção ao
vivo. Para eliminar esse risco por completo, o sistema Kiwify usa tabelas
novas: `TBLASSINATURACLINICA` e `TBLPAGAMENTOCLINICA`. As tabelas antigas
continuam no banco, sem uso — sua limpeza é uma decisão separada e futura.

## Rollout seguro (bloqueio por assinatura)

O bloqueio real é ligado/desligado em **Admin › Integrações › "Bloqueio por
assinatura"** (coluna `enforceSubscription` em `TBLCONFIGKIWIFY`, cache de 30s
em `isSubscriptionEnforced()`). `SUBSCRIPTION_ENFORCEMENT_ENABLED=true` no
`.env` continua existindo só para forçar o bloqueio pelo servidor. Com o
bloqueio desligado, `/api/subscription/status` devolve `accessAllowed=true`
(a tela nunca bloqueia o que a API libera) e `subscriptionValid` com o valor real.

Ordem recomendada de ativação:
1. Publicar backend + migrations (`prisma migrate deploy`).
2. Configurar a Kiwify (seção abaixo) e validar com "Testar Webhook" + uma compra real.
3. Em Admin › Planos, usar **"Teste grátis para quem está sem acesso"** (ou
   liberar cortesia individual) para quem já usava o sistema.
4. Ligar o bloqueio em Admin › Integrações.

## Contas existentes e novos cadastros

- Cadastro público (`/api/auth/register`) e médico criado pelo admin
  (`POST /api/users`) nascem com `TRIAL` de 3 dias.
- O watchdog (startup + a cada hora) cria `TRIAL` para qualquer médico ativo
  ainda sem linha de assinatura, marca trial vencido como `BLOCKED` e período
  pago vencido (+ `CLINIC_PRO_GRACE_PERIOD_DAYS`, padrão 2) como `PAST_DUE`.
- `ACTIVE` sem `currentPeriodEndsAt` = **cortesia** (liberado pelo admin sem
  prazo); exibido como "Liberada", sem botão de pagar.

## Configuração no painel da Kiwify

1. **Apps › Webhooks**: no webhook do produto Clinic Pro, a **URL do Webhook**
   deve ser `https://cliniqpro.integradata.app.br/api/webhooks/kiwify`
   (exibida em Admin › Integrações) — **não** o link de pagamento. Eventos:
   "Selecionar todos".
2. Copie o **Token** desse webhook (gerado pela Kiwify, não editável) e cole em
   Admin › Integrações › "Token do webhook". A Kiwify chama
   `POST <url>?signature=<HMAC-SHA1(corpo JSON, token)>` — ver
   `verifyKiwifyWebhookSignature` em `kiwify.client.ts`.
3. Cole a URL de checkout (Produto › Links, tipo **Checkout**,
   `pay.kiwify.com.br/...`) e, opcionalmente, o ID do produto (o UUID da URL
   `dashboard.kiwify.com/products/edit/<id>`). Marque "Integração ativa" e salve.
4. "Testar Webhook" na Kiwify: o evento deve aparecer em "Últimos webhooks
   recebidos" como **Ignorado** (chegou e foi validado, só não é de um médico
   real). **Recusado** = token errado.

### Como o pagamento é ligado ao médico
`kiwify.service.ts:resolveDoctorId`, nesta ordem: `TrackingParameters.s1`
(injetado no checkout gerado pela Clinic Pro) → `subscription_id` da Kiwify já
vinculado → e-mail do comprador igual ao e-mail de um médico. Se nada bater, o
evento fica "Ignorado" e o admin usa **Vincular** na lista de webhooks.

### Eventos tratados (`webhook_event_type`)
`order_approved`/`subscription_renewed` → ACTIVE (período até
`Subscription.next_payment`, ou +1 mês) · `pix_created`/`billet_created` →
pagamento pendente · `order_rejected` → recusado · `subscription_late` →
PAST_DUE · `subscription_canceled` → CANCELED (mantém acesso até o fim do
período pago) · `order_refunded`/`chargeback` → BLOCKED. Carrinho abandonado é ignorado.

## Endpoints

| Método | Rota | Autenticação | Responsabilidade |
|---|---|---|---|
| GET | `/api/subscription/status` | qualquer papel | status atual + histórico |
| POST | `/api/subscription/checkout` | DOCTOR | gera URL de checkout Kiwify |
| POST | `/api/subscription/reconcile` | DOCTOR, rate-limited (15s) | verificação manual |
| POST | `/api/webhooks/kiwify` | segredo do webhook (não é sessão) | eventos de pagamento |
| GET | `/api/admin/integrations/kiwify` | ADMIN | config atual (segredos mascarados) |
| PUT | `/api/admin/integrations/kiwify` | ADMIN | atualiza checkout/produto/credenciais/toggle |
| POST | `/api/admin/integrations/kiwify/events/:id/assign` | ADMIN | vincula manualmente um pagamento não identificado |
| POST | `/api/admin/subscriptions/bulk-trial` | ADMIN | novo teste grátis para todo médico sem acesso |
| GET | `/api/admin/integrations/kiwify/webhook-secret` | ADMIN | revela o segredo atual (auditado) |
| GET | `/api/admin/integrations/kiwify/events` | ADMIN | últimos webhooks recebidos |

## Fluxo do webhook

Requisição → verifica `?signature=` (HMAC-SHA1 com o token da Kiwify; recusados
ficam registrados como `REJECTED`) → mapeia pro
formato interno (`mapKiwifyWebhook`) → valida `KIWIFY_PRODUCT_ID` se
configurado → gera `eventKey` (`kiwify:{tipo}:{orderId}:{data}`) →
`kiwifyWebhookEvent` com essa chave única garante idempotência → transação
atualiza `SubscriptionPayment` + `DoctorSubscription` respeitando as
transições válidas de estado (`VALID_SUBSCRIPTION_TRANSITIONS`) → sempre
responde HTTP 200 (mesmo em duplicidade/erro) pra Kiwify não reenviar em loop.

## Como testar localmente

```bash
npm run dev
curl http://localhost:3001/api/subscription/status -H "Authorization: Bearer <token>"

# Simular um webhook (TOKEN = token salvo em Admin > Integrações)
BODY='{"order_id":"teste123","order_status":"paid","webhook_event_type":"order_approved","Customer":{"email":"medico@teste.com"},"TrackingParameters":{"s1":"<doctorId>"}}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha1 -hmac "$TOKEN" | sed 's/^.* //')
curl -X POST "http://localhost:3001/api/webhooks/kiwify?signature=$SIG" \
  -H "Content-Type: application/json" -d "$BODY"
```

## Como reverter

- Desligar o bloqueio em Admin › Integrações desbloqueia todo mundo em até 30s,
  sem reverter migration nem dado nenhum (desde que
  `SUBSCRIPTION_ENFORCEMENT_ENABLED` não esteja `true` no `.env`).
- `SUBSCRIPTION_FEATURE_ENABLED=false` também esconde a consulta de status no
  frontend (o hook para de fazer polling).
- Nenhuma migration destrutiva foi criada — reverter o código não perde dados.

## Riscos e limitações conhecidas

- **Payload/assinatura da Kiwify não validados contra um evento real** — ver
  seção de configuração acima. Teste com uma compra de sandbox antes de
  confiar 100% no mapeamento.
- **Sem testes automatizados.** O projeto não tem framework de testes
  configurado (nem Jest/Vitest); adicionar um do zero é uma decisão maior
  que caberia numa entrega própria. A verificação desta entrega foi manual
  (type-check + smoke test dos endpoints).
- `GET /api/subscription/reconcile` via API da Kiwify é best-effort — sem
  `KIWIFY_CLIENT_ID`/`SECRET` configurados, ela não falha, só não confirma
  antecipadamente (o webhook continua sendo o caminho principal).
- O evento de automação `ASSESSMENT_COMPLETE` (chatbot) ficou órfão — não
  quebra nada, só nunca mais dispara, já que a rota de avaliações foi
  desmontada.
