// Cliente fino para a API da Groq (compatível com o formato de Chat Completions
// da OpenAI — mensagens, tools/tool_calls). Sem SDK externo, só fetch nativo.

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions'
const GROQ_MODEL = 'llama-3.3-70b-versatile'

export interface GroqMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  tool_calls?: GroqToolCall[]
  tool_call_id?: string
}

export interface GroqToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export interface GroqTool {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export interface GroqCompletionResult {
  content: string | null
  tool_calls?: GroqToolCall[]
}

// Carrega o status HTTP original da Groq (ou 'missing_key'/'timeout') pra quem
// chama poder devolver uma mensagem específica ao usuário em vez de um erro
// genérico — essencial pra diagnosticar chave inválida/expirada em produção
// sem depender de olhar log do servidor.
export class GroqApiError extends Error {
  status: number | 'missing_key' | 'timeout'
  constructor(message: string, status: number | 'missing_key' | 'timeout') {
    super(message)
    this.name = 'GroqApiError'
    this.status = status
  }
}

export async function groqChatCompletion(
  messages: GroqMessage[],
  tools?: GroqTool[],
  temperature = 0.6,
): Promise<GroqCompletionResult> {
  const apiKey = process.env.GROQ_API_KEY
  if (!apiKey) throw new GroqApiError('GROQ_API_KEY não configurada', 'missing_key')

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30_000)

  try {
    const res = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages,
        ...(tools && tools.length > 0 ? { tools, tool_choice: 'auto' } : {}),
        temperature,
      }),
      signal: controller.signal,
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      throw new GroqApiError(`Groq API error ${res.status}: ${errText}`, res.status)
    }

    const data = await res.json() as {
      choices?: Array<{ message?: { content?: string | null; tool_calls?: GroqToolCall[] } }>
    }
    const message = data.choices?.[0]?.message
    return {
      content: message?.content ?? null,
      tool_calls: message?.tool_calls,
    }
  } catch (err) {
    if (err instanceof GroqApiError) throw err
    if (err instanceof Error && err.name === 'AbortError') throw new GroqApiError('Groq API timeout', 'timeout')
    throw err
  } finally {
    clearTimeout(timeout)
  }
}
