'use client'

// 회사 만들기·고치기 (dacrm T1-02)
//
// NbModal 을 쓴다 — §2-2 체크리스트(ESC·X·tape-title·광원형 그림자·backdrop)를
// 부품이 이미 전부 처리한다. 화면이 다시 만들면 그때부터 갈린다.
// 입력은 input-field, 레이블은 label (§2-1) — 클래스가 없으면 브라우저 기본 렌더로 떨어진다.

import { useState } from 'react'
import NbModal from '@/components/ui/nb/NbModal'
import NbButton from '@/components/ui/nb/NbButton'
import FormErrorBanner from '@/components/ui/FormErrorBanner'

export interface CompanyDraft {
  id?: string
  name?: string
  domain?: string | null
  industry?: string | null
  region?: string | null
  employeeRange?: string | null
  descriptionMd?: string | null
  /** 수정일 때만. 낙관적 잠금의 근거다 */
  version?: number
}

interface Props {
  initial?: CompanyDraft
  onClose: () => void
  onSaved: (id: string) => void
}

const EMPLOYEE_RANGES = ['1-10', '11-50', '51-200', '201-1000', '1000+']

export default function CompanyFormModal({ initial, onClose, onSaved }: Props) {
  const editing = Boolean(initial?.id)
  const [name, setName] = useState(initial?.name ?? '')
  const [domain, setDomain] = useState(initial?.domain ?? '')
  const [industry, setIndustry] = useState(initial?.industry ?? '')
  const [region, setRegion] = useState(initial?.region ?? '')
  const [employeeRange, setEmployeeRange] = useState(initial?.employeeRange ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setSaving(true)
    setError(null)
    try {
      const payload: Record<string, unknown> = {
        name,
        domain: domain || null,
        industry: industry || null,
        region: region || null,
        employeeRange: employeeRange || null,
      }
      // 수정이면 화면이 들고 있던 버전을 함께 보낸다 — 그 사이 누가 고쳤으면 서버가 막는다
      if (editing) payload.version = initial?.version

      const res = await fetch(
        editing ? `/api/crm/companies/${initial?.id}` : '/api/crm/companies',
        {
          method: editing ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      )
      const body = await res.json()
      if (!res.ok) {
        // 서버가 준 문장을 그대로 보여 준다. 특히 409(다른 사람이 먼저 수정)는
        // 사용자가 무엇을 해야 할지 알아야 하므로 뭉뚱그리면 안 된다.
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
      title={editing ? '회사 수정' : '회사 추가'}
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
          <label className="label" htmlFor="crm-company-name">회사명 *</label>
          <input
            id="crm-company-name"
            className="input-field"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="예: 데이터얼라이언스"
            autoFocus
          />
        </div>

        <div>
          <label className="label" htmlFor="crm-company-domain">도메인</label>
          <input
            id="crm-company-domain"
            className="input-field"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="주소를 그대로 붙여 넣어도 됩니다"
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
          <div>
            <label className="label" htmlFor="crm-company-industry">산업</label>
            <input
              id="crm-company-industry"
              className="input-field"
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="crm-company-region">지역</label>
            <input
              id="crm-company-region"
              className="input-field"
              value={region}
              onChange={(e) => setRegion(e.target.value)}
            />
          </div>
        </div>

        <div>
          <label className="label" htmlFor="crm-company-size">규모</label>
          <select
            id="crm-company-size"
            className="input-field"
            value={employeeRange}
            onChange={(e) => setEmployeeRange(e.target.value)}
          >
            <option value="">선택 안 함</option>
            {EMPLOYEE_RANGES.map((r) => <option key={r} value={r}>{r}명</option>)}
          </select>
        </div>
      </div>
    </NbModal>
  )
}
