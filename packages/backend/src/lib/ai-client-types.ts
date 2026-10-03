// Tipos neutros de provedor pro motor do Agente de IA — qualquer cliente
// (hoje só a Gemini, ver gemini-client.ts) implementa contra este contrato,
// no formato de mensagens/tools estilo OpenAI (role system/user/assistant/
// tool + tool_calls), que é o que o resto do app (ai-agent-engine.ts,
// routes/ai-agent.ts) já fala.

export interface AiToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export interface AiMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  tool_calls?: AiToolCall[]
  tool_call_id?: string
}

export interface AiTool {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export interface AiCompletionResult {
  content: string | null
  tool_calls?: AiToolCall[]
}

// Carrega o status HTTP original do provedor (ou 'missing_key'/'timeout')
// pra quem chama poder devolver uma mensagem específica ao usuário em vez
// de um erro genérico — essencial pra diagnosticar chave inválida/expirada
// em produção sem depender de olhar log do servidor.
export class AiProviderError extends Error {
  status: number | 'missing_key' | 'timeout'
  constructor(message: string, status: number | 'missing_key' | 'timeout') {
    super(message)
    this.name = 'AiProviderError'
    this.status = status
  }
}
