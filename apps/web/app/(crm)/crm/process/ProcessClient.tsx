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
import { Workflow, Plus, Pencil, Trash2, Star, ChevronUp, ChevronDown } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import NbBadge from '@/components/ui/nb/NbBadge'
import AXDotLoader from '@/components/ui/AXDotLoader'
import EmptyState from '@/components/ui/EmptyState'
import ErrorState from '@/components/ui/ErrorState'
import FormErrorBanner from '@/components/ui/FormErrorBanner'
import SegmentedTabs from '@/components/ui/SegmentedTabs'
import { isEnterKey } from '@/lib/ui/ime'
import { eulReul, eunNeun, withJosa } from '@/lib/ui/josa'
import {
  CONFIGURABLE_CRITERIA, CRITERION_LABEL, MAX_MEANING_LEN,
  type CriterionKey, type CriterionLevel,
} from '@/lib/crm/domain/entry-criteria'
import { useAskDialog } from '@/components/ui/useAskDialog'
import { ACTION, count, createLabel } from '@/lib/terms'
import styles from './process.module.css'

interface Criterion { key: CriterionKey; level: CriterionLevel }
interface Stage {
  id: string; name: string; position: number; kind: string
  criteria: Criterion[]; meaning: string; dealCount: number
}
/** 조건을 세게 바꾸기 직전 — 무엇이 걸리는지 세어 보여 주고 나서 묻는다 */
interface Pending {
  stage: Stage; key: CriterionKey; level: CriterionLevel
  total: number; missing: number
}
interface Pipeline { id: string; name: string; isDefault: boolean; stages: Stage[] }

/**
 * 조건 수준 — **무슨 일이 일어나는지를 그대로 적는다.**
 *
 * 예전 라벨은 `안 봄 / 알려 줌 / 막음`이었다. 셋 다 주어가 없어서
 * "누가 무엇을 안 보는지"를 화면에서 알 수 없었다 — 그래서 관리자는 눌러 보고 나서야 알았다.
 */
const LEVELS: { value: 'off' | CriterionLevel; label: string }[] = [
  { value: 'off', label: '검사 안 함' },
  { value: 'warn', label: '비어 있으면 알려 주기' },
  { value: 'block', label: '비어 있으면 못 옮기게' },
]
const LEVEL_LABEL = Object.fromEntries(LEVELS.map((l) => [l.value, l.label])) as Record<string, string>

function levelOf(s: Stage, key: CriterionKey): 'off' | CriterionLevel {
  return s.criteria.find((c) => c.key === key)?.level ?? 'off'
}

/** 화면에 띄울 조건만 — 채울 칸이 없는 것은 켜면 그 단계가 영영 잠긴다(도메인 SSOT가 정한다) */
const EDITABLE = CONFIGURABLE_CRITERIA

/** 지금 걸려 있는 조건만, 화면 순서대로. 안 걸린 것은 요약에 넣지 않는다 */
function activeRules(s: Stage): Criterion[] {
  return EDITABLE.map((k) => s.criteria.find((c) => c.key === k)).filter((c): c is Criterion => !!c)
}

export default function ProcessClient({ canEdit }: { canEdit: boolean }) {
  // 브라우저 기본 대화상자 대신 우리 모달 — 묻는 자리가 일곱이라 한 벌로 쓴다
  const { ask, dialog } = useAskDialog()
  const [pipelines, setPipelines] = useState<Pipeline[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  /** 조건은 기본으로 접어 둔다 — 대부분의 단계는 조건이 없고, 펼쳐 두면 화면이 설정표가 된다 */
  const [openRules, setOpenRules] = useState<Set<string>>(new Set())
  /** 뜻은 타이핑 중 값을 들고 있다가 저장 때만 서버로 간다 */
  const [meaningDraft, setMeaningDraft] = useState<Record<string, string>>({})
  const [pending, setPending] = useState<Pending | null>(null)

  /** 지금 상한을 몇 자 넘었나 — 0이면 안 넘었다 */
  const over = (s: Stage) =>
    Math.max(0, (meaningDraft[s.id] ?? s.meaning).trim().length - MAX_MEANING_LEN)

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
    const name = await ask.text({
      title: '파이프라인 이름 바꾸기', label: '이름', defaultValue: p.name, confirmLabel: ACTION.save,
    })
    if (!name || name === p.name) return
    await send(`rn:${p.id}`, `/api/crm/pipelines/${p.id}`, json({ name }, 'PATCH'), '이름을 바꿨어요.')
  }

  /**
   * 삭제하기 전에 **무엇이 걸려 있는지 먼저 세어 보여 준다.**
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
        ? `"${p.name}"에 ${count('deal', total)}(진행 ${u.openDeals}건)이 있어요.\n\n먼저 옮기거나 닫아야 삭제할 수 있습니다.`
        : `단계 ${u?.stages ?? p.stages.length}개가 함께 사라집니다. 딜은 없습니다.`
      if (total > 0) {
        // 지울 수 없는 상태다 — «확인/취소»를 물으면 취소해도 되는 것처럼 읽힌다
        await ask.notice({ title: '아직 삭제할 수 없어요', body: msg })
        return
      }
      if (!await ask.confirm({
        title: `"${p.name}"${eulReul(p.name)} 삭제할까요?`, body: msg,
        confirmLabel: ACTION.delete, danger: true,
      })) return
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
    const name = await ask.text({
      title: createLabel('단계'), label: '단계 이름', placeholder: '예: 기술 검토',
      confirmLabel: ACTION.save,
    })
    if (!name) return
    await send('add-stage', '/api/crm/stages', json({ pipelineId, name }, 'POST'),
      `"${name}" 단계를 넣었어요.`)
  }

  async function renameStage(st: Stage) {
    const name = await ask.text({
      title: '단계 이름 바꾸기', label: '이름', defaultValue: st.name, confirmLabel: ACTION.save,
    })
    if (!name || name === st.name) return
    await send(`sn:${st.id}`, `/api/crm/stages/${st.id}`, json({ name }, 'PATCH'), '단계 이름을 바꿨어요.')
  }

  async function removeStage(st: Stage) {
    if (st.dealCount > 0) {
      await ask.notice({
        title: '아직 삭제할 수 없어요',
        body: `"${st.name}"에 ${count('deal', st.dealCount)}이 있어요.\n\n다른 단계로 옮긴 뒤에 삭제할 수 있습니다.`,
      })
      return
    }
    if (!await ask.confirm({
      title: `"${st.name}" 단계를 삭제할까요?`,
      confirmLabel: ACTION.delete, danger: true,
    })) return
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

  /** 단계의 뜻만 저장한다 — 조건은 그대로 실어 보낸다(한쪽만 저장되면 다른 쪽이 지워진다) */
  async function saveMeaning(stage: Stage) {
    const meaning = (meaningDraft[stage.id] ?? stage.meaning).trim()
    if (meaning === stage.meaning) return
    /**
     * 서버는 길면 자른다(120자). 화면 입력칸도 같은 수에서 막지만 그건 화면 사정이고,
     * 붙여넣기·API·자동완성으로 더 긴 글이 들어오는 길이 있다. **잘렸으면 말해 준다** —
     * 조용히 자르면 사용자는 자기가 적은 문장이 왜 뒤가 없는지 모른다.
     */
    const cut = meaning.length > MAX_MEANING_LEN
    const ok = await send(`mean:${stage.id}`, `/api/crm/stages/${stage.id}`,
      json({ criteria: stage.criteria, meaning }, 'PATCH'),
      !meaning
        ? `"${stage.name}"의 뜻을 지웠어요.`
        : cut
          ? `"${stage.name}"의 뜻을 적었어요. 너무 길어서 앞 ${MAX_MEANING_LEN}자만 남겼습니다.`
          : `"${stage.name}"의 뜻을 적었어요.`)
    if (ok) setMeaningDraft((d) => { const n = { ...d }; delete n[stage.id]; return n })
  }

  /**
   * 조건을 바꾼다.
   *
   * **끄는 것은 바로, 켜는 것은 세어 본 뒤에.** 끄면 아무도 막히지 않지만
   * 켜면 지금 서 있는 딜이 다음 이동에서 막힌다 — 그 수를 모르고 누르면 안 된다.
   */
  async function changeLevel(stage: Stage, key: CriterionKey, level: 'off' | CriterionLevel) {
    if (level === 'off') { await commitLevel(stage, key, 'off'); return }

    setBusy(`${stage.id}:${key}`)
    setError(null)
    try {
      const res = await fetch(`/api/crm/stages/${stage.id}?criterion=${key}`)
      const body = await res.json().catch(() => null)
      const im = body?.data?.impact ?? body?.impact
      // 세지 못했으면 조용히 넘어가지 않는다 — 근거 없이 켜는 것이 애초에 문제였다
      if (!im) { setError('지금 걸릴 딜이 몇 건인지 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.'); return }
      setPending({ stage, key, level, total: im.total, missing: im.missing })
    } catch {
      setError('지금 걸릴 딜이 몇 건인지 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setBusy(null)
    }
  }

  async function commitLevel(stage: Stage, key: CriterionKey, level: 'off' | CriterionLevel) {
    const next = stage.criteria.filter((c) => c.key !== key)
    if (level !== 'off') next.push({ key, level })
    setPending(null)
    await send(`${stage.id}:${key}`, `/api/crm/stages/${stage.id}`,
      json({ criteria: next, meaning: stage.meaning }, 'PATCH'),
      level === 'off'
        ? `"${stage.name}"에서 ${CRITERION_LABEL[key]}${eunNeun(CRITERION_LABEL[key])} 이제 검사하지 않아요.`
        : `"${stage.name}" — ${CRITERION_LABEL[key]}: ${LEVEL_LABEL[level]}.`)
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
              disabled={busy === `del:${active.id}`} aria-label={ACTION.delete} title={ACTION.delete}>
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
        각 단계에 <strong>이 단계에 왔다는 게 무슨 뜻인지</strong> 한 줄로 적어 두면 팀이 같은 기준으로 딜을 옮깁니다.
        그 문장은 검사하지 않고 보여만 줍니다 — 기계가 판정할 수 있는 것만 조건으로 겁니다.
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
                      disabled={busy === `sd:${s.id}`} aria-label={ACTION.delete} title={ACTION.delete}>
                      <Trash2 size={14} />
                    </button>
                  )}
                </span>
              )}
            </div>

            {/* ① 이 단계의 뜻 — 사람이 읽는 한 줄. 기계는 검사하지 않는다. */}
            {canEdit ? (
              <label className={styles.meaning}>
                <span className="label">이 단계에 왔다는 건</span>
                <input
                  className="input-field"
                  value={meaningDraft[s.id] ?? s.meaning}
                  /**
                   * `maxLength` 를 걸지 않는다.
                   *
                   * 상한에서 타자를 **소리 없이 삼키는** 것도 조용한 절단이다 —
                   * 사용자는 키보드가 고장 난 줄 안다. 대신 넘어서면 남은 수를 세어 주고,
                   * 저장할 때 앞 120자만 남겼다고 말한다(saveMeaning).
                   */
                  placeholder="예: 고객이 예산을 확인해 줬다"
                  onChange={(e) => setMeaningDraft((d) => ({ ...d, [s.id]: e.target.value }))}
                  onBlur={() => void saveMeaning(s)}
                  onKeyDown={(e) => { if (isEnterKey(e)) e.currentTarget.blur() }}
                  disabled={busy === `mean:${s.id}`}
                />
                {over(s) > 0 && (
                  <span className={styles.meaningOver}>
                    {over(s)}자 넘었어요 — 저장하면 앞 {MAX_MEANING_LEN}자만 남습니다
                  </span>
                )}
              </label>
            ) : s.meaning ? (
              <p className={styles.meaningRead}>{s.meaning}</p>
            ) : null}

            {/* ② 조건 — 걸린 것만 한 줄로. 대부분의 단계는 여기서 끝난다. */}
            <div className={styles.rules}>
              <span className={styles.rulesSummary}>
                {activeRules(s).length === 0
                  ? '조건 없음 — 언제든 옮길 수 있어요'
                  // 막는 것은 blocker, 알려만 주는 것은 note — 색이 세기를 그대로 말한다
                  : activeRules(s).map((c) => (
                    <NbBadge key={c.key} status={c.level === 'block' ? 'blocker' : 'note'}>
                      {CRITERION_LABEL[c.key]} · {LEVEL_LABEL[c.level]}
                    </NbBadge>
                  ))}
              </span>
              {canEdit && (
                <button type="button" className={styles.rulesToggle}
                  aria-expanded={openRules.has(s.id)}
                  onClick={() => setOpenRules((o) => {
                    const n = new Set(o)
                    if (n.has(s.id)) n.delete(s.id); else n.add(s.id)
                    return n
                  })}>
                  {openRules.has(s.id) ? '조건 접기' : '조건 정하기'}
                </button>
              )}
            </div>

            {canEdit && openRules.has(s.id) && (
              <div className={styles.ruleEdit}>
                {EDITABLE.map((key) => (
                  <label key={key} className={styles.ruleRow}>
                    <span className={styles.ruleName}>{CRITERION_LABEL[key]}</span>
                    <select
                      className="input-field"
                      /**
                       * label 로 감쌌는데도 이름을 따로 준다.
                       * 감싼 label 의 접근 이름 계산에 select 의 **선택된 값**이 섞여 들어가서,
                       * 스크린리더로 5개가 전부 "검사 안 함"으로 읽혔다(G3 실측).
                       * 어느 조건인지 모르면 이 화면은 소리로 쓸 수 없다.
                       */
                      aria-label={CRITERION_LABEL[key]}
                      value={levelOf(s, key)}
                      disabled={busy === `${s.id}:${key}`}
                      onChange={(e) => void changeLevel(s, key, e.target.value as 'off' | CriterionLevel)}
                    >
                      {LEVELS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
                    </select>
                  </label>
                ))}

                {/* ③ 켜기 전 확인 — 무엇이 걸리는지 세어 보여 주고 나서 묻는다 */}
                {pending?.stage.id === s.id && (
                  <div className={styles.preview} role="status">
                    <p className={styles.previewLine}>
                      {pending.total === 0
                        ? `지금 "${s.name}"에 딜이 없어요. 앞으로 옮겨 오는 딜부터 적용됩니다.`
                        : pending.missing === 0
                          ? `지금 여기 있는 ${pending.total}건은 ${withJosa(CRITERION_LABEL[pending.key], eulReul)} 모두 채웠어요.`
                          : `지금 여기 있는 ${pending.total}건 중 ${pending.missing}건이 ` +
                            `${withJosa(CRITERION_LABEL[pending.key], eulReul)} 안 채웠어요.` +
                            (pending.level === 'block'
                              ? ' 켜면 그 딜들은 다음에 옮길 때 막힙니다.'
                              : ' 옮기는 건 되지만 무엇이 비었는지 알려 줍니다.')}
                    </p>
                    <div className={styles.previewActions}>
                      <NbButton onClick={() => void commitLevel(pending.stage, pending.key, pending.level)}
                        disabled={busy === `${s.id}:${pending.key}`}>
                        {LEVEL_LABEL[pending.level]}로 켜기
                      </NbButton>
                      <NbButton variant="ghost" onClick={() => setPending(null)}>그대로 두기</NbButton>
                    </div>
                  </div>
                )}
              </div>
            )}
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

      {/* 대화상자는 마지막에 — 렌더하지 않으면 물어도 안 뜬다 */}
      {dialog}
    </>
  )
}
