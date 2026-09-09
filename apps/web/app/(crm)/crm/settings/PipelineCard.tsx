'use client'

// 파이프라인 — 「이 딜은 어떤 흐름을 타는가」를 **우리가 정한다**
//
// **왜 이 카드가 생겼나**(사용자 지적 2026-09-09: 「사업유형은 있는데 왜 저거는 없는거지?」):
// 딜을 만들 때 고르는 목록은 둘인데 — 파이프라인과 사업 유형 — 설정 카드는 사업 유형에만
// 있었다. 파이프라인 관리는 「영업 단계」 화면에 얹혀 있었고, 그래서 그 화면에 탭이 두 줄이
// 됐고, 「+ 새 영업 단계」(흐름)와 「+ 단계 추가」(칸)가 한 화면에 나란히 서게 됐다.
//
// 정작 딜 화면은 이미 **「설정에서 파이프라인을 만들면 여기에 단계가 나타납니다」**라고
// 안내하고 있었다(DealBoard.tsx:250 · DealsClient.tsx:138). 원래 설계가 이것이었고
// 카드만 안 만들어져 있었다.
//
// **지우기보다 접기가 기본이다.** 실측(2026-09-09) 파이프라인 7개 중 5개가 딜 0건인데,
// 나중에 쓸지 몰라 못 지우고 계속 자리를 먹었다. 접으면 새 딜에서만 안 보이고
// 이미 붙은 딜은 그대로 산다.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, Eye, EyeOff, Pencil, Plus, Star, Trash2 } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import AXDotLoader from '@/components/ui/AXDotLoader'
import ErrorState from '@/components/ui/ErrorState'
import FormErrorBanner from '@/components/ui/FormErrorBanner'
import { ACTION, count, progress } from '@/lib/terms'
import { useAskDialog } from '@/components/ui/useAskDialog'
import { eulReul } from '@/lib/ui/josa'
import { isEnterKey } from '@/lib/ui/ime'
import {
  PIPELINE_LABEL_MAX,
  PIPELINE_LABEL_ERROR_TEXT,
  validatePipelineName,
  duplicateStageGroups,
  duplicateStageNote,
} from '@/lib/crm/domain/pipeline'
import { clearCachedPipelines } from '@/lib/crm/ui/pipeline-cache'
import styles from './pipeline-card.module.css'

interface StageLite { id: string; name: string; kind: string; position: number; dealCount: number }
interface PipelineRow {
  id: string
  name: string
  isDefault: boolean
  isActive: boolean
  position: number
  stages: StageLite[]
}

/** 폼이 닫힘 / 추가 / 그 id 를 고치는 중 — 칸이 같으므로 폼은 한 벌이다(§2-5) */
type Editing = null | 'new' | string

/** 이 파이프라인에 걸린 딜 수 — 「지워도 되나」에 답하는 유일한 숫자(R-5) */
function dealsOf(p: PipelineRow): number {
  return p.stages.reduce((sum, s) => sum + (s.dealCount ?? 0), 0)
}

export default function PipelineCard({ canEdit }: { canEdit: boolean }) {
  const [items, setItems] = useState<PipelineRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<Editing>(null)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const { ask, dialog } = useAskDialog()

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/crm/pipelines')
      const body = await res.json()
      if (!res.ok) { setError(body?.error?.message ?? '파이프라인을 불러오지 못했습니다.'); return }
      setItems((body.items ?? []) as PipelineRow[])
      /*
        딜 보드가 들고 있는 파이프라인 캐시를 버린다(§pipeline-cache).
        안 지우면 여기서 접어 놓고 딜 화면에 가면 접힌 파이프라인이 그대로 보인다.
      */
      clearCachedPipelines()
    } catch {
      setError('파이프라인을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  /**
   * 단계 구성이 같은 파이프라인끼리 묶는다.
   *
   * **권하지 않고 알리기만 한다.** 사업이 갈라질 계획이 있어 미리 만들어 둔 것일 수 있고,
   * 그건 화면이 알 수 없는 사실이다. 지우라고 하지도, 자동으로 접지도 않는다.
   */
  const dupes = useMemo(() => duplicateStageGroups(items), [items])

  const openForm = useCallback((row: PipelineRow | null) => {
    setEditing(row ? row.id : 'new')
    setName(row ? row.name : '')
    setFormError(null)
  }, [])

  const closeForm = useCallback(() => {
    setEditing(null)
    setName('')
    setFormError(null)
  }, [])

  const save = useCallback(async () => {
    // 화면과 서버가 **같은 함수**로 판정한다 — 한쪽만 막으면 다른 쪽으로 들어온다
    const others = items
      .filter((r) => r.id !== (editing === 'new' ? null : editing))
      .map((r) => r.name)
    const bad = validatePipelineName(name, others)
    if (bad) { setFormError(PIPELINE_LABEL_ERROR_TEXT[bad]); return }

    setSaving(true)
    setFormError(null)
    try {
      const isEdit = editing !== null && editing !== 'new'
      const res = await fetch(
        isEdit ? `/api/crm/pipelines/${editing}` : '/api/crm/pipelines',
        {
          method: isEdit ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name.trim() }),
        },
      )
      const body = await res.json()
      if (!res.ok) { setFormError(body?.error?.message ?? '저장하지 못했습니다.'); return }
      closeForm()
      await load()
    } catch {
      setFormError('저장하지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setSaving(false)
    }
  }, [closeForm, editing, items, name, load])

  const patch = useCallback(async (id: string, body: Record<string, unknown>) => {
    setBusyId(id)
    setError(null)
    try {
      const res = await fetch(`/api/crm/pipelines/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const b = await res.json()
        // 서버가 「기본 파이프라인은 접을 수 없다」고 말한다 — 그 말을 그대로 전한다
        setError(b?.error?.message ?? '바꾸지 못했습니다.')
        return
      }
      await load()
    } catch {
      setError('바꾸지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setBusyId(null)
    }
  }, [load])

  /** 순서 바꾸기 — 목록 전체를 한 번에 보낸다. 하나씩 보내면 중간 상태에서 순서가 뒤집힌다 */
  const move = useCallback(async (index: number, dir: -1 | 1) => {
    const next = [...items]
    const to = index + dir
    if (to < 0 || to >= next.length) return
    const [moved] = next.splice(index, 1)
    next.splice(to, 0, moved)
    setItems(next)   // 먼저 보여 준다 — 왕복을 기다리면 화살표가 굼떠 보인다
    try {
      const res = await fetch('/api/crm/pipelines', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: next.map((r) => r.id) }),
      })
      if (!res.ok) {
        const b = await res.json()
        setError(b?.error?.message ?? '순서를 바꾸지 못했습니다.')
      }
    } catch {
      setError('순서를 바꾸지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      await load()   // 서버가 진실이다 — 실패했으면 원래 순서로 돌아온다
    }
  }, [items, load])

  /**
   * 지우기 — **먼저 세고, 그다음 묻는다**(§R-5).
   *
   * 사업 유형 카드는 그냥 DELETE 를 보내고 서버가 거절하면 그 말을 전한다. 파이프라인은
   * 다르다: 사업 유형은 **라벨 하나**지만 파이프라인은 **단계를 거느린다**. 딜이 0건이어도
   * 지우면 그 흐름의 단계가 통째로 사라지고 되돌릴 길이 없다. 그래서 무엇이 함께 사라지는지
   * 먼저 보여 준다.
   *
   * 딜이 있으면 **「확인/취소」를 묻지 않는다** — 어차피 서버가 거절하므로, 물으면
   * 「확인」을 누르면 지워지는 것처럼 읽힌다. 그때는 알림만 띄우고 무엇을 먼저 해야 하는지 말한다.
   */
  const remove = useCallback(async (row: PipelineRow) => {
    setBusyId(row.id)
    setError(null)
    try {
      const info = await fetch(`/api/crm/pipelines/${row.id}`)
      const body = await info.json().catch(() => null)
      const u = body?.data?.usage ?? body?.usage
      const total = (u?.openDeals ?? 0) + (u?.closedDeals ?? 0)

      if (total > 0) {
        await ask.notice({
          title: '아직 삭제할 수 없어요',
          body: `「${row.name}」에 ${count('deal', total)}(진행 ${u.openDeals}건)이 있어요.\n\n`
            + '먼저 다른 파이프라인으로 옮기거나 닫아야 삭제할 수 있습니다.\n'
            + '지금 안 쓰는 것뿐이라면 삭제 대신 **접기**를 쓰세요. 딜은 그대로 남습니다.',
        })
        return
      }

      const stageCount = u?.stages ?? row.stages.length
      if (!await ask.confirm({
        title: `「${row.name}」${eulReul(row.name)} 삭제할까요?`,
        body: `단계 ${stageCount}개가 함께 사라집니다. 걸린 딜은 없습니다.\n`
          + '되돌릴 수 없어요.',
        confirmLabel: ACTION.delete,
        danger: true,
      })) return

      const res = await fetch(`/api/crm/pipelines/${row.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const b = await res.json()
        // 서버가 「딜 N건이 여기 있다」고 말한다 — 그 말을 그대로 전한다
        setError(b?.error?.message ?? '삭제하지 못했습니다.')
        return
      }
      await load()
    } catch {
      setError('삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setBusyId(null)
    }
  }, [load, ask])

  if (loading && items.length === 0) return <AXDotLoader />

  return (
    <div className={`card ${styles.card}`}>
      {dialog}
      <div className={styles.head}>
        <h3 className={styles.title}>파이프라인</h3>
        {canEdit && (
          <NbButton variant="ghost" onClick={() => openForm(null)}>
            <Plus size={14} /> {ACTION.create} 파이프라인
          </NbButton>
        )}
      </div>
      <p className={styles.desc}>
        딜을 만들 때 가장 먼저 고르는 목록입니다. 파이프라인마다 <strong>영업 단계가 다릅니다</strong>.
        공공은 「입찰 → 낙찰」이고 GPU 인프라는 「기술검증 → 계약 협상」입니다.
        단계 순서를 고치는 곳은 <strong>영업 단계</strong> 화면입니다.
        안 쓰는 파이프라인은 <strong>접어 두세요</strong>. 이미 그 흐름을 타는 딜은 그대로 보입니다.
      </p>

      {error && <ErrorState message={error} onRetry={() => void load()} />}

      {editing !== null && (
        <div className={styles.form}>
          <FormErrorBanner message={formError} />
          <p className={styles.formTitle}>
            {editing === 'new' ? '새 파이프라인' : '파이프라인 이름 수정'}
          </p>
          <div className={styles.formRow}>
            <div className={styles.field}>
              <label className="label" htmlFor="pipeline-name">이름</label>
              <input
                id="pipeline-name" className="input-field" value={name}
                onChange={(e) => setName(e.target.value)}
                // 한글 조합 확정 Enter 는 «누른 Enter» 가 아니다 — SSOT 를 거친다(lib/ui/ime)
                onKeyDown={(e) => { if (isEnterKey(e) && !saving) void save() }}
                maxLength={PIPELINE_LABEL_MAX}
                placeholder="예: 파트너 영업"
                autoFocus
              />
            </div>
          </div>
          {editing === 'new' && (
            <p className={styles.hint}>
              흔한 영업 흐름(리드 → 상담 → 제안 → 협상 → 성사/실패)으로 시작합니다.
              단계는 만든 뒤 영업 단계 화면에서 고칠 수 있어요.
            </p>
          )}
          <div className={styles.formFoot}>
            <NbButton variant="ghost" onClick={closeForm} disabled={saving}>{ACTION.cancel}</NbButton>
            <NbButton onClick={() => void save()} disabled={saving}>
              {saving ? progress(ACTION.save) : ACTION.save}
            </NbButton>
          </div>
        </div>
      )}

      <ul className={styles.list}>
        {items.map((row, i) => {
          const note = duplicateStageNote(dupes.get(row.id) ?? [])
          const deals = dealsOf(row)
          return (
            <li key={row.id} className={`${styles.item} ${row.isActive ? '' : styles.hidden}`}>
              {canEdit ? (
                <span className={styles.order}>
                  <button
                    type="button" className={styles.arrow} disabled={i === 0}
                    onClick={() => void move(i, -1)} aria-label={`${row.name} 위로`}
                  ><ChevronUp size={14} /></button>
                  <button
                    type="button" className={styles.arrow} disabled={i === items.length - 1}
                    onClick={() => void move(i, 1)} aria-label={`${row.name} 아래로`}
                  ><ChevronDown size={14} /></button>
                </span>
              ) : <span className={styles.orderGap} />}

              {/*
                이름과 배지는 **한 덩어리**다. 격자 열로 나란히 두면 서로 폭을 다투다가
                긴 배지(「단계 구성 같음」)가 이름 칸을 0 까지 밀어붙여 「솔루션」이
                「솔 / 루 / 션」으로 세로로 쌓인다(실측 /crm/settings 2026-09-09).
                묶어 두면 좁을 때 **배지가 아랫줄로 내려가고 이름은 한 줄로 남는다.**
              */}
              <span className={styles.label}>
                <span className={styles.name}>{row.name}</span>
                {row.isDefault && <span className={styles.tag}>기본</span>}
                {!row.isActive && <span className={`${styles.tag} ${styles.tagOff}`}>접힘</span>}
                {/* 알리기만 한다 — 지우라고 하지도, 자동으로 접지도 않는다 */}
                {note && <span className={`${styles.tag} ${styles.tagDupe}`} title={note}>단계 구성 같음</span>}
                <span className={styles.uses}>{count('deal', deals)}</span>
              </span>

              {canEdit ? (
                <>
                  <button
                    type="button" className={styles.iconBtn} disabled={busyId === row.id}
                    onClick={() => openForm(row)} aria-label={`${row.name} ${ACTION.edit}`}
                    title={ACTION.edit}
                  ><Pencil size={14} /></button>

                  {/* 이미 기본이면 누를 이유가 없다 — 자리만 비워 열을 맞춘다 */}
                  {row.isDefault ? <span className={styles.iconGap} /> : (
                    <button
                      type="button" className={styles.iconBtn} disabled={busyId === row.id}
                      onClick={() => void patch(row.id, { isDefault: true })}
                      aria-label={`${row.name} 기본으로 지정`}
                      title="새 딜이 여기서 시작하게"
                    ><Star size={14} /></button>
                  )}

                  <button
                    type="button" className={styles.iconBtn} disabled={busyId === row.id}
                    onClick={() => void patch(row.id, { isActive: !row.isActive })}
                    aria-label={`${row.name} ${row.isActive ? '접기' : '펴기'}`}
                    title={row.isActive ? '접기: 새 딜에서 안 보이게' : '펴기'}
                  >{row.isActive ? <Eye size={14} /> : <EyeOff size={14} />}</button>

                  <button
                    type="button" className={`${styles.iconBtn} ${styles.danger}`}
                    disabled={busyId === row.id}
                    onClick={() => void remove(row)}
                    aria-label={`${row.name} ${ACTION.delete}`}
                    title={ACTION.delete}
                  ><Trash2 size={14} /></button>
                </>
              ) : (
                <>
                  <span className={styles.iconGap} />
                  <span className={styles.iconGap} />
                  <span className={styles.iconGap} />
                  <span className={styles.iconGap} />
                </>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
