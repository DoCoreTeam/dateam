'use client'

// 성사·실주 확정 (dacrm T1-03)
//
// 보드에서 성사·실주 칸에 놓으면 바로 넣지 않고 이 모달이 먼저 뜬다.
// WON 은 금액·성사일이(DI-06), LOST 는 사유가(DI-07) 없으면 존재할 수 없기 때문이다.
// 화면이 먼저 묻지 않으면 사용자는 서버 오류를 보고서야 무엇이 필요한지 안다.

import { useState } from 'react'
import NbModal from '@/components/ui/nb/NbModal'
import NbButton from '@/components/ui/nb/NbButton'
import FormErrorBanner from '@/components/ui/FormErrorBanner'
import { kstTodayKey } from '@/lib/datetime/kst'
import type { BoardDeal, BoardStage } from './DealBoard'

interface Props {
  deal: BoardDeal
  /** 놓은 칸. 상태와 함께 단계도 이 칸으로 옮긴다 — 안 옮기면 카드가 원래 자리에 남는다 */
  stage: BoardStage
  onClose: () => void
  onDone: () => void
}

const CURRENCIES = ['KRW', 'USD', 'JPY', 'EUR']

export default function DealCloseModal({ deal, stage, onClose, onDone }: Props) {
  const won = stage.kind === 'WON'
  // 성사일 기본값은 오늘(KST). 서버 시각이 아니라 사용자가 사는 날짜여야 한다
  const [wonAt, setWonAt] = useState(kstTodayKey())
  const [amount, setAmount] = useState(deal.amountMinor ?? '')
  const [currency, setCurrency] = useState(deal.currency ?? 'KRW')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSubmit = won ? Boolean(amount.trim() && wonAt) : Boolean(reason.trim())

  async function submit() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/crm/deals/${deal.id}/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          won
            ? { version: deal.version, to: 'WON', wonAt, amountMinor: amount.trim(), currency, toStageId: stage.id }
            : { version: deal.version, to: 'LOST', reason: reason.trim(), toStageId: stage.id },
        ),
      })
      const body = await res.json()
      if (!res.ok) {
        setError(body?.error?.message ?? '처리하지 못했습니다.')
        return
      }
      onDone()
    } catch {
      setError('처리하지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <NbModal
      title={won ? '성사로 확정' : '실주로 확정'}
      onClose={onClose}
      maxWidth={480}
      footer={
        <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
          <NbButton variant="ghost" onClick={onClose} disabled={saving}>취소</NbButton>
          <NbButton onClick={() => void submit()} disabled={saving || !canSubmit}>
            {saving ? '처리 중…' : won ? '성사 확정' : '실주 확정'}
          </NbButton>
        </div>
      }
    >
      <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
        <FormErrorBanner message={error} />

        <p style={{ margin: 0, fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
          <strong style={{ color: 'var(--text)' }}>{deal.name}</strong>
          {won
            ? ' — 성사로 기록하려면 금액과 성사일이 필요합니다.'
            : ' — 실주로 기록하려면 사유가 필요합니다. 나중에 같은 실수를 줄이는 근거가 됩니다.'}
        </p>

        {won ? (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 'var(--space-3)' }}>
              <div>
                <label className="label" htmlFor="crm-close-amount">금액 *</label>
                <input
                  id="crm-close-amount" className="input-field" value={amount} inputMode="numeric"
                  onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ''))}
                  placeholder="예: 300000000" autoFocus
                />
              </div>
              <div>
                <label className="label" htmlFor="crm-close-currency">통화</label>
                <select
                  id="crm-close-currency" className="input-field" value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                >
                  {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="label" htmlFor="crm-close-date">성사일 *</label>
              <input
                id="crm-close-date" className="input-field" type="date" value={wonAt}
                onChange={(e) => setWonAt(e.target.value)}
              />
            </div>
          </>
        ) : (
          <div>
            <label className="label" htmlFor="crm-close-reason">실주 사유 *</label>
            <textarea
              id="crm-close-reason" className="input-field" value={reason} rows={3}
              onChange={(e) => setReason(e.target.value)}
              placeholder="예: 가격 경쟁력 부족, 경쟁사 선정" autoFocus
            />
          </div>
        )}
      </div>
    </NbModal>
  )
}
