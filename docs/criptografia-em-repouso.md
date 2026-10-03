# Avaliação — criptografia em repouso

## Estado atual

O Postgres de produção roda em container próprio na VPS (`docker-compose.yml`,
serviço `postgres`, volume `postgres_data`) — **não é um banco gerenciado**
(tipo RDS/Neon/Supabase, que normalmente já entregam criptografia de disco
por padrão). Isso significa que hoje **não há garantia de criptografia em
repouso** a menos que o disco da própria VPS esteja criptografado — o que
não foi confirmado e precisa ser checado com o provedor da VPS.

O conteúdo mais sensível (`MedicalRecord.content`, `MedicalRecord.specialtyData`,
dados cadastrais do paciente) está em texto plano no banco, como em
praticamente todo sistema que usa um banco relacional "padrão".

## Opção 1 — Criptografia de disco (nível de infraestrutura)

Criptografa o disco inteiro onde o Postgres grava os dados. Transparente pra
aplicação — zero mudança de código, zero impacto em busca/filtro/relatório.
Protege contra: alguém com acesso físico ao disco, ou uma cópia/backup do
disco vazando, conseguir ler os dados sem a chave. **Não** protege contra:
alguém com acesso ao Postgres já rodando (processo comprometido, credencial
vazada) — nesse caso os dados já chegam descriptografados pra quem consulta.

Como ativar depende do provedor da VPS:
- Se a VPS já roda sobre um disco gerenciado com opção de criptografia
  (comum em provedores cloud — AWS EBS, DigitalOcean, Hetzner, etc.), é
  geralmente uma configuração do volume, não requer mexer no Postgres.
  Precisa confirmar com o provedor específico desta VPS se essa opção existe
  e está ativa.
- Se for um disco "cru" (VPS tradicional sem essa opção do provedor), dá pra
  configurar LUKS no nível do sistema operacional — exige acesso root e uma
  janela de manutenção (recriar o volume criptografado e restaurar o backup
  dentro dele), não é algo pra fazer "a quente" sem planejamento.

**Recomendação de curto prazo**: confirmar com o provedor da VPS se o disco
já é criptografado por padrão (muitos são, mesmo sem ser anunciado
explicitamente) — se sim, este item já está resolvido sem nenhuma ação.

## Opção 2 — Criptografia a nível de campo (nível de aplicação)

Criptografar campos específicos (ex.: `MedicalRecord.content`) antes de
gravar no banco, descriptografando na leitura. Custos reais:

- **Gestão de chave**: a chave de criptografia não pode morar no mesmo lugar
  que o banco (senão é só uma complicação a mais, sem ganho de segurança
  real) — precisa de um serviço de gestão de segredos separado (ex.: AWS
  KMS, Vault) ou, no mínimo, uma chave guardada fora do `.env` do servidor.
- **Perda de busca/filtro**: qualquer `WHERE content LIKE ...` ou busca
  textual no prontuário deixa de funcionar direto no banco — teria que ler
  tudo e filtrar na aplicação, ou manter um índice de busca separado.
- **Migração do dado existente**: todo prontuário já gravado em texto plano
  precisaria ser lido, criptografado e regravado — uma migração de dados
  real, não só de schema, rodando sobre produção com paciente de verdade.
- **Backup/restore**: o backup (`scripts/backup-db.sh`) continuaria
  funcionando, mas restaurar em outro ambiente exigiria ter a chave também
  disponível lá — mais um ponto de falha a gerenciar.

**Recomendação**: não vale o custo agora. Ativar só se uma auditoria de
segurança específica, um cliente grande ou uma exigência contratual pedir
explicitamente criptografia de campo — não é um requisito genérico da LGPD
(a lei pede proteção adequada ao risco, não um mecanismo específico), e a
Opção 1 já cobre a maior parte do risco real (perda física do disco/backup)
com uma fração do custo.

## Resumo

| | Opção 1 — disco | Opção 2 — campo |
|---|---|---|
| Esforço | Baixo (geralmente config do provedor) | Alto (chave, migração, busca) |
| Protege contra | Disco/backup roubado ou vazado | Mesmo + acesso direto ao banco |
| Impacto na aplicação | Nenhum | Alto (busca, performance, complexidade) |
| Recomendação | Fazer agora | Só sob demanda específica |
