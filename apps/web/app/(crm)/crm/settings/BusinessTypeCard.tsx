'use client'

// 사업 유형 — 무엇을 파는 일인가를 **우리가 정한다**
//
// **왜 이 카드가 생겼나**(사용자 지적 2026-09-08: 「사업유형 설정하는 곳이 없어」):
// 파이프라인·단계·거래 조건은 전부 설정에서 관리하는데 사업 유형만 코드에 박혀 있었다.
// 그래서 「유지보수」 사업이 들어와도 「기타」로 적을 수밖에 없었고,
// 「어떤 사업이 남는 장사였나」에 답할 수가 없었다.
//
// **지우기보다 숨김이 기본이다.** 예전 딜이 그 유형을 가리키고 있어서,
// 지우면 그 딜들의 유형이 조용히 「없음」이 된다. 그래서 쓰는 딜이 있으면 서버가 거절하고
// 화면은 그 사실을 딜 수로 먼저 보여 준다.

import { useCallback, useEffect, useState } from 'react'
import { ChevronDown, ChevronUp, Eye, EyeOff, Pencil, Plus, Trash2 } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import AXDotLoader from '@/components/ui/AXDotLoader'
import ErrorState from '@/components/ui/ErrorState'
import FormErrorBanner from '@/components/ui/FormErrorBanner'
import { ACTION, count, progress } from '@/lib/terms'
import { isEnterKey } from '@/lib/ui/ime'
import {
  BUSINESS_TYPE_LABEL_MAX,
  BUSINESS_TYPE_LABEL_ERROR_TEXT,
  validateBusinessTypeLabel,
  type BusinessTypeRow,
} from '@/lib/crm/domain/business-type'
import { invalidateBusinessTypes } from '@/lib/crm/ui/use-business-types'
import styles from './business-type-card.module.css'

/** 폼이 닫힘 / 추가 / 그 id 를 고치는 중 — 칸이 같으므로 폼은 한 벌이다(§2-5) */
type Editing = null | 'new' | string

export default function BusinessTypeCard() {
  const [items, setItems] = useState<BusinessTypeRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<Editing>(null)
  const [label, setLabel] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/crm/business-types')
      const body = await res.json()
      if (!res.ok) { setError(body?.error?.message ?? '사업 유형을 불러오지 못했습니다.'); return }
      const rows = (body.items ?? []) as BusinessTypeRow[]
      setItems(rows)
      // 딜 폼·표가 보는 캐시도 함께 갱신한다 — 안 그러면 방금 추가한 유형이 딜에서 안 보인다
      invalidateBusinessTypes(rows)
    } catch {
      setError('사업 유형을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const openForm = useCallback((row: BusinessTypeRow | null) => {
    setEditing(row ? row.id : 'new')
    setLabel(row ? row.label : '')
    setFormError(null)
  }, [])

  const closeForm = useCallback(() => {
    setEditing(null)
    setLabel('')
    setFormError(null)
  }, [])

  const save = useCallback(async () => {
    // 화면과 서버가 **같은 함수**로 판정한다 — 한쪽만 막으면 다른 쪽으로 들어온다
    const others = items
      .filter((r) => r.id !== (editing === 'new' ? null : editing))
      .map((r) => r.label)
    const bad = validateBusinessTypeLabel(label, others)
    if (bad) { setFormError(BUSINESS_TYPE_LABEL_ERROR_TEXT[bad]); return }

    setSaving(true)
    setFormError(null)
    try {
      const isEdit = editing !== null && editing !== 'new'
      const res = await fetch(
        isEdit ? `/api/crm/business-types/${editing}` : '/api/crm/business-types',
        {
          method: isEdit ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ label: label.trim() }),
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
  }, [closeForm, editing, items, label, load])

  const patch = useCallback(async (id: string, body: Record<string, unknown>) => {
    setBusyId(id)
    setError(null)
    try {
      const res = await fetch(`/api/crm/business-types/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const b = await res.json()
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
      const res = await fetch('/api/crm/business-types', {
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

  const remove = useCallback(async (row: BusinessTypeRow) => {
    setBusyId(row.id)
    setError(null)
    try {
      const res = await fetch(`/api/crm/business-types/${row.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const b = await res.json()
        // 서버가 「쓰는 딜이 N건 있어 지울 수 없다」고 말한다 — 그 말을 그대로 전한다
        setError(b?.error?.message ?? '삭제하지 못했습니다.')
        return
      }
      await load()
    } catch {
      setError('삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setBusyId(null)
    }
  }, [load])

  if (loading && items.length === 0) return <AXDotLoader />

  return (
    <div className={`card ${styles.card}`}>
      <div className={styles.head}>
        <h3 className={styles.title}>사업 유형</h3>
        <NbButton variant="ghost" onClick={() => openForm(null)}>
          <Plus size={14} /> {ACTION.create} 사업 유형
        </NbButton>
      </div>
      <p className={styles.desc}>
        딜을 만들 때 고르는 목록입니다. 유형마다 원가 구조도 계약 형태도 달라서,
        여기가 갈려 있으면 「어떤 사업이 남는 장사였나」를 나중에 따져 보기 어렵습니다.
        안 쓰는 유형은 <strong>숨김</strong>으로 바꾸세요. 이미 그 유형인 딜은 그대로 보입니다.
      </p>

      {error && <ErrorState message={error} onRetry={() => void load()} />}

      {editing !== null && (
        <div className={styles.form}>
          <FormErrorBanner message={formError} />
          <p className={styles.formTitle}>
            {editing === 'new' ? '새 사업 유형' : '사업 유형 이름 수정'}
          </p>
          <div className={styles.formRow}>
            <div className={styles.field}>
              <label className="label" htmlFor="biz-type-label">이름</label>
              <input
                id="biz-type-label" className="input-field" value={label}
                onChange={(e) => setLabel(e.target.value)}
                // 한글 조합 확정 Enter 는 «누른 Enter» 가 아니다 — SSOT 를 거친다(lib/ui/ime)
                onKeyDown={(e) => { if (isEnterKey(e) && !saving) void save() }}
                maxLength={BUSINESS_TYPE_LABEL_MAX}
                placeholder="예: 유지보수"
                autoFocus
              />
            </div>
          </div>
          <div className={styles.formFoot}>
            <NbButton variant="ghost" onClick={closeForm} disabled={saving}>{ACTION.cancel}</NbButton>
            <NbButton onClick={() => void save()} disabled={saving}>
              {saving ? progress(ACTION.save) : ACTION.save}
            </NbButton>
          </div>
        </div>
      )}

      <ul className={styles.list}>
        {items.map((row, i) => (
          <li key={row.id} className={`${styles.item} ${row.isActive ? '' : styles.hidden}`}>
            <span className={styles.order}>
              <button
                type="button" className={styles.arrow} disabled={i === 0}
                onClick={() => void move(i, -1)} aria-label={`${row.label} 위로`}
              ><ChevronUp size={14} /></button>
              <button
                type="button" className={styles.arrow} disabled={i === items.length - 1}
                onClick={() => void move(i, 1)} aria-label={`${row.label} 아래로`}
              ><ChevronDown size={14} /></button>
            </span>

            <span className={styles.name}>{row.label}</span>

            <span className={styles.tags}>
              {row.isBuiltin && <span className={styles.tag}>기본</span>}
              {!row.isActive && <span className={`${styles.tag} ${styles.tagOff}`}>숨김</span>}
              {/* 「지워도 되나」에 답하는 유일한 숫자 — R-5 */}
              <span className={styles.uses}>{count('deal', row.dealCount ?? 0)}</span>
            </span>

            <button
              type="button" className={styles.iconBtn} disabled={busyId === row.id}
              onClick={() => openForm(row)} aria-label={`${row.label} ${ACTION.edit}`}
            ><Pencil size={14} /></button>

            <button
              type="button" className={styles.iconBtn} disabled={busyId === row.id}
              onClick={() => void patch(row.id, { isActive: !row.isActive })}
              aria-label={`${row.label} ${row.isActive ? '숨기기' : '보이기'}`}
              title={row.isActive ? '숨기기' : '보이기'}
            >{row.isActive ? <Eye size={14} /> : <EyeOff size={14} />}</button>

            {/* 기본 8종에는 삭제를 아예 두지 않는다 — 누르면 거절될 버튼을 보여 주지 않는다 */}
            {row.isBuiltin ? <span className={styles.iconGap} /> : (
              <button
                type="button" className={`${styles.iconBtn} ${styles.danger}`}
                disabled={busyId === row.id}
                onClick={() => void remove(row)}
                aria-label={`${row.label} ${ACTION.delete}`}
              ><Trash2 size={14} /></button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
