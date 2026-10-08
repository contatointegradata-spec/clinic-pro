// Primeiro nome para saudações. Mantém o título profissional quando o nome
// começa com ele ("Dra. Ana Souza" → "Dra. Ana"), comum em odontologia e estética.
const TITLES = /^(dr|dra|dr\.|dra\.)$/i

export function greetingName(fullName?: string | null): string {
  const parts = (fullName ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return ''
  if (TITLES.test(parts[0]) && parts[1]) return `${parts[0]} ${parts[1]}`
  return parts[0]
}
