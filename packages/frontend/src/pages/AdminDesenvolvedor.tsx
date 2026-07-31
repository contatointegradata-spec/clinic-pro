import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Code2, Search, Bell, Webhook } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../lib/api'

interface PlatformUserRow {
  id: string
  name: string
  email: string
  role: 'ADMIN' | 'DOCTOR' | 'SECRETARY'
  active: boolean
  isPlatformDeveloper: boolean
  notificationsAccess: boolean
  integrationsAccess: boolean
}

const roleLabel: Record<string, string> = {
  ADMIN: 'Administrador',
  DOCTOR: 'Especialista',
  SECRETARY: 'Secretária',
}

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onChange}
      disabled={disabled}
      className={`w-10 h-6 rounded-full relative transition-colors flex-shrink-0 ${checked ? 'bg-blue-600' : 'bg-slate-300'} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      <div className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${checked ? 'left-4' : 'left-0.5'}`} />
    </button>
  )
}

export default function AdminDesenvolvedor() {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')

  const { data: users = [], isLoading } = useQuery<PlatformUserRow[]>({
    queryKey: ['platform-admin-users'],
    queryFn: () => api.get('/platform-admin/users').then(r => r.data),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Pick<PlatformUserRow, 'notificationsAccess' | 'integrationsAccess'>> }) =>
      api.patch(`/platform-admin/users/${id}/access`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['platform-admin-users'] })
      toast.success('Acesso atualizado')
    },
    onError: () => toast.error('Não foi possível atualizar o acesso'),
  })

  const filtered = users.filter(u =>
    u.name.toLowerCase().includes(search.toLowerCase()) ||
    u.email.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="max-w-4xl mx-auto space-y-6 page-stagger">
      <div className="animate-stagger-1">
        <h1 className="page-title flex items-center gap-2">
          <Code2 className="w-6 h-6 text-blue-600" />
          Admin Desenvolvedor
        </h1>
        <p className="page-subtitle">
          Libere Notificações e Integrações individualmente, por usuário, em qualquer clínica da plataforma.
        </p>
      </div>

      <div className="relative animate-stagger-2">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input
          className="input-field pl-9 max-w-sm"
          placeholder="Buscar por nome ou e-mail..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      <div className="card p-0 overflow-hidden animate-stagger-3">
        {isLoading ? (
          <div className="text-center py-14 text-slate-400">Carregando...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-14 text-slate-400">Nenhum usuário encontrado</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {filtered.map(u => (
              <div key={u.id} className="flex items-center gap-4 px-5 py-4 flex-wrap sm:flex-nowrap">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-slate-900 truncate">{u.name}</p>
                    <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">{roleLabel[u.role] ?? u.role}</span>
                    {u.isPlatformDeveloper && (
                      <span className="text-xs bg-violet-100 text-violet-700 px-2 py-0.5 rounded-full font-medium">Desenvolvedor</span>
                    )}
                    {!u.active && (
                      <span className="text-xs bg-red-50 text-red-600 px-2 py-0.5 rounded-full">Inativo</span>
                    )}
                  </div>
                  <p className="text-xs text-slate-400 truncate mt-0.5">{u.email}</p>
                </div>

                <div className="flex items-center gap-2" title="Notificações">
                  <Bell className="w-4 h-4 text-slate-400" />
                  <Toggle
                    checked={u.isPlatformDeveloper || u.notificationsAccess}
                    disabled={u.isPlatformDeveloper}
                    onChange={() => updateMutation.mutate({ id: u.id, data: { notificationsAccess: !u.notificationsAccess } })}
                  />
                </div>

                <div className="flex items-center gap-2" title="Integrações">
                  <Webhook className="w-4 h-4 text-slate-400" />
                  <Toggle
                    checked={u.isPlatformDeveloper || u.integrationsAccess}
                    disabled={u.isPlatformDeveloper}
                    onChange={() => updateMutation.mutate({ id: u.id, data: { integrationsAccess: !u.integrationsAccess } })}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
