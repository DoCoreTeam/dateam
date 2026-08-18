'use client'

// 인물 만들기·고치기 (dacrm T1-02) — 회사 모달과 같은 골격(§2-5 동종 UI 통일)

import { useCallback, useState } from 'react'
import NbModal from '@/components/ui/nb/NbModal'
import NbButton from '@/components/ui/nb/NbButton'
import FormErrorBanner from '@/components/ui/FormErrorBanner'
import RecordPickerField, { type RecordOption } from '@/components/ui/RecordPicker'
import { STAGE_LABEL } from './PersonListView'

export interface PersonDraft {
  id?: string
  name?: string
  companyId?: string | null
  /** 수정으로 열 때 고른 회사의 이름 — 없으면 칸이 id만 알고 이름을 못 보여 준다 */
  companyName?: string | null
  email?: string | null
  phone?: string | null
  title?: string | null
  lifecycleStage?: string
  version?: number
}

interface Props {
  initial?: PersonDraft
  /** 회사 상세에서 열면 그 회사로 고정된다 */
  fixedCompanyId?: string
  onClose: () => void
  onSaved: (id: string) => void
}

export default function PersonFormModal({ initial, fixedCompanyId, onClose, onSaved }: Props) {
  const editing = Boolean(initial?.id)
  const [name, setName] = useState(initial?.name ?? '')
  const [email, setEmail] = useState(initial?.email ?? '')
  const [phone, setPhone] = useState(initial?.phone ?? '')
  const [title, setTitle] = useState(initial?.title ?? '')
  const [stage, setStage] = useState(initial?.lifecycleStage ?? 'LEAD')
  const [companyId, setCompanyId] = useState(fixedCompanyId ?? initial?.companyId ?? '')
  const [companyName, setCompanyName] = useState(initial?.companyName ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /**
   * 소속 회사 찾기는 **서버가 한다.**
   * 예전엔 `?limit=100`으로 통째로 받아 `<select>`에 쏟았다 —
   * 101번째 회사는 화면에 아예 없었고, 그 사실이 어디에도 안 적혀 있었다.
   */
  const searchCompanies = useCallback(async (q: string, signal: AbortSignal): Promise<RecordOption[]> => {
    const res = await fetch(`/api/crm/companies?limit=20${q ? `&q=${encodeURIComponent(q)}` : ''}`, { signal })
    const body = await res.json()
    if (!res.ok) throw new Error(body?.error?.message ?? '회사를 불러오지 못했습니다.')
    return (body.items ?? []).map((c: { id: string; name: string }) => ({ id: c.id, name: c.name }))
  }, [])

  async function submit() {
    setSaving(true)
    setError(null)
    try {
      const payload: Record<string, unknown> = {
        name,
        email: email || null,
        phone: phone || null,
        title: title || null,
        lifecycleStage: stage,
        companyId: companyId || null,
      }
      if (editing) payload.version = initial?.version

      const res = await fetch(
        editing ? `/api/crm/people/${initial?.id}` : '/api/crm/people',
        {
          method: editing ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      )
      const body = await res.json()
      if (!res.ok) {
        setError(body?.error?.message ?? '저장하지 못했습니다.')
        return
      }
      onSaved(body.id)
    } catch {
      setError('저장하지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <NbModal
      title={editing ? '인물 수정' : '인물 추가'}
      onClose={onClose}
      footer={
        <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
          <NbButton variant="ghost" onClick={onClose} disabled={saving}>취소</NbButton>
          <NbButton onClick={() => void submit()} disabled={saving || !name.trim()}>
            {saving ? '저장 중…' : '저장'}
          </NbButton>
        </div>
      }
    >
      <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
        <FormErrorBanner message={error} />

        <div>
          <label className="label" htmlFor="crm-person-name">이름 *</label>
          <input
            id="crm-person-name" className="input-field" value={name}
            onChange={(e) => setName(e.target.value)} placeholder="예: 김담당" autoFocus
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
          <div>
            <label className="label" htmlFor="crm-person-email">이메일</label>
            <input
              id="crm-person-email" className="input-field" value={email}
              onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com"
            />
          </div>
          <div>
            <label className="label" htmlFor="crm-person-phone">연락처</label>
            <input
              id="crm-person-phone" className="input-field" value={phone}
              onChange={(e) => setPhone(e.target.value)} placeholder="010-0000-0000"
            />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
          <div>
            <label className="label" htmlFor="crm-person-title">직함</label>
            <input
              id="crm-person-title" className="input-field" value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="crm-person-stage">단계</label>
            <select
              id="crm-person-stage" className="input-field" value={stage}
              onChange={(e) => setStage(e.target.value)}
            >
              {Object.entries(STAGE_LABEL).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </div>
        </div>

        {!fixedCompanyId && (
          <div>
            <label className="label" htmlFor="crm-person-company">소속 회사</label>
            <RecordPickerField
              id="crm-person-company"
              noun="회사"
              value={companyId}
              valueName={companyName}
              placeholder="선택 안 함"
              onChange={(opt) => { setCompanyId(opt?.id ?? ''); setCompanyName(opt?.name ?? '') }}
              search={searchCompanies}
            />
          </div>
        )}
      </div>
    </NbModal>
  )
}
