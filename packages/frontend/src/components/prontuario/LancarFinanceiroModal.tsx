import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { DollarSign, CreditCard } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../lib/api'
import type { MedicalRecord, PaymentMethod } from '../../types'
import Modal from '../ui/Modal'

interface Props {
  isOpen: boolean
  onClose: () => void
  record: MedicalRecord
  onCharged: () => void
}

function currency(v: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)
}

export default function LancarFinanceiroModal({ isOpen, onClose, record, onCharged }: Props) {
  const [selectedMethodId, setSelectedMethodId] = useState('')
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)

  const procedures = record.procedures ?? []
  const total = procedures.reduce((sum, p) => sum + p.valorPago, 0)

  const { data: methods = [] } = useQuery<PaymentMethod[]>({
    queryKey: ['financial-payment-methods'],
    queryFn: () => api.get('/financial/payment-methods').then(r => r.data),
    enabled: isOpen,
  })

  const selectedMethod = methods.find(m => m.id === selectedMethodId)

  const handleSubmit = async () => {
    if (total <= 0) {
      toast.error('Nenhum procedimento com valor a lançar')
      return
    }
    setLoading(true)
    try {
      await api.post(`/medical-records/${record.id}/charge`, {
        paymentMethodId: selectedMethodId || undefined,
        paymentMethodName: selectedMethod?.name || undefined,
        notes: notes || undefined,
      })
      toast.success('Lançado no financeiro!')
      onCharged()
      onClose()
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
      toast.error(msg || 'Erro ao lançar no financeiro')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Lançar Financeiro" subtitle={record.patient?.name} size="md">
      <div className="space-y-5">
        <div className="bg-slate-50 rounded-xl border border-slate-200 divide-y divide-slate-200 overflow-hidden">
          {procedures.map(p => (
            <div key={p.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
              <span className="text-slate-700 flex items-center gap-2">
                {p.name}
                {p.valorPago === 0 && (
                  <span className="text-[10px] font-semibold text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full">Cortesia</span>
                )}
              </span>
              <span className="font-medium text-slate-800">{currency(p.valorPago)}</span>
            </div>
          ))}
          <div className="flex items-center justify-between px-4 py-3 bg-emerald-50">
            <span className="text-emerald-700 font-semibold text-sm">Total</span>
            <span className="text-base font-bold text-emerald-800">{currency(total)}</span>
          </div>
        </div>

        <div>
          <label className="label flex items-center gap-1.5">
            <CreditCard className="w-3.5 h-3.5 text-slate-400" />
            Forma de pagamento
          </label>
          <select value={selectedMethodId} onChange={e => setSelectedMethodId(e.target.value)} className="input-field">
            <option value="">Não informado</option>
            {methods.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>

        <div>
          <label className="label">Observações (opcional)</label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={2}
            className="input-field resize-none"
            placeholder="Informações adicionais sobre este pagamento..."
          />
        </div>

        <button
          type="button"
          onClick={handleSubmit}
          disabled={loading || total <= 0}
          className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-3 rounded-xl font-semibold text-base transition-colors flex items-center justify-center gap-2"
        >
          {loading ? (
            <>
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Lançando...
            </>
          ) : (
            <>
              <DollarSign className="w-4 h-4" />
              Lançar no Financeiro — {currency(total)}
            </>
          )}
        </button>
      </div>
    </Modal>
  )
}
