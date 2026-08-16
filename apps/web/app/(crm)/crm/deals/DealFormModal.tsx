'use client'

// 딜 만들기·고치기 (dacrm T1-03)
//
// 딜은 회사 없이 존재할 수 없다 — 그래서 회사를 **고르게** 한다.
// 자유 입력으로 두면 같은 회사가 이름 표기만 다른 채 여러 건 생기고,
// 나중에 "이 회사 매출이 얼마냐"에 답할 수 없게 된다.
//
// 단계 선택지는 고른 파이프라인의 것만 보여 준다(DI-05).
// 다른 파이프라인 단계를 고를 수 있게 두면 서버가 거절할 것을 화면이 먼저 권하는 꼴이다.

import { useEffect, useMemo, useState } from 'react'
import NbModal from '@/components/ui/nb/NbModal'
import NbButton from '@/components/ui/nb/NbButton'
import FormErrorBanner from '@/components/ui/FormErrorBanner'
import { isEnterKey } from '@/lib/ui/ime'
import type { BoardPipeline } from './DealBoard'

export interface DealDraft {
  id?: string
  name?: string
  companyId?: string
  pipelineId?: string
  stageId?: string
  amountMinor?: string | null
  currency?: string | null
  expectedCloseDate?: string | null
  version?: number
}

interface CompanyOption {
  id: string
  name: string
}

interface Props {
  pipelines: BoardPipeline[]
  initial?: DealDraft
  onClose: () => void
  onSaved: () => void
}

const CURRENCIES = ['KRW', 'USD', 'JPY', 'EUR']

export default function DealFormModal({ pipelines, initial, onClose, onSaved }: Props) {
  const editing = Boolean(initial?.id)
  const [name, setName] = useState(initial?.name ?? '')
  const [companyId, setCompanyId] = useState(initial?.companyId ?? '')
  /**
   * 회사를 그 자리에서 만들기.
   *
   * **왜 필요한가**: 딜은 `companyId` 가 필수인데, 회사가 하나도 없으면
   * 드롭다운이 비고 **거기서 막힌다.** 처음 온 사람은 "회사를 먼저 만들어야 한다"는 것을
   * 아무 데서도 못 듣는다 — 화면에 그 말이 없기 때문이다.
   * 창을 닫고 회사 화면으로 갔다가 돌아오게 하는 대신 여기서 만든다.
   */
  const [newCompany, setNewCompany] = useState('')
  const [makingCompany, setMakingCompany] = useState(false)
  const [pipelineId, setPipelineId] = useState(
    initial?.pipelineId ?? pipelines.find((p) => p.isDefault)?.id ?? pipelines[0]?.id ?? '',
  )
  const [stageId, setStageId] = useState(initial?.stageId ?? '')
  const [amount, setAmount] = useState(initial?.amountMinor ?? '')
  const [currency, setCurrency] = useState(initial?.currency ?? 'KRW')
  const [expectedCloseDate, setExpectedCloseDate] = useState(initial?.expectedCloseDate ?? '')
  const [companies, setCompanies] = useState<CompanyOption[]>([])
  const [companyError, setCompanyError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pipeline = pipelines.find((p) => p.id === pipelineId)
  // 열린 단계만 고르게 한다 — 만들자마자 "수주"로 두면 금액·성사일 없는 WON 이 생긴다(DI-06)
  const openStages = useMemo(
    () => (pipeline?.stages ?? []).filter((s) => s.kind === 'OPEN'),
    [pipeline],
  )

  // 파이프라인을 바꾸면 단계는 그 파이프라인의 첫 칸으로 — 남은 값이 남의 파이프라인 것이면 서버가 거절한다
  useEffect(() => {
    if (openStages.length === 0) return
    if (!openStages.some((s) => s.id === stageId)) setStageId(openStages[0].id)
  }, [openStages, stageId])

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const res = await fetch('/api/crm/companies?limit=100')
        const body = await res.json()
        if (!alive) return
        if (!res.ok) { setCompanyError(body?.error?.message ?? '회사를 불러오지 못했습니다.'); return }
        setCompanies(body.items ?? [])
      } catch {
        if (alive) setCompanyError('회사를 불러오지 못했습니다.')
      }
    })()
    return () => { alive = false }
  }, [])

  async function createCompany() {
    const nm = newCompany.trim()
    if (!nm) return
    setMakingCompany(true)
    setCompanyError(null)
    try {
      const res = await fetch('/api/crm/companies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: nm }),
      })
      const body = await res.json()
      if (!res.ok) { setCompanyError(body?.error?.message ?? '회사를 만들지 못했습니다.'); return }

      const created = body.company ?? body
      const id = String(created.id ?? '')
      if (!id) { setCompanyError('회사를 만들지 못했습니다.'); return }

      // 만들자마자 고른 상태로 — 다시 찾아 고르게 하면 그게 또 한 걸음이다
      setCompanies((prev) => [{ id, name: nm }, ...prev])
      setCompanyId(id)
      setNewCompany('')
    } catch {
      setCompanyError('회사를 만들지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setMakingCompany(false)
    }
  }

  const canSubmit = Boolean(name.trim() && companyId && pipelineId && stageId)

  async function submit() {
    setSaving(true)
    setError(null)
    try {
      const payload: Record<string, unknown> = {
        name,
        companyId,
        pipelineId,
        stageId,
        amountMinor: amount ? String(amount) : null,
        currency: amount ? currency : null,
        expectedCloseDate: expectedCloseDate || null,
      }
      if (editing) payload.version = initial?.version

      const res = await fetch(editing ? `/api/crm/deals/${initial?.id}` : '/api/crm/deals', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = await res.json()
      if (!res.ok) { setError(body?.error?.message ?? '저장하지 못했습니다.'); return }
      onSaved()
    } catch {
      setError('저장하지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <NbModal
      title={editing ? '딜 수정' : '딜 추가'}
      onClose={onClose}
      maxWidth={520}
      footer={
        <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
          <NbButton variant="ghost" onClick={onClose} disabled={saving}>취소</NbButton>
          <NbButton onClick={() => void submit()} disabled={saving || !canSubmit}>
            {saving ? '저장 중…' : '저장'}
          </NbButton>
        </div>
      }
    >
      <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
        <FormErrorBanner message={error ?? companyError} />

        <div>
          <label className="label" htmlFor="crm-deal-name">딜 이름 *</label>
          <input
            id="crm-deal-name" className="input-field" value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="예: GPU 8장 도입 검토" autoFocus
          />
        </div>

        <div>
          <label className="label" htmlFor="crm-deal-company">회사 *</label>
          <select
            id="crm-deal-company" className="input-field" value={companyId}
            onChange={(e) => setCompanyId(e.target.value)}
          >
            <option value="">회사를 고르세요</option>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>

          {/*
            회사가 없으면 여기서 막힌다 — 그 자리에서 만들 수 있게 한다.
            딜이 처음인 사람에게 가장 흔한 막힘이었다.
          */}
          {companies.length === 0 && (
            <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-end', marginTop: 'var(--space-2)' }}>
              <input
                className="input-field"
                value={newCompany}
                placeholder="회사 이름을 넣고 만들면 바로 골라집니다"
                onChange={(e) => setNewCompany(e.target.value)}
                onKeyDown={(e) => { if (isEnterKey(e)) void createCompany() }}
                aria-label="새 회사 이름"
              />
              <NbButton
                variant="ghost"
                onClick={() => void createCompany()}
                disabled={makingCompany || !newCompany.trim()}
              >
                {makingCompany ? '만드는 중…' : '회사 만들기'}
              </NbButton>
            </div>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
          <div>
            <label className="label" htmlFor="crm-deal-pipeline">파이프라인 *</label>
            <select
              id="crm-deal-pipeline" className="input-field" value={pipelineId}
              onChange={(e) => setPipelineId(e.target.value)}
              disabled={editing}
            >
              {pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="crm-deal-stage">시작 단계 *</label>
            <select
              id="crm-deal-stage" className="input-field" value={stageId}
              onChange={(e) => setStageId(e.target.value)}
              disabled={editing}
            >
              {openStages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        </div>

        {editing && (
          <p style={{ margin: 0, fontSize: 'var(--fs-2xs)', color: 'var(--text-muted)' }}>
            단계는 보드에서 옮깁니다 — 이동 이력이 함께 남아야 하기 때문입니다.
          </p>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 'var(--space-3)' }}>
          <div>
            <label className="label" htmlFor="crm-deal-amount">예상 금액</label>
            <input
              id="crm-deal-amount" className="input-field" value={amount ?? ''} inputMode="numeric"
              onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ''))}
              placeholder="아직 몰라도 됩니다"
            />
          </div>
          <div>
            <label className="label" htmlFor="crm-deal-currency">통화</label>
            <select
              id="crm-deal-currency" className="input-field" value={currency ?? 'KRW'}
              onChange={(e) => setCurrency(e.target.value)}
            >
              {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className="label" htmlFor="crm-deal-close">예상 마감일</label>
          <input
            id="crm-deal-close" className="input-field" type="date" value={expectedCloseDate ?? ''}
            onChange={(e) => setExpectedCloseDate(e.target.value)}
          />
        </div>
      </div>
    </NbModal>
  )
}
