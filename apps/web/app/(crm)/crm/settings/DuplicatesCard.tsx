'use client'

// 중복 정리 카드 (dacrm T1-11, DI-10·11)
//
// 중복은 반드시 생긴다. 문제는 **합치는 걸 무서워한다**는 것이다 —
// 되돌릴 수 없으면 아무도 안 누르고, 안 누르면 중복은 그대로 쌓인다.
//
// 그래서 이 화면이 하는 일은 세 가지뿐이다.
//   ① 무엇이 왜 중복 같은지 근거를 보여 준다 (점수만 던지지 않는다)
//   ② 어느 쪽을 남길지 **사람이 고른다** (자동으로 정하지 않는다)
//   ③ 합친 직후 **되돌리기**를 그 자리에 띄운다 (설정 어딘가로 보내지 않는다)

import { useCallback, useEffect, useState } from 'react'
import NbButton from '@/components/ui/nb/NbButton'
import NbBadge from '@/components/ui/nb/NbBadge'
import AXDotLoader from '@/components/ui/AXDotLoader'
import EmptyState from '@/components/ui/EmptyState'
import FormErrorBanner from '@/components/ui/FormErrorBanner'
import SegmentedTabs from '@/components/ui/SegmentedTabs'
import styles from './settings.module.css'

type Target = 'company' | 'person'

interface Side { id: string; name: string; domain?: string | null; email?: string | null }
interface Candidate { id: string; score: number; a: Side; b: Side }

const TARGETS = [
  { id: 'company', label: '회사' },
  { id: 'person', label: '인물' },
]

/** 점수를 그대로 보여 주면 아무 뜻도 없다 — 사람이 읽는 확신도로 바꾼다 */
function confidence(score: number): { label: string; status: 'done' | 'doing' | 'note' } {
  if (score >= 0.85) return { label: '거의 확실', status: 'done' }
  if (score >= 0.7) return { label: '비슷함', status: 'doing' }
  return { label: '확인 필요', status: 'note' }
}

function sub(side: Side): string {
  return side.domain ?? side.email ?? '추가 정보 없음'
}

export default function DuplicatesCard() {
  const [target, setTarget] = useState<Target>('company')
  const [items, setItems] = useState<Candidate[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** 방금 합친 것 — 되돌릴 기회를 그 자리에서 준다 */
  const [lastMerge, setLastMerge] = useState<{ id: string; label: string } | null>(null)

  const load = useCallback(async (t: Target) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/crm/duplicates?targetType=${t}`)
      const body = await res.json()
      if (!res.ok) { setError(body?.error?.message ?? '중복 후보를 불러오지 못했습니다.'); return }
      setItems(body.items ?? [])
    } catch {
      setError('중복 후보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load(target) }, [load, target])

  async function scan() {
    setBusy('scan')
    setError(null)
    try {
      const res = await fetch(`/api/crm/duplicates?targetType=${target}`, { method: 'POST' })
      const body = await res.json()
      if (!res.ok) { setError(body?.error?.message ?? '훑어보지 못했습니다.'); return }
      await load(target)
    } catch {
      setError('훑어보지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setBusy(null)
    }
  }

  /** 잘못 잡힌 짝을 치운다 — 목록에서 사라지는 것 자체가 결과다(별도 안내 불필요) */
  async function dismiss(c: Candidate) {
    setBusy(c.id)
    setError(null)
    try {
      const res = await fetch(`/api/crm/duplicates?id=${encodeURIComponent(c.id)}`, { method: 'DELETE' })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        setError(body?.error?.message ?? '치우지 못했습니다.')
        return
      }
      await load(target)
    } catch {
      setError('치우지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setBusy(null)
    }
  }

  async function merge(c: Candidate, keep: Side, drop: Side) {
    setBusy(c.id)
    setError(null)
    try {
      const res = await fetch('/api/crm/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetType: target, survivorId: keep.id, mergedId: drop.id }),
      })
      const body = await res.json()
      if (!res.ok) { setError(body?.error?.message ?? '합치지 못했습니다.'); return }
      setLastMerge({ id: body.mergeLogId, label: `${drop.name} → ${keep.name}` })
      await load(target)
    } catch {
      setError('합치지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setBusy(null)
    }
  }

  async function undo() {
    if (!lastMerge) return
    setBusy('undo')
    setError(null)
    try {
      const res = await fetch('/api/crm/merge?undo=1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mergeLogId: lastMerge.id }),
      })
      const body = await res.json()
      if (!res.ok) { setError(body?.error?.message ?? '되돌리지 못했습니다.'); return }
      setLastMerge(null)
      await load(target)
    } catch {
      setError('되돌리지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className={`card ${styles.card}`}>
      <div className={styles.head}>
        <h2 className={styles.title}>중복 정리</h2>
        <NbButton variant="ghost" onClick={() => void scan()} disabled={busy === 'scan'}>
          {busy === 'scan' ? '훑는 중…' : '지금 훑기'}
        </NbButton>
      </div>

      <FormErrorBanner message={error} />

      <SegmentedTabs
        ariaLabel="중복 정리 대상"
        tabs={TARGETS}
        activeId={target}
        onSelect={(id) => setTarget(id as Target)}
      />

      {lastMerge && (
        <p className={styles.undo}>
          {lastMerge.label} 로 합쳤어요. 30일 안에 되돌릴 수 있습니다.{' '}
          <NbButton variant="ghost" onClick={() => void undo()} disabled={busy === 'undo'}>
            {busy === 'undo' ? '되돌리는 중…' : '되돌리기'}
          </NbButton>
        </p>
      )}

      {loading && items.length === 0 ? (
        <AXDotLoader />
      ) : items.length === 0 ? (
        <EmptyState
          title="합칠 만한 것이 안 보여요"
          description="새로 들어온 자료가 있으면 '지금 훑기'를 눌러 다시 확인할 수 있습니다."
        />
      ) : (
        <ul className={styles.dupes}>
          {items.map((c) => {
            const conf = confidence(c.score)
            return (
              <li key={c.id} className={styles.dupe}>
                <div className={styles.dupeHead}>
                  <NbBadge status={conf.status}>{conf.label}</NbBadge>
                </div>
                <div className={styles.dupePair}>
                  {[c.a, c.b].map((side, i) => (
                    <div key={side.id} className={styles.dupeSide}>
                      <span className={styles.dupeName}>{side.name}</span>
                      <span className={styles.dupeSub}>{sub(side)}</span>
                      <NbButton
                        variant="ghost"
                        disabled={busy === c.id}
                        onClick={() => void merge(c, side, i === 0 ? c.b : c.a)}
                      >
                        이쪽을 남기기
                      </NbButton>
                    </div>
                  ))}
                </div>
                {/* 잘못 잡힌 짝을 치울 길 — 없으면 같은 것을 영원히 보게 되고,
                    그러면 진짜 중복도 같이 안 보게 된다 */}
                <NbButton
                  variant="ghost"
                  disabled={busy === c.id}
                  onClick={() => void dismiss(c)}
                >
                  이건 중복 아니에요
                </NbButton>
              </li>
            )
          })}
        </ul>
      )}

      <p className={styles.hint}>
        합치면 딜·활동·할 일이 전부 남기는 쪽으로 옮겨집니다. 사라지는 쪽은 30일간 보관돼 되돌릴 수 있습니다.
      </p>
    </div>
  )
}
