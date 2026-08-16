'use client'

// 프로세스 — 단계와 진입 조건 (dacrm)
//
// **이 화면이 답하는 것**: "이 단계까지 온 딜은 최소한 무엇이 정해져 있나."
//
// 예전엔 이 화면이 "아직 편집할 프로세스가 없어요"만 띄웠다. 파이프라인 4종과
// 단계 25개가 이미 DB 에 있는데도 그랬다 — 화면이 아무것도 읽지 않았기 때문이다.
//
// 여기서 켠 조건은 **딜을 옮길 때 실제로 검사된다**. 설정만 있고 아무 일도 안 일어나면
// 그건 기능이 아니라 화면이다.

import { useCallback, useEffect, useState } from 'react'
import { Workflow, AlertTriangle, Ban } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import NbBadge from '@/components/ui/nb/NbBadge'
import AXDotLoader from '@/components/ui/AXDotLoader'
import EmptyState from '@/components/ui/EmptyState'
import ErrorState from '@/components/ui/ErrorState'
import FormErrorBanner from '@/components/ui/FormErrorBanner'
import SegmentedTabs from '@/components/ui/SegmentedTabs'
import { ALL_CRITERIA, CRITERION_LABEL, type CriterionKey, type CriterionLevel } from '@/lib/crm/domain/entry-criteria'
import styles from './process.module.css'

interface Criterion { key: CriterionKey; level: CriterionLevel }
interface Stage {
  id: string; name: string; position: number; kind: string
  criteria: Criterion[]; dealCount: number
}
interface Pipeline { id: string; name: string; isDefault: boolean; stages: Stage[] }

/** 조건 수준 3단계 — 사람 말로. "없음"도 선택지다(대부분의 단계가 그렇다) */
const LEVELS: { value: 'off' | CriterionLevel; label: string; hint: string }[] = [
  { value: 'off', label: '안 봄', hint: '이 단계에서는 확인하지 않아요' },
  { value: 'warn', label: '알려 줌', hint: '비어 있으면 알려 주되 옮기는 건 됩니다' },
  { value: 'block', label: '막음', hint: '비어 있으면 이 단계로 못 옵니다' },
]

function levelOf(s: Stage, key: CriterionKey): 'off' | CriterionLevel {
  return s.criteria.find((c) => c.key === key)?.level ?? 'off'
}

export default function ProcessClient({ canEdit }: { canEdit: boolean }) {
  const [pipelines, setPipelines] = useState<Pipeline[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/crm/pipelines')
      const body = await res.json()
      if (!res.ok) { setError(body?.error?.message ?? '프로세스를 불러오지 못했습니다.'); return }
      const items: Pipeline[] = body.items ?? []
      setPipelines(items)
      setActiveId((cur) => cur ?? items.find((p) => p.isDefault)?.id ?? items[0]?.id ?? null)
    } catch {
      setError('프로세스를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  async function setLevel(stage: Stage, key: CriterionKey, level: 'off' | CriterionLevel) {
    const next = stage.criteria.filter((c) => c.key !== key)
    if (level !== 'off') next.push({ key, level })

    setBusy(`${stage.id}:${key}`)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch(`/api/crm/stages/${stage.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ criteria: next }),
      })
      const body = await res.json()
      if (!res.ok) { setError(body?.error?.message ?? '바꾸지 못했습니다.'); return }
      setNotice(
        level === 'off'
          ? `"${stage.name}"에서 ${CRITERION_LABEL[key]} 확인을 껐어요.`
          : `"${stage.name}"에 오려면 ${CRITERION_LABEL[key]}이(가) ` +
            (level === 'block' ? '있어야 합니다.' : '없으면 알려 드릴게요.'),
      )
      await load()
    } catch {
      setError('바꾸지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setBusy(null)
    }
  }

  if (loading && pipelines.length === 0) return <AXDotLoader />
  if (error && pipelines.length === 0) return <ErrorState message={error} onRetry={() => void load()} />

  if (pipelines.length === 0) {
    return (
      <EmptyState
        title="아직 파이프라인이 없어요"
        description="파이프라인을 만들면 단계와 진입 조건을 여기서 손볼 수 있습니다."
        icon={<Workflow size={28} />}
      />
    )
  }

  const active = pipelines.find((p) => p.id === activeId) ?? pipelines[0]

  return (
    <>
      <FormErrorBanner message={error} />
      {notice && <p className={styles.notice}>{notice}</p>}

      <div className={styles.toolbar}>
        <SegmentedTabs
          tabs={pipelines.map((p) => ({ id: p.id, label: p.name }))}
          ariaLabel="파이프라인"
          activeId={active.id}
          onSelect={setActiveId}
        />
      </div>

      <p className={styles.lead}>
        여기서 켠 조건은 <strong>딜을 그 단계로 옮길 때 실제로 확인</strong>됩니다.
        막으면 못 옮기고, 알려 주기로 하면 옮기되 무엇이 비었는지 말해 줍니다.
      </p>

      <ol className={styles.stages}>
        {active.stages.map((s) => (
          <li key={s.id} className={`card ${styles.stage}`}>
            <div className={styles.stageHead}>
              <span className={styles.pos}>{s.position}</span>
              <span className={styles.name}>{s.name}</span>
              {s.kind !== 'OPEN' && (
                <NbBadge status={s.kind === 'WON' ? 'done' : 'blocker'}>
                  {s.kind === 'WON' ? '성사' : '실패'}
                </NbBadge>
              )}
              <span className={styles.count}>
                {s.dealCount > 0 ? `지금 ${s.dealCount}건` : '지금 비어 있음'}
              </span>
            </div>

            <div className={styles.grid}>
              {ALL_CRITERIA.map((key) => {
                const cur = levelOf(s, key)
                return (
                  <div key={key} className={styles.row}>
                    <span className={styles.label}>
                      {cur === 'block' && <Ban size={13} aria-hidden />}
                      {cur === 'warn' && <AlertTriangle size={13} aria-hidden />}
                      {CRITERION_LABEL[key]}
                    </span>
                    <div className={styles.levels}>
                      {LEVELS.map((l) => (
                        <button
                          key={l.value}
                          type="button"
                          className={cur === l.value ? styles.levelOn : styles.level}
                          onClick={() => void setLevel(s, key, l.value)}
                          disabled={!canEdit || busy === `${s.id}:${key}`}
                          aria-pressed={cur === l.value}
                          title={l.hint}
                        >
                          {l.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </li>
        ))}
      </ol>

      {!canEdit && (
        <p className={styles.readonly}>
          조건을 바꾸려면 관리자 권한이 필요합니다. 지금은 어떤 조건이 걸려 있는지만 보여 드려요.
        </p>
      )}

      <div className={styles.foot}>
        <NbButton variant="ghost" onClick={() => void load()}>새로고침</NbButton>
      </div>
    </>
  )
}
