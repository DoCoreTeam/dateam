'use client'

// 회의노트 → 영업 CRM 발행 카드
//
// 이 회의가 고객사 건이면 영업팀도 봐야 한다. 그런데 지금까지 두 화면이 서로를 몰라서
// 같은 회의를 **두 번 기록**해야 했다. 여기서 한 번 올리면 CRM 이 그 시점의 스냅샷을 받는다.
//
// 세 가지를 지킨다.
//   ① **CRM 멤버가 아니면 아무것도 안 보인다** — 못 쓰는 버튼을 보여 주면 그게 더 나쁘다
//   ② **올리는 순간 공개된다는 걸 먼저 말한다** — 개인 노트가 팀에 보이는 일이다
//   ③ **되돌릴 수 있다** — 연결 해제가 있어야 사람이 부담 없이 올린다

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Briefcase, ExternalLink } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import NbBadge from '@/components/ui/nb/NbBadge'
import NbModal from '@/components/ui/nb/NbModal'
import InlineError from '@/components/ui/InlineError'
import AXDotLoader from '@/components/ui/AXDotLoader'
import RecordPickerField, { type RecordOption } from '@/components/ui/RecordPicker'

interface LinkedMeeting {
  id: string
  title: string
  companyId: string | null
  dealId: string | null
}

/** 아직 모름 → CRM 을 못 씀 → 안 올림 → 올림. 상태를 섞으면 버튼이 깜빡인다 */
type Phase = 'loading' | 'no-access' | 'unlinked' | 'linked'

export default function CrmPublishCard({ noteId }: { noteId: string }) {
  const [phase, setPhase] = useState<Phase>('loading')
  const [linked, setLinked] = useState<LinkedMeeting | null>(null)
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [companyId, setCompanyId] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [dealId, setDealId] = useState('')
  const [dealName, setDealName] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/crm/meetings?noteId=${encodeURIComponent(noteId)}&limit=1`)
      if (res.status === 401 || res.status === 403) { setPhase('no-access'); return }
      if (!res.ok) { setPhase('no-access'); return }
      const body = await res.json()
      const first: LinkedMeeting | undefined = (body.items ?? [])[0]
      if (first) { setLinked(first); setPhase('linked') }
      else { setLinked(null); setPhase('unlinked') }
    } catch {
      // CRM 을 못 읽는 건 이 화면의 실패가 아니다 — 회의노트는 그대로 쓸 수 있어야 한다
      setPhase('no-access')
    }
  }, [noteId])

  useEffect(() => { void load() }, [load])

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

  async function publish() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/crm/meetings/from-note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ noteId, companyId: companyId || null, dealId: dealId || null }),
      })
      const body = await res.json()
      if (!res.ok) { setError(body?.error?.message ?? '영업 CRM에 올리지 못했습니다.'); return }
      setPicking(false)
      setNotice(
        body.alreadyPublished
          ? '이미 올라가 있어요.'
          : `영업 CRM에 올렸어요.${body.segmentCount ? ` 회의 내용 ${body.segmentCount}줄을 함께 보냈습니다.` : ''}`,
      )
      await load()
    } catch {
      setError('영업 CRM에 올리지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setBusy(false)
    }
  }

  async function unlink() {
    if (!linked) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/crm/meetings/${linked.id}/unpublish`, { method: 'POST' })
      const body = await res.json()
      if (!res.ok) { setError(body?.error?.message ?? '연결을 해제하지 못했습니다.'); return }
      setNotice('연결을 해제했어요. 영업 CRM의 기록은 그대로 남습니다.')
      await load()
    } catch {
      setError('연결을 해제하지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setBusy(false)
    }
  }

  // CRM 을 못 쓰는 사람에게는 아무것도 안 보인다. 로딩 중에도 자리를 잡지 않는다 —
  // 잠깐 떴다 사라지는 카드는 "뭔가 잘못됐나"로 읽힌다.
  if (phase === 'loading' || phase === 'no-access') return null

  return (
    <div className="card" style={{ padding: 'var(--space-4)', marginTop: 'var(--space-4)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        <Briefcase size={16} aria-hidden />
        <strong style={{ fontSize: 'var(--fs-base)' }}>영업 CRM</strong>

        {phase === 'linked' && linked ? (
          <>
            <NbBadge status="done">올라감</NbBadge>
            <Link
              href={`/crm/meetings/${linked.id}`}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '.25rem' }}
            >
              {linked.title} <ExternalLink size={14} aria-hidden />
            </Link>
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 'var(--space-2)' }}>
              <NbButton variant="ghost" onClick={() => void unlink()} disabled={busy}>
                연결 해제
              </NbButton>
            </span>
          </>
        ) : (
          <span style={{ marginLeft: 'auto' }}>
            <NbButton onClick={() => setPicking(true)} disabled={busy}>영업 CRM에 올리기</NbButton>
          </span>
        )}
      </div>

      <p style={{ margin: 'var(--space-2) 0 0', fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
        {phase === 'linked'
          ? '이 회의는 영업 CRM에서도 보입니다. 내용을 고치면 CRM에서 “다시 가져오기”로 따라잡을 수 있어요.'
          : '고객사 미팅이면 영업 CRM에 올려 두세요. 회의 내용과 요약이 함께 넘어가고, AI가 딜에 반영할 것을 찾아 줍니다.'}
      </p>

      {error && <InlineError spaced>{error}</InlineError>}
      {notice && (
        <p style={{ margin: 'var(--space-2) 0 0', fontSize: 'var(--fs-sm)', color: 'var(--success)' }}>{notice}</p>
      )}

      {picking && (
        <NbModal title="영업 CRM에 올리기" onClose={() => setPicking(false)}>
          {error && <InlineError spaced>{error}</InlineError>}
          {/* 공개된다는 사실을 버튼보다 먼저 말한다 — 누른 뒤에 아는 건 늦다 */}
          <p style={{ margin: '0 0 var(--space-3)', fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
            올리면 이 회의의 제목·내용·요약이 <strong>영업 CRM 멤버에게 보입니다.</strong>
            고치거나 지우는 건 계속 나만 할 수 있어요. 언제든 연결을 해제할 수 있습니다.
          </p>

          <label className="label" htmlFor="publish-company">회사</label>
          <RecordPickerField
            id="publish-company"
            noun="회사"
            value={companyId}
            valueName={companyName}
            placeholder="(나중에 골라도 됩니다)"
            onChange={(opt) => { setCompanyId(opt?.id ?? ''); setCompanyName(opt?.name ?? '') }}
            search={searchCompanies}
          />

          <label className="label" htmlFor="publish-deal" style={{ marginTop: 'var(--space-3)' }}>딜</label>
          <RecordPickerField
            id="publish-deal"
            noun="딜"
            value={dealId}
            valueName={dealName}
            placeholder="(나중에 골라도 됩니다)"
            onChange={(opt) => { setDealId(opt?.id ?? ''); setDealName(opt?.name ?? '') }}
            search={searchDeals}
          />

          <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end', marginTop: 'var(--space-4)' }}>
            <NbButton variant="ghost" onClick={() => setPicking(false)}>취소</NbButton>
            <NbButton onClick={() => void publish()} disabled={busy}>
              {busy ? '올리는 중…' : '올리기'}
            </NbButton>
          </div>
          {busy && <AXDotLoader />}
        </NbModal>
      )}
    </div>
  )
}
