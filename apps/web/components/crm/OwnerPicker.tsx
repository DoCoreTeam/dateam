'use client'

/**
 * 담당자를 바꾸는 한 벌 — 딜·거래처·고객이 같은 것을 쓴다
 *
 * **왜 부품으로 두나** (실측 2026-09-29)
 *
 *   담당자 칸은 세 화면에 그려져 있는데 **바꾸는 자리가 어디에도 없었다.** 창구는 딜에만
 *   열려 있었고 그 창구를 부르는 화면이 0곳이었다. 화면마다 따로 붙이면 셋이 곧 갈라진다 —
 *   한 곳은 이관을 막고 한 곳은 안 막는 식으로. 그래서 여기 한 벌만 둔다.
 *
 * **단추를 숨기는 것은 보안이 아니다.** 허락은 창구가 다시 판정한다
 *   (`owner-decide.ts`). 여기서 안 그리는 것은 못 하는 동작을 눌러 보게 하지 않으려는 것뿐이다.
 *
 * **담당자 본인은 권한 없이 넘길 수 있다.** 그게 이관이다. 휴가·인수인계에 승인을 받게 하면
 *   아무도 안 넘기고 방치한다. 그래서 단추 조건은 「내가 담당이거나 권한이 있거나」다.
 */

import { useEffect, useRef, useState } from 'react'
import Person from '@/components/ui/Person'
import EmptyState from '@/components/ui/EmptyState'
import { SkelList } from '@/components/ui/LoadingSkeleton'
import type { PersonJson } from '@/lib/crm/services/member-display'
import styles from './owner-picker.module.css'

/** 개체마다 다른 것은 창구 주소 한 줄뿐이다 */
const PATH: Record<OwnerPickerEntity, string> = {
  deal: 'deals',
  company: 'companies',
  person: 'people',
}

export type OwnerPickerEntity = 'deal' | 'company' | 'person'

interface MemberRow {
  id: string
  displayName: string | null
  position?: string | null
  rank?: string | null
  title?: string | null
}

interface MembersResponse {
  items?: MemberRow[]
  viewer?: { memberId: string; canReassign: boolean }
}

interface Props {
  entity: OwnerPickerEntity
  /** 바꿀 행의 id */
  id: string
  /** 화면이 들고 있는 버전 — 어긋나면 창구가 409 로 막는다 */
  version: number
  owner: PersonJson | null
  /** 담당자가 아니라 조직 상위가 대신 맡고 있는 상태인가 */
  acting?: boolean
  actingVia?: string | null
  /** 바뀐 뒤 화면이 다시 읽게 한다 */
  onChanged: () => void
}

export default function OwnerPicker({
  entity, id, version, owner, acting, actingVia, onChanged,
}: Props) {
  const [members, setMembers] = useState<MemberRow[] | null>(null)
  const [viewer, setViewer] = useState<MembersResponse['viewer']>(undefined)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  // 멤버 목록은 한 번만 읽는다. 「나는 누구인가」도 같은 응답에 실려 온다
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const res = await fetch('/api/crm/members')
        if (!res.ok) return
        const json = await res.json() as { data?: MembersResponse } & MembersResponse
        const body = json.data ?? json
        if (!alive) return
        setMembers(body.items ?? [])
        setViewer(body.viewer)
      } catch {
        // 목록을 못 읽어도 화면은 멈추지 않는다 — 단추만 안 선다
      }
    })()
    return () => { alive = false }
  }, [])

  // 바깥을 누르면 닫는다
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  /**
   * 내가 바꿀 수 있나. 둘 중 하나면 된다.
   * 담당자가 아예 없는 행은 **아무나 맡을 수 있게** 연다 — 주인 없는 행을 아무도 못 맡으면
   * 그 행은 영영 누구의 목록에도 안 뜬다(그게 이 판을 하게 만든 상태다).
   */
  const canChange = Boolean(
    viewer && (viewer.canReassign || !owner || owner.memberId === viewer.memberId),
  )

  async function choose(nextId: string) {
    if (nextId === owner?.memberId) { setOpen(false); return }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/crm/${PATH[entity]}/${id}/owner`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerId: nextId, version }),
      })
      if (!res.ok) {
        // 창구가 사람 말로 사유를 준다(권한·범위·버전). 그 말을 그대로 보인다
        const body = await res.json().catch(() => null) as { error?: { message?: string } } | null
        setError(body?.error?.message ?? '담당자를 바꾸지 못했습니다. 잠시 후 다시 시도해 주세요.')
        return
      }
      setOpen(false)
      onChanged()
    } catch {
      setError('담당자를 바꾸지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setSaving(false)
    }
  }

  const current = (
    <Person
      name={owner?.name ?? null}
      explicitTitle={owner?.explicitTitle}
      position={owner?.position}
      rank={owner?.rank}
      acting={acting}
      tooltip={acting && actingVia ? `${actingVia} 의 장으로서 대신 맡고 있습니다` : undefined}
      emptyLabel="담당자 없음"
    />
  )

  // 못 바꾸는 사람에게는 누르는 자리를 안 그린다 — 딜 상세의 작성자 칸과 같은 모양이 된다
  if (!canChange) return current

  return (
    <div className={styles.wrap} ref={boxRef}>
      <button
        type="button"
        className={styles.trigger}
        onClick={() => setOpen((v) => !v)}
        disabled={saving}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="담당자 바꾸기"
      >
        {current}
        <span className={styles.caret} aria-hidden="true">▾</span>
        <span className={styles.sr}>담당자 바꾸기</span>
      </button>

      {open && (
        <div className={styles.panel} role="listbox" aria-label="담당자 고르기">
          {members === null ? (
            /* 아직 안 왔다. 「없다」고 쓰면 거짓말이 된다 — 기다리는 것과 비어 있는 것은 다르다 */
            <SkelList rows={3} />
          ) : members.length === 0 ? (
            <EmptyState
              title="고를 수 있는 멤버가 없어요"
              description="팀원을 들이면 담당자로 세울 수 있습니다"
              action={{ label: '멤버 관리', href: '/crm/members' }}
            />
          ) : (
            members.map((m) => (
              <button
                key={m.id}
                type="button"
                role="option"
                aria-selected={m.id === owner?.memberId}
                className={m.id === owner?.memberId ? `${styles.row} ${styles.rowOn}` : styles.row}
                onClick={() => { void choose(m.id) }}
                disabled={saving}
              >
                <Person
                  name={m.displayName}
                  explicitTitle={m.title}
                  position={m.position}
                  rank={m.rank}
                  emptyLabel="이름 없음"
                />
              </button>
            ))
          )}
        </div>
      )}

      {error && <p className={styles.error} role="alert">{error}</p>}
    </div>
  )
}
