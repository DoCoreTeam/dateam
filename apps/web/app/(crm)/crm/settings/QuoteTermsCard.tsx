'use client'

// 거래 조건 — 사업 스타일마다 다른 것을 **하나씩** 등록한다
//
// **왜 설정의 한 칸이 아닌가**: 통째로 적어 두면 모든 견적서에 똑같이 나간다.
// GPU 사업 조건(이용 기간 변경 시 금액 변동)과 SI 사업 조건(검수 후 30일)은 다른데,
// 한 칸이면 둘을 다 적어 두고 고객이 자기와 무관한 줄까지 읽게 된다
// (사용자 지적: 「기본거래조건이 하나씩 항목으로 적용되고 실제 견적서에는 선택하는 방식이어야
//  할것 같아 … 우리 사업 스타일별로 이 내용이 다 다르거든」).
//
// 여기서 등록하고, 영업이 견적마다 고른다(QuoteEditorModal).

import { useCallback, useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import AXDotLoader from '@/components/ui/AXDotLoader'
import EmptyState from '@/components/ui/EmptyState'
import ErrorState from '@/components/ui/ErrorState'
import FormErrorBanner from '@/components/ui/FormErrorBanner'
import { ACTION, progress } from '@/lib/terms'
import { BUSINESS_TYPE_LABEL, BUSINESS_TYPE_ORDER, type BusinessTypeKey } from '@/lib/terms/ledger'
import styles from './quote-terms-card.module.css'

interface Term {
  id: string
  title: string
  body: string
  businessType: string | null
  isDefault: boolean
  position: number
  isActive: boolean
}

const EMPTY = { title: '', body: '', businessType: '', isDefault: false }

export default function QuoteTermsCard() {
  const [items, setItems] = useState<Term[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState({ ...EMPTY })
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/crm/quote-terms')
      const body = await res.json()
      if (!res.ok) { setError(body?.error?.message ?? '거래 조건을 불러오지 못했습니다.'); return }
      setItems(body.items ?? [])
    } catch {
      setError('거래 조건을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const save = useCallback(async () => {
    if (!draft.body.trim()) { setFormError('조건 내용을 입력해 주세요.'); return }
    setSaving(true)
    setFormError(null)
    try {
      const res = await fetch('/api/crm/quote-terms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: draft.title.trim() || draft.body.trim().slice(0, 20),
          body: draft.body.trim(),
          businessType: draft.businessType || null,
          isDefault: draft.isDefault,
        }),
      })
      const body = await res.json()
      if (!res.ok) { setFormError(body?.error?.message ?? '저장하지 못했습니다.'); return }
      setAdding(false)
      setDraft({ ...EMPTY })
      await load()
    } catch {
      setFormError('저장하지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setSaving(false)
    }
  }, [draft, load])

  const remove = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/crm/quote-terms/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const body = await res.json()
        setError(body?.error?.message ?? '지우지 못했습니다.')
        return
      }
      await load()
    } catch {
      setError('지우지 못했습니다. 잠시 후 다시 시도해 주세요.')
    }
  }, [load])

  if (loading && items.length === 0) return <AXDotLoader />

  return (
    <div className={`card ${styles.card}`}>
      <div className={styles.head}>
        <h3 className={styles.title}>거래 조건</h3>
        <NbButton variant="ghost" onClick={() => setAdding((v) => !v)}>
          <Plus size={14} /> 조건 추가
        </NbButton>
      </div>
      <p className={styles.desc}>
        {/* JSX 는 마크다운을 렌더하지 않는다 — 별표가 글자로 찍힌다(실브라우저에서 보였다) */}
        견적서 아래에 인쇄됩니다. 등록해 두면 견적마다 필요한 것만 골라 쓸 수 있어요.
        사업 유형을 지정하면 그 유형의 딜에서 먼저 보입니다.
      </p>

      {error && <ErrorState message={error} onRetry={() => void load()} />}

      {adding && (
        <div className={styles.form}>
          <FormErrorBanner message={formError} />
          <div className={styles.field}>
            <label className="label" htmlFor="term-body">조건 내용</label>
            <textarea
              id="term-body" className="input-field" rows={2} value={draft.body}
              onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
              placeholder="예: 결제 조건 — 검수 후 30일 이내 현금 지급"
              autoFocus
            />
          </div>
          <div className={styles.row}>
            <div className={styles.field}>
              <label className="label" htmlFor="term-type">사업 유형</label>
              <select
                id="term-type" className="input-field" value={draft.businessType}
                onChange={(e) => setDraft((d) => ({ ...d, businessType: e.target.value }))}
              >
                <option value="">모든 유형</option>
                {BUSINESS_TYPE_ORDER.map((t) => (
                  <option key={t} value={t}>{BUSINESS_TYPE_LABEL[t as BusinessTypeKey]}</option>
                ))}
              </select>
            </div>
            <label className={`label ${styles.check}`}>
              <input
                type="checkbox" checked={draft.isDefault}
                onChange={(e) => setDraft((d) => ({ ...d, isDefault: e.target.checked }))}
              />
              {/* 기본으로 켜 두면 새 견적에 자동으로 붙는다 — 매번 고르지 않게 */}
              <span>새 견적에 기본으로 넣기</span>
            </label>
          </div>
          <div className={styles.formFoot}>
            <NbButton variant="ghost" onClick={() => setAdding(false)} disabled={saving}>{ACTION.cancel}</NbButton>
            <NbButton onClick={() => void save()} disabled={saving}>
              {saving ? progress(ACTION.save) : ACTION.save}
            </NbButton>
          </div>
        </div>
      )}

      {items.length === 0 && !adding ? (
        <EmptyState
          title="거래 조건이 아직 없어요"
          description="결제·납품·유효기간처럼 견적서마다 반복되는 문장을 등록해 두세요."
          action={{ label: '조건 추가', onClick: () => setAdding(true) }}
        />
      ) : (
        <ul className={styles.list}>
          {items.map((t) => (
            <li key={t.id} className={styles.item}>
              <span className={styles.body}>{t.body}</span>
              <span className={styles.tags}>
                {t.businessType && (
                  <span className={styles.tag}>{BUSINESS_TYPE_LABEL[t.businessType as BusinessTypeKey] ?? t.businessType}</span>
                )}
                {t.isDefault && <span className={`${styles.tag} ${styles.tagDefault}`}>기본</span>}
              </span>
              <button
                type="button" className={styles.remove}
                onClick={() => void remove(t.id)}
                aria-label={`${t.title} ${ACTION.delete}`}
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
