'use client'

// 딜 참석자 패널 (dacrm 정정판)
//
// 예전엔 이 자리가 **회사의 인물 전체**를 보여 줬다. 회사에 스무 명이 있으면 스무 명을.
// 그러면 "누구를 설득해야 하나"에 화면이 답을 못 한다 — 그게 딜 상세를 여는 이유인데도.
//
// 이제 이 딜에 실제로 관여하는 사람만, **역할과 함께** 보여 준다.
// 특히 **반대**하는 사람이 보여야 한다. 딜이 막히는 진짜 이유가 거기 있을 때가 많고,
// 그건 어느 필드에도 안 적히고 사람 머릿속에만 있다.

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import NbButton from '@/components/ui/nb/NbButton'
import NbBadge from '@/components/ui/nb/NbBadge'
import ContactLink from '@/components/ui/ContactLink'
import EmptyState from '@/components/ui/EmptyState'
import FormErrorBanner from '@/components/ui/FormErrorBanner'
import type { StatusKey } from '@/lib/tokens/status-colors'
import styles from './deal-contacts.module.css'

interface Contact {
  personId: string
  name: string
  title: string | null
  email: string | null
  phone: string | null
  role: string
}

interface Candidate { id: string; name: string; title?: string | null }

const ROLE_LABEL: Record<string, string> = {
  CHAMPION: '우리 편',
  DECISION_MAKER: '결정권자',
  PRACTITIONER: '실무자',
  BLOCKER: '반대',
  OTHER: '관련자',
}

/** 반대는 눈에 띄어야 한다 — 그게 딜이 안 되는 이유일 때가 많다 */
const ROLE_STATUS: Record<string, StatusKey> = {
  CHAMPION: 'done',
  DECISION_MAKER: 'doing',
  PRACTITIONER: 'planned',
  BLOCKER: 'blocker',
  OTHER: 'note',
}

interface Props {
  dealId: string
  companyId: string | null
}

export default function DealContacts({ dealId, companyId }: Props) {
  const [items, setItems] = useState<Contact[]>([])
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const res = await fetch(`/api/crm/deals/${dealId}/contacts`)
      const body = await res.json()
      if (!res.ok) { setError(body?.error?.message ?? '참석자를 불러오지 못했습니다.'); return }
      setItems(body.items ?? [])
    } catch {
      setError('참석자를 불러오지 못했습니다.')
    }
  }, [dealId])

  useEffect(() => { void load() }, [load])

  /** 후보는 그 회사 사람들 — 아무나 넣을 수 있게 하면 잘못 넣기 쉽다 */
  async function openAdd() {
    setAdding(true)
    if (!companyId || candidates.length > 0) return
    try {
      const res = await fetch(`/api/crm/people?companyId=${companyId}&limit=50`)
      const body = await res.json()
      if (res.ok) setCandidates(body.items ?? [])
    } catch { /* 후보를 못 불러와도 패널 자체는 살아 있어야 한다 */ }
  }

  async function add(personId: string, role: string) {
    setBusy(personId)
    setError(null)
    try {
      const res = await fetch(`/api/crm/deals/${dealId}/contacts`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personId, role }),
      })
      const body = await res.json()
      if (!res.ok) { setError(body?.error?.message ?? '넣지 못했습니다.'); return }
      setAdding(false)
      await load()
    } catch {
      setError('넣지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setBusy(null)
    }
  }

  async function remove(personId: string) {
    setBusy(personId)
    setError(null)
    try {
      const res = await fetch(`/api/crm/deals/${dealId}/contacts?personId=${personId}`, { method: 'DELETE' })
      const body = await res.json()
      if (!res.ok) { setError(body?.error?.message ?? '빼지 못했습니다.'); return }
      await load()
    } catch {
      setError('빼지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setBusy(null)
    }
  }

  const already = new Set(items.map((i) => i.personId))
  const pickable = candidates.filter((c) => !already.has(c.id))

  return (
    <>
      <FormErrorBanner message={error} />

      {items.length === 0 ? (
        <EmptyState
          title="이 딜에 연결된 사람이 없어요"
          description="누가 결정하고 누가 반대하는지 적어 두면 다음에 무엇을 할지가 분명해집니다."
        />
      ) : (
        <ul className={styles.list}>
          {items.map((c) => (
            <li key={c.personId} className={styles.item}>
              <Link href={`/crm/people/${c.personId}`} className={styles.name}>{c.name}</Link>
              <NbBadge status={ROLE_STATUS[c.role] ?? 'note'}>{ROLE_LABEL[c.role] ?? c.role}</NbBadge>
              {c.title && <span className={styles.title}>{c.title}</span>}
              {/* 회사 상세의 인물 목록과 같은 부품 — 딜 화면에서도 그 자리에서 연락한다 */}
              {c.email && <ContactLink kind="email" value={c.email} />}
              {c.phone && <ContactLink kind="phone" value={c.phone} />}
              <NbButton variant="ghost" disabled={busy === c.personId} onClick={() => void remove(c.personId)}>
                빼기
              </NbButton>
            </li>
          ))}
        </ul>
      )}

      {!adding ? (
        <NbButton variant="ghost" onClick={() => void openAdd()} disabled={!companyId}>
          사람 넣기
        </NbButton>
      ) : pickable.length === 0 ? (
        <EmptyState
          title="더 넣을 사람이 없어요"
          description="이 회사에 등록된 담당자를 이미 다 넣었습니다."
          action={companyId ? { label: '회사에 담당자 추가', href: `/crm/companies/${companyId}` } : undefined}
        />
      ) : (
        <ul className={styles.list}>
          {pickable.map((p) => (
            <li key={p.id} className={styles.item}>
              <span className={styles.name}>{p.name}</span>
              <select
                className="input-field"
                defaultValue="OTHER"
                disabled={busy === p.id}
                onChange={(e) => void add(p.id, e.target.value)}
                aria-label={`${p.name} 역할`}
              >
                <option value="" disabled>역할 고르기</option>
                {Object.entries(ROLE_LABEL).map(([v, label]) => (
                  <option key={v} value={v}>{label}</option>
                ))}
              </select>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
