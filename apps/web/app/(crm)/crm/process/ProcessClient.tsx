'use client'

// 영업 단계 — 파이프라인·단계·진입 조건 (dacrm 통합기획서 Phase 1-6)
//
// **이 화면이 답하는 것**: "우리 영업은 어떤 단계로 흐르나, 각 단계에 오려면 무엇이 정해져 있어야 하나."
//
// **왜 편집이 뒤늦게 붙었나**: 예전엔 진입 조건만 바꿀 수 있었다. 파이프라인 자체는
// 시드로 박힌 4개(KDC 제품·공공·파트너십 포함)가 전부였고 **지울 방법이 없었다** —
// 사업과 안 맞는 이름이 딜 화면 탭과 리포트를 차지하는데 개발자를 불러야 했다.
// 통상의 CRM 은 이게 최소 조건이다(Pipedrive 는 설정 안에서 전부 한다).
//
// 예전엔 이 화면이 "아직 편집할 프로세스가 없어요"만 띄웠다. 파이프라인 4종과
// 단계 25개가 이미 DB 에 있는데도 그랬다 — 화면이 아무것도 읽지 않았기 때문이다.
//
// 여기서 켠 조건은 **딜을 옮길 때 실제로 검사된다**. 설정만 있고 아무 일도 안 일어나면
// 그건 기능이 아니라 화면이다.

import { useCallback, useEffect, useState } from 'react'
import { Workflow, AlertTriangle, Ban, Plus, Pencil, Trash2, Star, ChevronUp, ChevronDown } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import NbBadge from '@/components/ui/nb/NbBadge'
import AXDotLoader from '@/components/ui/AXDotLoader'
import EmptyState from '@/components/ui/EmptyState'
import ErrorState from '@/components/ui/ErrorState'
import FormErrorBanner from '@/components/ui/FormErrorBanner'
import SegmentedTabs from '@/components/ui/SegmentedTabs'
import { isEnterKey } from '@/lib/ui/ime'
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
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')

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

  /**
   * 편집 요청 하나를 보낸다.
   *
   * 실패하면 **왜 안 되는지 서버가 준 말을 그대로** 보여 준다 —
   * "딜 3건이 여기 있어요" 같은 문장이라야 사람이 다음에 뭘 할지 안다.
   */
  async function send(key: string, url: string, init: RequestInit, okMsg: string) {
    setBusy(key)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch(url, init)
      const body = await res.json().catch(() => null)
      if (!res.ok) { setError(body?.error?.message ?? '바꾸지 못했습니다.'); return false }
      setNotice(okMsg)
      await load()
      return true
    } catch {
      setError('바꾸지 못했습니다. 잠시 후 다시 시도해 주세요.')
      return false
    } finally {
      setBusy(null)
    }
  }

  const json = (body: unknown, method: string): RequestInit => ({
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })

  async function addPipeline() {
    const name = newName.trim()
    if (!name) { setError('이름을 입력해 주세요.'); return }
    const ok = await send('new-pipeline', '/api/crm/pipelines', json({ name }, 'POST'),
      `"${name}"을(를) 만들었어요. 단계를 우리 방식에 맞게 고쳐 보세요.`)
    if (ok) { setNewName(''); setAdding(false) }
  }

  async function renamePipeline(p: Pipeline) {
    const name = window.prompt('영업 단계 이름', p.name)?.trim()
    if (!name || name === p.name) return
    await send(`rn:${p.id}`, `/api/crm/pipelines/${p.id}`, json({ name }, 'PATCH'), '이름을 바꿨어요.')
  }

  /**
   * 지우기 전에 **무엇이 걸려 있는지 먼저 세어 보여 준다.**
   * 개수를 모른 채 "정말 지울까요?"만 물으면 사람은 확인할 방법이 없다.
   */
  async function removePipeline(p: Pipeline) {
    setBusy(`del:${p.id}`)
    try {
      const res = await fetch(`/api/crm/pipelines/${p.id}`)
      const body = await res.json().catch(() => null)
      const u = body?.data?.usage ?? body?.usage
      const total = (u?.openDeals ?? 0) + (u?.closedDeals ?? 0)
      const msg = total > 0
        ? `"${p.name}"에 딜 ${total}건(진행 ${u.openDeals}건)이 있어요.\n\n먼저 옮기거나 닫아야 지울 수 있습니다.`
        : `"${p.name}"을(를) 지울까요?\n단계 ${u?.stages ?? p.stages.length}개가 함께 사라집니다. 딜은 없습니다.`
      if (total > 0) { window.alert(msg); return }
      if (!window.confirm(msg)) return
    } finally {
      setBusy(null)
    }
    await send(`del:${p.id}`, `/api/crm/pipelines/${p.id}`, { method: 'DELETE' }, `"${p.name}"을(를) 지웠어요.`)
  }

  async function makeDefault(p: Pipeline) {
    await send(`def:${p.id}`, `/api/crm/pipelines/${p.id}`, json({ isDefault: true }, 'PATCH'),
      `새 딜은 이제 "${p.name}"에서 시작해요.`)
  }

  async function addStage(pipelineId: string) {
    const name = window.prompt('새 단계 이름 (예: 기술 검토)')?.trim()
    if (!name) return
    await send('add-stage', '/api/crm/stages', json({ pipelineId, name }, 'POST'),
      `"${name}" 단계를 넣었어요.`)
  }

  async function renameStage(st: Stage) {
    const name = window.prompt('단계 이름', st.name)?.trim()
    if (!name || name === st.name) return
    await send(`sn:${st.id}`, `/api/crm/stages/${st.id}`, json({ name }, 'PATCH'), '단계 이름을 바꿨어요.')
  }

  async function removeStage(st: Stage) {
    if (st.dealCount > 0) {
      window.alert(`"${st.name}"에 딜 ${st.dealCount}건이 있어요.\n\n다른 단계로 옮긴 뒤에 지울 수 있습니다.`)
      return
    }
    if (!window.confirm(`"${st.name}" 단계를 지울까요?`)) return
    await send(`sd:${st.id}`, `/api/crm/stages/${st.id}`, { method: 'DELETE' }, `"${st.name}" 단계를 지웠어요.`)
  }

  /** 위·아래로 한 칸 — 끌어다 놓기보다 정확하고, 키보드로도 된다 */
  async function moveStage(pipeline: Pipeline, st: Stage, delta: -1 | 1) {
    const opens = pipeline.stages.filter((x) => x.kind === 'OPEN')
    const i = opens.findIndex((x) => x.id === st.id)
    const j = i + delta
    if (i < 0 || j < 0 || j >= opens.length) return

    const next = [...opens]
    ;[next[i], next[j]] = [next[j], next[i]]
    const orderedIds = [
      ...next.map((x) => x.id),
      ...pipeline.stages.filter((x) => x.kind !== 'OPEN').map((x) => x.id),
    ]
    await send(`mv:${st.id}`, '/api/crm/stages', json({ pipelineId: pipeline.id, orderedIds }, 'PUT'),
      '순서를 바꿨어요.')
  }

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
        title="아직 영업 단계가 없어요"
        description="우리 영업이 어떤 순서로 흐르는지 정하면, 딜을 그 순서대로 관리할 수 있습니다."
        icon={<Workflow size={28} />}
        action={canEdit ? { label: '영업 단계 만들기', onClick: () => setAdding(true) } : undefined}
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
          tabs={pipelines.map((p) => ({
            // 기본 파이프라인은 별로 표시한다 — 새 딜이 어디서 시작하는지 알아야 한다
            id: p.id, label: p.isDefault ? `★ ${p.name}` : p.name,
          }))}
          ariaLabel="영업 단계"
          activeId={active.id}
          onSelect={setActiveId}
        />

        {canEdit && (
          <div className={styles.pipeActions}>
            <NbButton variant="ghost" onClick={() => void renamePipeline(active)}
              disabled={busy === `rn:${active.id}`} aria-label="이름 바꾸기" title="이름 바꾸기">
              <Pencil size={14} />
            </NbButton>
            {!active.isDefault && (
              <NbButton variant="ghost" onClick={() => void makeDefault(active)}
                disabled={busy === `def:${active.id}`} title="새 딜이 여기서 시작하게">
                <Star size={14} /> 기본으로
              </NbButton>
            )}
            <NbButton variant="ghost" onClick={() => void removePipeline(active)}
              disabled={busy === `del:${active.id}`} aria-label="지우기" title="지우기">
              <Trash2 size={14} />
            </NbButton>
            <NbButton variant="ghost" onClick={() => setAdding((v) => !v)}>
              <Plus size={14} /> 새 영업 단계
            </NbButton>
          </div>
        )}
      </div>

      {adding && (
        <div className={styles.addRow}>
          <input
            className="input-field"
            value={newName}
            autoFocus
            placeholder="예: 파트너 영업 · 신규 사업"
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (isEnterKey(e)) void addPipeline() }}
            aria-label="새 영업 단계 이름"
          />
          <NbButton onClick={() => void addPipeline()} disabled={busy === 'new-pipeline'}>만들기</NbButton>
          <NbButton variant="ghost" onClick={() => { setAdding(false); setNewName('') }}>취소</NbButton>
        </div>
      )}

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

              {/* 액션은 행 클릭과 섞이지 않게 오른쪽 끝에 모은다 */}
              {canEdit && (
                <span className={styles.stageActions}>
                  {s.kind === 'OPEN' && (
                    <>
                      <button type="button" className={styles.iconBtn}
                        onClick={() => void moveStage(active, s, -1)}
                        disabled={busy === `mv:${s.id}`} aria-label="위로" title="위로">
                        <ChevronUp size={14} />
                      </button>
                      <button type="button" className={styles.iconBtn}
                        onClick={() => void moveStage(active, s, 1)}
                        disabled={busy === `mv:${s.id}`} aria-label="아래로" title="아래로">
                        <ChevronDown size={14} />
                      </button>
                    </>
                  )}
                  <button type="button" className={styles.iconBtn}
                    onClick={() => void renameStage(s)}
                    disabled={busy === `sn:${s.id}`} aria-label="이름 바꾸기" title="이름 바꾸기">
                    <Pencil size={14} />
                  </button>
                  {/* 성사·실패는 지울 수 없다 — 딜을 닫을 곳이 없어진다 */}
                  {s.kind === 'OPEN' && (
                    <button type="button" className={styles.iconBtn}
                      onClick={() => void removeStage(s)}
                      disabled={busy === `sd:${s.id}`} aria-label="지우기" title="지우기">
                      <Trash2 size={14} />
                    </button>
                  )}
                </span>
              )}
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

      {canEdit && (
        <div className={styles.foot}>
          <NbButton variant="ghost" onClick={() => void addStage(active.id)} disabled={busy === 'add-stage'}>
            <Plus size={14} /> 단계 추가
          </NbButton>
        </div>
      )}

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
