# Plano de melhorias — confiança antes de novas telas

Origem: avaliação crítica da plataforma do ponto de vista de uma clínica de
odontologia/estética (out/2026). Conclusão: o produto já cobre o ciclo de
receita da clínica; o que impede uma clínica de adotá-lo como sistema
principal é **confiança** (WhatsApp, testes, backup) e **segurança jurídica**
(termos assinados, receituário). A regra deste plano é: **não criar telas
novas quando uma existente resolve** — consertar, destravar e endurecer o que
já existe.

Legenda de status: ✅ feito · 🚧 em andamento · ⬜ pendente

---

## Fase 1 — Confiabilidade (base para tudo)

### 1.1 Testes automatizados dos fluxos críticos ✅
**Problema:** zero testes; cada deploy pode quebrar o que funcionava.
**Solução:** suíte de integração em `packages/backend/tests/` usando o test
runner nativo do Node (`node --test`) + `fetch` contra o servidor real e um
Postgres descartável — sem dependências novas.
Fluxos cobertos:
- cadastro → teste grátis → login
- isolamento entre clínicas (paciente, prontuário clínico, fotos, orçamentos)
- odontograma, mapa de aplicação com baixa de estoque (sem estoque negativo)
- orçamento: envio → link público → aprovação → sessões → conclusão;
  link inválido; orçamento aprovado não pode ser editado nem respondido 2×
- retorno programado: concluir atendimento cria; reagendar marca "agendado"
- automações de mensagens (Fase 2.1)
Como rodar: `npm run test:integration -w packages/backend` (precisa de
`DATABASE_URL` apontando para um banco **de teste**).

### 1.2 Deploy só com testes verdes ✅
**Problema:** o deploy em produção roda a cada push na `main` sem nenhum teste.
**Solução:** job `test` no `deploy-prod.yml` (Postgres como service do
GitHub Actions, `prisma migrate deploy` + suíte de integração). O job
`build` depende de `test`; se falhar, nada vai para a VPS. O `ci.yml`
roda o mesmo em PRs.
Também valida a migração: o banco de teste é criado pelas migrations reais,
não por `db push` — uma migration quebrada barra o deploy.

### 1.3 Backup verificável ✅
**Problema:** o backup diário existe (`scripts/backup-db.sh`), mas ninguém
sabe se ele está rodando nem se o arquivo é restaurável.
**Solução:**
- o script valida o arquivo (`gzip -t` + rodapé "PostgreSQL database dump
  complete") e grava `/backups/status.json` (data, tamanho, ok/erro);
- o volume de backups é montado só-leitura no backend;
- `GET /api/health/details` (administrador) mostra banco, idade do último
  backup e conexões de WhatsApp;
- alerta no sininho do administrador se o último backup válido tiver mais de 36 h.
**Pendente (⬜ 1.3b):** cópia fora da VPS (S3/Backblaze/Google Drive via
rclone). Hoje backup e banco estão no mesmo disco: se a VPS for perdida,
perde-se os dois. Precisa de uma conta de armazenamento do dono do produto.

### 1.4 Monitoramento do WhatsApp ✅
**Problema:** quando o número é deslogado/banido (`loggedOut`) ninguém é
avisado; o alerta só existia após vários ciclos de quarentena.
**Solução:**
- `loggedOut` → alerta imediato para a equipe da clínica ("reconecte o QR");
- desconectado há mais de 10 min → alerta único (deduplicado por queda);
- estado das conexões no `/api/health/details`.

### 1.5 Instalação do zero pelas migrations ⬜
**Achado ao montar o CI:** `prisma migrate deploy` num banco vazio falha
(`TBLPRONTUARIO does not exist`) — o histórico de migrations pressupõe o
banco de produção criado por `db push` + `rename-tables.sql`. Hoje não é
possível subir um ambiente novo (homologação, segunda VPS) só com as
migrations. O CI contorna recriando o schema do commit base
(`scripts/ci-prepare-test-db.sh`).
**Solução proposta:** gerar uma migration "baseline" consolidada e marcar
as antigas como aplicadas na produção (operação manual, com backup antes).

---

## Fase 2 — Destravar o que já existe

### 2.1 Mensagens automáticas configuráveis ✅
**Problema:** lembretes 24 h/2 h, retorno programado, aniversário, reativação
e pagamento em atraso **já existem no motor**, mas não há onde ligá-los. A
página Configurações › Notificações era decorativa (botões sem efeito e
"em breve").
**Solução (sem tela nova):** a própria página Notificações passa a listar as
mensagens automáticas reais: liga/desliga, texto editável com variáveis,
pré-visualização e aviso quando o WhatsApp da clínica não está conectado.
Backend: `GET/PUT /api/automations` cria/atualiza o template e a automação no
chatbot padrão da clínica (e vincula sozinho a sala quando só existe um
WhatsApp conectado). O retorno programado só é marcado como "avisado" se a
mensagem realmente tinha por onde sair; senão continua na lista da equipe.
A página deixou de exigir a permissão de desenvolvedor (era escondida por
ser decorativa) — agora aparece para profissional e recepção.

### 2.2 Termo de consentimento assinado pelo celular ⬜
Mesmo mecanismo do orçamento público: o documento gerado (Documentos) ganha
"Enviar para assinatura"; a paciente abre o link, lê, desenha a assinatura e
confirma o nome. Guardamos imagem da assinatura, hash SHA-256 do texto, data,
IP e user-agent; PDF final com a assinatura.
*Não substitui assinatura ICP-Brasil, mas é prova muito superior ao aceite verbal.*

### 2.3 Teste grátis compatível com o ciclo de avaliação ⬜
3 dias não bastam para configurar e ver um retorno acontecer. Decisão de
negócio do dono: `CLINIC_PRO_TRIAL_DAYS` já é configurável; recomendação 7–14.

---

## Fase 3 — Lacunas que barram a compra (pequenas)

| # | Item | Onde entra (tela existente) | Status |
|---|------|------------------------------|--------|
| 3.1 | Anamnese de estética (alergias, anticoagulantes, gestação, procedimentos anteriores, expectativas) | formulário de anamnese do Prontuário | ⬜ |
| 3.2 | Estoque fracionado (frasco de toxina 100 U → baixa em U) | Estoque + baixa do mapa de aplicação | ⬜ |
| 3.3 | Link de agendamento online (bio do Instagram) | Configurações › Salas (gera link) + página pública | ⬜ |
| 3.4 | Receituário (modelo + impressão; controle especial) | Documentos | ⬜ |

## Fase 4 — WhatsApp oficial (risco estrutural)

O WhatsApp hoje usa conexão não oficial (Baileys): risco de banimento do
número e quedas. Oferecer a **API oficial (Meta Cloud API)** como opção —
mesmo contrato `sendMessage` atrás de um adaptador, escolhido por sala.
Exige conta Business verificada e templates aprovados pela Meta para
mensagens ativas (lembretes) — por isso é fase própria. ⬜

---

## Navegação centrada na paciente (out/2026) ✅

**Problema:** prontuário, orçamentos, retornos e documentos ficavam em menus
separados — para atender uma paciente era preciso pular entre 4–5 telas.
**Solução:**
- Clicar na paciente abre a **ficha completa** (`/pacientes/:id`): Visão
  geral (alertas de saúde da anamnese, informações, próximos horários,
  odontograma, retornos, orçamentos, últimas evoluções), Prontuário,
  Odontograma, Harmonização, Orçamentos, Pagamentos, Documentos, Fotos e
  Retornos.
- **Pacientes** ganhou abas: Pacientes · Aniversariantes · Retornos ·
  Orçamentos; exportação da lista em Excel/CSV.
- Menu lateral: saíram Prontuário, Orçamentos e Retornos (endereços antigos
  redirecionam). Configurações agrupadas em Clínica · Financeiro · Conta.
- Documentos: os **modelos** ficam em Configurações; **emitir, imprimir e
  enviar** acontece na ficha (com histórico por paciente).
- Correção de segurança: gerar documento não aceita mais paciente de outra
  clínica (antes vazava nome/CPF/RG/endereço).

### Achado: CPF único na plataforma inteira ⬜
`Patient.cpf` é `@unique` no banco todo. Uma paciente atendida em duas
clínicas diferentes da plataforma não consegue ser cadastrada na segunda, e a
mensagem de erro revela que o CPF existe em outro lugar. **Proposta:** trocar
para único por clínica (`@@unique([doctorId, cpf])`) — exige migration e
revisão das buscas por CPF (chatbot/IA).

