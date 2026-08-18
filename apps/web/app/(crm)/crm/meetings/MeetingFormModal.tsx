'use client'

// 미팅 기록 만들기 (dacrm F2)
//
// 회사·딜을 **고르게** 한다. 자유 입력으로 두면 미팅이 어느 건의 기록인지 알 수 없고,
// 그러면 딜 상세에서 "이 딜에 무슨 이야기가 오갔나"를 못 보여 준다.
//
// 다만 **둘 다 없어도 저장된다.** 첫 만남은 회사가 아직 CRM 에 없을 때가 많다 —
// 그때 기록을 못 남기게 하면 사람은 다른 곳에 적고, 그 기록은 영영 안 들어온다.

import { useCallback, useState } from 'react'
import NbModal from '@/components/ui/nb/NbModal'
import NbButton from '@/components/ui/nb/NbButton'
import FormErrorBanner from '@/components/ui/FormErrorBanner'
import DateField from '@/components/ui/DateField'
import RecordPickerField, { type RecordOption } from '@/components/ui/RecordPicker'
import { kstTodayKey } from '@/lib/datetime/kst'

interface Props {
  onClose: () => void
  onSaved: (id: string) => void
  /** 딜 상세에서 열면 그 딜로 고정된다 */
  fixedDealId?: string
  fixedCompanyId?: string
}

export default function MeetingFormModal({ onClose, onSaved, fixedDealId, fixedCompanyId }: Props) {
  const [title, setTitle] = useState('')
  const [date, setDate] = useState(kstTodayKey())
  const [time, setTime] = useState('14:00')
  const [companyId, setCompanyId] = useState(fixedCompanyId ?? '')
  const [dealId, setDealId] = useState(fixedDealId ?? '')
  const [location, setLocation] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [dealName, setDealName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /**
   * 찾기는 **서버가 한다.**
   * 예전엔 회사·딜을 각각 `?limit=100`으로 통째로 받아 `<select>`에 쏟았다 —
   * 101번째부터는 화면에 아예 없었고(없다는 말도 없이), 목록이 길어지면 눈으로 훑는 것 말고는
   * 고를 방법이 없었다.
   */
  const searchCompanies = useCallback(async (q: string, signal: AbortSignal): Promise<RecordOption[]> => {
    const res = await fetch(`/api/crm/companies?limit=20${q ? `&q=${encodeURIComponent(q)}` : ''}`, { signal })
    const body = await res.json()
    if (!res.ok) throw new Error(body?.error?.message ?? '회사를 불러오지 못했습니다.')
    return (body.items ?? []).map((c: { id: string; name: string }) => ({ id: c.id, name: c.name }))
  }, [])

  const searchDeals = useCallback(async (q: string, signal: AbortSignal): Promise<RecordOption[]> => {
    const res = await fetch(`/api/crm/deals?limit=20${q ? `&q=${encodeURIComponent(q)}` : ''}`, { signal })
    const body = await res.json()
    if (!res.ok) throw new Error(body?.error?.message ?? '딜을 불러오지 못했습니다.')
    return (body.items ?? []).map((d: { id: string; name: string }) => ({ id: d.id, name: d.name }))
  }, [])

  async function save() {
    if (!title.trim()) { setError('무슨 미팅이었는지 적어 주세요.'); return }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/crm/meetings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          // KST 벽시계를 그대로 보낸다 — 서버가 +09:00 앵커로 저장한다(datetime SSOT)
          startedAt: `${date}T${time}:00+09:00`,
          companyId: companyId || null,
          dealId: dealId || null,
          location: location.trim() || null,
        }),
      })
      const body = await res.json()
      if (!res.ok) { setError(body?.error?.message ?? '저장하지 못했습니다.'); return }
      onSaved(body.id)
    } catch {
      setError('저장하지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <NbModal title="미팅 기록" onClose={onClose}>
      <FormErrorBanner message={error} />

      <label className="label" htmlFor="meeting-title">무슨 미팅이었나요</label>
      <input
        id="meeting-title" className="input-field" value={title} autoFocus
        placeholder="예: 삼성SDS GPU 도입 2차 미팅"
        onChange={(e) => setTitle(e.target.value)}
      />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)', marginTop: 'var(--space-3)' }}>
        <div>
          <label className="label" htmlFor="meeting-date">날짜</label>
          <DateField id="meeting-date" value={date} onValueChange={setDate} />
        </div>
        <div>
          <label className="label" htmlFor="meeting-time">시각</label>
          <input id="meeting-time" className="input-field" type="time" value={time}
            onChange={(e) => setTime(e.target.value)} />
        </div>
      </div>

      {!fixedCompanyId && (
        <>
          <label className="label" htmlFor="meeting-company" style={{ marginTop: 'var(--space-3)' }}>회사</label>
          <RecordPickerField
            id="meeting-company"
            noun="회사"
            value={companyId}
            valueName={companyName}
            placeholder="(아직 없음)"
            onChange={(opt) => { setCompanyId(opt?.id ?? ''); setCompanyName(opt?.name ?? '') }}
            search={searchCompanies}
          />
        </>
      )}

      {!fixedDealId && (
        <>
          <label className="label" htmlFor="meeting-deal" style={{ marginTop: 'var(--space-3)' }}>딜</label>
          <RecordPickerField
            id="meeting-deal"
            noun="딜"
            value={dealId}
            valueName={dealName}
            placeholder="(아직 없음)"
            onChange={(opt) => { setDealId(opt?.id ?? ''); setDealName(opt?.name ?? '') }}
            search={searchDeals}
          />
        </>
      )}

      <label className="label" htmlFor="meeting-place" style={{ marginTop: 'var(--space-3)' }}>장소</label>
      <input id="meeting-place" className="input-field" value={location}
        placeholder="예: 고객사 회의실 / 화상"
        onChange={(e) => setLocation(e.target.value)} />

      <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end', marginTop: 'var(--space-4)' }}>
        <NbButton variant="ghost" onClick={onClose}>취소</NbButton>
        <NbButton onClick={() => void save()} disabled={saving}>
          {saving ? '저장 중…' : '저장'}
        </NbButton>
      </div>
    </NbModal>
  )
}
