// Cliente fino para a API Generative Language do Google (Gemini) — chat com
// function calling. Mesmo contrato que a Groq tinha (ver ai-client-types.ts),
// só que por baixo fala o formato nativo da Gemini (systemInstruction,
// contents com role user/model, functionCall/functionResponse).

import { AiMessage, AiTool, AiCompletionResult, AiProviderError } from './ai-client-types'
import { getResolvedAiConfig } from './ai-integration-config'

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

type GeminiPart =
  | { text: string }
  | { functionCall: { name: string; args: Record<string, unknown> } }
  | { functionResponse: { name: string; response: Record<string, unknown> } }

interface GeminiContent {
  role: 'user' | 'model'
  parts: GeminiPart[]
}

function isFunctionResponsePart(part: GeminiPart): boolean {
  return 'functionResponse' in part
}

// Monta o array `contents` + `systemInstruction` no formato da Gemini a
// partir do histórico neutro. Respostas de ferramenta (role 'tool')
// consecutivas são agrupadas num único content — a API não aceita vários
// contents seguidos com a mesma role.
function toGeminiContents(messages: AiMessage[]): { systemInstruction?: { parts: [{ text: string }] }; contents: GeminiContent[] } {
  const systemMsg = messages.find(m => m.role === 'system')
  const rest = messages.filter(m => m.role !== 'system')

  const contents: GeminiContent[] = []
  for (const m of rest) {
    if (m.role === 'tool') {
      const part: GeminiPart = {
        functionResponse: {
          // A Gemini não devolve um "call id" separado como a Groq/OpenAI —
          // usamos o próprio nome da função (ver geminiChatCompletion) como
          // id, então aqui tool_call_id já É o nome que a Gemini espera.
          name: m.tool_call_id || '',
          response: { result: m.content },
        },
      }
      const last = contents[contents.length - 1]
      if (last && last.role === 'user' && last.parts.every(isFunctionResponsePart)) {
        last.parts.push(part)
      } else {
        contents.push({ role: 'user', parts: [part] })
      }
      continue
    }

    if (m.role === 'assistant') {
      if (m.tool_calls && m.tool_calls.length > 0) {
        contents.push({
          role: 'model',
          parts: m.tool_calls.map(tc => ({
            functionCall: { name: tc.function.name, args: JSON.parse(tc.function.arguments || '{}') },
          })),
        })
      } else {
        contents.push({ role: 'model', parts: [{ text: m.content }] })
      }
      continue
    }

    // role === 'user'
    contents.push({ role: 'user', parts: [{ text: m.content }] })
  }

  return {
    ...(systemMsg ? { systemInstruction: { parts: [{ text: systemMsg.content }] } as { parts: [{ text: string }] } } : {}),
    contents,
  }
}

function toGeminiTools(tools: AiTool[]): Array<{ functionDeclarations: Array<{ name: string; description: string; parameters: Record<string, unknown> }> }> {
  return [{
    functionDeclarations: tools.map(t => ({
      name: t.function.name,
      description: t.function.description,
      parameters: t.function.parameters,
    })),
  }]
}

export async function geminiChatCompletion(
  messages: AiMessage[],
  tools?: AiTool[],
  temperature = 0.6,
): Promise<AiCompletionResult> {
  const config = await getResolvedAiConfig()
  if (!config.apiKey) throw new AiProviderError('Chave de API da IA não configurada', 'missing_key')

  const { systemInstruction, contents } = toGeminiContents(messages)
  const body: Record<string, unknown> = {
    contents,
    generationConfig: { temperature },
    ...(systemInstruction ? { systemInstruction } : {}),
    ...(tools && tools.length > 0 ? { tools: toGeminiTools(tools) } : {}),
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30_000)

  try {
    const res = await fetch(`${GEMINI_API_BASE}/${config.model}:generateContent`, {
      method: 'POST',
      headers: {
        'x-goog-api-key': config.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    if (!res.ok) {
      let message = `Gemini API error ${res.status}`
      let reason: string | undefined
      try {
        const errBody = await res.json() as { error?: { message?: string; status?: string } }
        message = errBody?.error?.message || message
        reason = errBody?.error?.status
      } catch {
        // corpo de erro não era JSON — mantém a mensagem genérica
      }
      // A Gemini devolve chave inválida como 400/INVALID_ARGUMENT (não 401),
      // então sem checar o texto da mensagem esse caso caía no status bruto
      // (400) e virava um erro genérico pra quem usa — em vez de "chave
      // inválida", a mensagem real da Gemini de qualquer forma.
      const looksLikeInvalidKey = /api key/i.test(message)
      const status: number | 'missing_key' | 'timeout' =
        reason === 'PERMISSION_DENIED' || reason === 'UNAUTHENTICATED' || looksLikeInvalidKey ? 401
        : reason === 'RESOURCE_EXHAUSTED' ? 429
        : res.status
      throw new AiProviderError(message, status)
    }

    const data = await res.json() as {
      candidates?: Array<{ content?: { parts?: GeminiPart[] } }>
      promptFeedback?: { blockReason?: string }
    }
    if (data.promptFeedback?.blockReason) {
      console.warn('[gemini-client] resposta bloqueada pela IA:', data.promptFeedback.blockReason)
    }
    const parts = data.candidates?.[0]?.content?.parts ?? []

    const textParts = parts
      .filter((p): p is { text: string } => 'text' in p)
      .map(p => p.text)
    const functionCallParts = parts
      .filter((p): p is { functionCall: { name: string; args: Record<string, unknown> } } => 'functionCall' in p)

    const tool_calls = functionCallParts.length > 0
      ? functionCallParts.map(p => ({
          id: p.functionCall.name,
          type: 'function' as const,
          function: { name: p.functionCall.name, arguments: JSON.stringify(p.functionCall.args ?? {}) },
        }))
      : undefined

    return {
      content: textParts.length > 0 ? textParts.join('\n') : null,
      tool_calls,
    }
  } catch (err) {
    if (err instanceof AiProviderError) throw err
    if (err instanceof Error && err.name === 'AbortError') throw new AiProviderError('Gemini API timeout', 'timeout')
    throw err
  } finally {
    clearTimeout(timeout)
  }
}
