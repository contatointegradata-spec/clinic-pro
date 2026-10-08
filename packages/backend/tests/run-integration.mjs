// Executor da suíte de integração: sobe a API contra um banco de TESTE,
// cria as contas de apoio (fixtures) e roda `node --test` em tests/integration.
//
//   DATABASE_URL=postgresql://…/clinic_test npm run test:integration -w packages/backend
//
// O banco precisa estar com as migrations aplicadas (prisma migrate deploy).
// Por segurança, recusa rodar se o nome do banco não contiver "test" — a
// suíte cria e altera dados.
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dbUrl = process.env.DATABASE_URL ?? ''
const dbName = (() => { try { return new URL(dbUrl).pathname.replace(/^\//, '') } catch { return '' } })()
if (!/test/i.test(dbName) && process.env.ALLOW_ANY_TEST_DB !== '1') {
  console.error(`[integration] Recusado: o banco "${dbName || '(vazio)'}" não parece ser de teste. Use um banco com "test" no nome.`)
  process.exit(2)
}

const PORT = process.env.TEST_PORT || '3999'
const API = `http://127.0.0.1:${PORT}/api`

const server = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
  cwd: root,
  env: {
    ...process.env,
    PORT,
    NODE_ENV: 'test',
    JWT_SECRET: process.env.JWT_SECRET || 'integration-test-secret',
    PUBLIC_APP_URL: 'http://localhost:5173',
    SESSIONS_DIR: path.join(root, '.test-sessions'),
    BACKUP_STATUS_FILE: path.join(root, '.test-sessions', 'no-backup-status.json'),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let serverLog = ''
server.stdout.on('data', d => { serverLog += d })
server.stderr.on('data', d => { serverLog += d })

function stop(code) {
  server.kill('SIGTERM')
  process.exit(code)
}

async function waitForHealth() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${API}/health`)
      if (r.ok) return
    } catch { /* ainda subindo */ }
    await new Promise(r => setTimeout(r, 500))
  }
  console.error('[integration] API não respondeu em 30 s. Log do servidor:\n' + serverLog.slice(-4000))
  stop(1)
}

async function register(name, specialty) {
  const r = await fetch(`${API}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email: `${name.replace(/\W+/g, '').toLowerCase()}.${Date.now()}@teste.cliniq`, password: 'senha-forte-123', specialty }),
  })
  if (r.status !== 201) { console.error('[integration] falha ao criar conta de apoio', r.status, await r.text()); stop(1) }
  return r.json()
}

await waitForHealth()
const clinicA = await register('Dra Ana Teste', 'Harmonização orofacial')
const clinicB = await register('Dr Bruno Teste', 'Odontologia')

// Lista os arquivos explicitamente (Node 20 e 22 tratam diretórios de jeitos diferentes).
const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : fs.readdirSync(path.join(root, 'tests/integration')).filter(f => f.endsWith('.test.mjs')).sort().map(f => `tests/integration/${f}`)
const runner = spawn(process.execPath, ['--test', '--test-concurrency=1', ...files], {
  cwd: root,
  env: { ...process.env, API_URL: API, TEST_FIXTURES: JSON.stringify({ clinicA, clinicB }) },
  stdio: 'inherit',
})
runner.on('exit', code => {
  if (code !== 0) console.error('\n[integration] Últimas linhas do servidor:\n' + serverLog.slice(-3000))
  stop(code ?? 1)
})
