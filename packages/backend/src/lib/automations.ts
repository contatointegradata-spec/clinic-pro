// Catálogo das mensagens automáticas para pacientes que o motor já dispara
// (lib/chatbot-light-engine.ts, lib/scheduled-returns.ts, rotas de agenda,
// pacientes e financeiro). Fonte única para a página Configurações ›
// Notificações: cada item vira um liga/desliga + texto editável, gravado como
// LightTemplate + LightIntegrationConfig no chatbot padrão da clínica.

export interface AutomationDefinition {
  event: string
  module: string
  group: 'agenda' | 'relacionamento' | 'financeiro'
  label: string
  when: string
  defaultContent: string
  // Variáveis que o disparo realmente preenche (as demais ficariam vazias).
  variables: string[]
}

const APPOINTMENT_VARS = ['{nome}', '{data}', '{hora}', '{tipo_atendimento}', '{medico}', '{clinica}', '{endereco}', '{telefone_clinica}']
const PATIENT_VARS = ['{nome}', '{medico}', '{especialidade}']

export const AUTOMATIONS: AutomationDefinition[] = [
  {
    event: 'APPOINTMENT_CONFIRMATION',
    module: 'agenda',
    group: 'agenda',
    label: 'Confirmação de agendamento',
    when: 'Assim que um horário é marcado na agenda',
    defaultContent: 'Olá {nome}! Seu horário de {tipo_atendimento} com {medico} está marcado para {data} às {hora}, em {endereco}. Qualquer dúvida, é só responder por aqui. 💕',
    variables: APPOINTMENT_VARS,
  },
  {
    event: 'APPOINTMENT_REMINDER_24H',
    module: 'agenda',
    group: 'agenda',
    label: 'Lembrete 24 horas antes',
    when: 'Um dia antes de cada horário agendado ou confirmado',
    defaultContent: 'Olá {nome}! Passando para lembrar do seu horário amanhã, {data} às {hora}, com {medico}. Se precisar remarcar, nos avise por aqui, tá? 😊',
    variables: APPOINTMENT_VARS,
  },
  {
    event: 'APPOINTMENT_REMINDER_2H',
    module: 'agenda',
    group: 'agenda',
    label: 'Lembrete 2 horas antes',
    when: 'Duas horas antes de cada horário',
    defaultContent: 'Olá {nome}! Te esperamos hoje às {hora} em {endereco}. Até já! ✨',
    variables: APPOINTMENT_VARS,
  },
  {
    event: 'APPOINTMENT_CANCELLATION',
    module: 'agenda',
    group: 'agenda',
    label: 'Aviso de cancelamento',
    when: 'Quando um horário é cancelado na agenda',
    defaultContent: 'Olá {nome}, seu horário de {data} às {hora} foi cancelado. Quer remarcar? É só responder com o melhor dia para você.',
    variables: APPOINTMENT_VARS,
  },
  {
    event: 'PROCEDURE_RETURN_DUE',
    module: 'pacientes',
    group: 'relacionamento',
    label: 'Retorno programado',
    when: 'No vencimento do retorno do procedimento (toxina, limpeza, manutenção…)',
    defaultContent: 'Olá {nome}! Já está na hora do seu retorno de {tipo_atendimento} com {medico}. Vamos agendar? Me diga o melhor dia e horário. 😊',
    variables: ['{nome}', '{tipo_atendimento}', '{medico}', '{especialidade}'],
  },
  {
    event: 'PATIENT_BIRTHDAY',
    module: 'pacientes',
    group: 'relacionamento',
    label: 'Aniversário',
    when: 'No dia do aniversário da paciente (uma vez por ano)',
    defaultContent: 'Feliz aniversário, {nome}! 🎉 Toda a equipe de {medico} deseja um dia lindo para você. Que tal se presentear com um momento de cuidado? 💕',
    variables: PATIENT_VARS,
  },
  {
    event: 'PATIENT_INACTIVE_FOLLOWUP',
    module: 'pacientes',
    group: 'relacionamento',
    label: 'Reativação de pacientes inativas',
    when: 'Quando a paciente está há 6 meses sem atendimento concluído',
    defaultContent: 'Olá {nome}! Sentimos sua falta por aqui. Que tal agendar uma avaliação para cuidar do seu sorriso e da sua pele? É só responder esta mensagem. 😊',
    variables: PATIENT_VARS,
  },
  {
    event: 'NEW_PATIENT_WELCOME',
    module: 'pacientes',
    group: 'relacionamento',
    label: 'Boas-vindas',
    when: 'Quando uma nova paciente é cadastrada',
    defaultContent: 'Olá {nome}, seja muito bem-vinda! Ficamos felizes em ter você com a gente. Qualquer dúvida, é só chamar por aqui.',
    variables: PATIENT_VARS,
  },
  {
    event: 'PAYMENT_OVERDUE',
    module: 'financeiro',
    group: 'financeiro',
    label: 'Pagamento em atraso',
    when: 'Quando um lançamento a receber vence sem pagamento',
    defaultContent: 'Olá {nome}, identificamos um pagamento de R$ {valor} em aberto. Se já pagou, desconsidere. Caso precise, este é o link: {link}',
    variables: ['{nome}', '{valor}', '{medico}', '{link}'],
  },
]

export function findAutomation(event: string): AutomationDefinition | undefined {
  return AUTOMATIONS.find(a => a.event === event)
}
