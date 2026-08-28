'use client'

// 딜 원가 — 갈래 10 × 시점 3 (기획 차수 2)
//
// **이 화면이 답하는 질문은 하나다: 남는 장사인가.**
// 그래서 맨 위에 «원가 합계 · 매출총이익 · 마진율» 셋을 두고, 그 아래 내역을 둔다.
// 내역만 있으면 사람이 더해 봐야 하고, 더해 보는 사람은 결국 안 본다.
//
// **대외비다.** 이 값은 고객에게 나가는 문서(`QuoteDocument`)에 **담을 자리가 없다** —
// 지우는 것이 아니라 타입에 없어서 실릴 수 없다(security/sensitivity.ts).
// 회의 모드에서는 `Sensitive` 가 가린다.

import { useCallback, useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import NbModal from '@/components/ui/nb/NbModal'
import AXDotLoader from '@/components/ui/AXDotLoader'
import EmptyState from '@/components/ui/EmptyState'
import ErrorState from '@/components/ui/ErrorState'
import FormErrorBanner from '@/components/ui/FormErrorBanner'
import Sensitive from '@/components/crm/Sensitive'
import MoneyField from '@/components/ui/MoneyField'
import { formatAmount } from '@/app/(crm)/crm/deals/amount'
import { ACTION, progress } from '@/lib/terms'
import {
  COST, COST_CATEGORY_LABEL, COST_CATEGORY_ORDER, COST_CATEGORY_HINT,
  COST_STAGE_LABEL, COST_STAGE_ORDER,
  COST_INPUT_MODE_LABEL, COST_INPUT_MODE_ORDER, COST_INPUT_MODE_HINT,
  RATIO_BASE_LABEL,
  type CostCategory, type CostStage, type CostInputMode, type RatioBase,
} from '@/lib/terms/cost'
import styles from './cost-panel.module.css'

interface CostItem {
  id: string
  category: CostCategory
  stage: CostStage
  inputMode: CostInputMode
  name: string
  amountMinor: string
  currency: string
  laborGradeId: string | null
  effortMm: string | null
  ratioPct: string | null
  ratioBase: string | null
  basisNote: string | null
}

interface Grade {
  id: string
  name: string
  roleLabel: string | null
  costPerMmMinor: string
}

interface CostView {
  items: CostItem[]
  revenueMinor: string
  totals: { totalMinor: string; byCategory: Record<string, string>; byStage: Record<string, string> }
  margin: { grossProfitMinor: string; marginPct: number | null }
}

interface Props {
  dealId: string
  currency: string
  onChanged?: () => void
}

const EMPTY_DRAFT = {
  name: '', category: 'LABOR' as CostCategory, stage: 'ESTIMATE' as CostStage,
  inputMode: 'AMOUNT' as CostInputMode,
  amountMinor: '', laborGradeId: '', effortMm: '', ratioPct: '', ratioBase: 'REVENUE' as RatioBase,
  basisNote: '',
}

export default function CostPanel({ dealId, currency, onChanged }: Props) {
  const [view, setView] = useState<CostView | null>(null)
  const [grades, setGrades] = useState<Grade[]>([])
  const [loading, setLoading] = useState(true)
  /**
   * 권한이 없으면 **패널 자체를 안 그린다.**
   * 「볼 수 없습니다」를 띄우면 원가가 있다는 사실 자체가 새고, 그걸 보고 사람은 묻는다.
   */
  const [forbidden, setForbidden] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState({ ...EMPTY_DRAFT })
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/crm/deals/${dealId}/costs`)
      if (res.status === 403) { setForbidden(true); return }
      const body = await res.json()
      if (!res.ok) { setError(body?.error?.message ?? '원가를 불러오지 못했습니다.'); return }
      setView(body)
    } catch {
      setError('원가를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setLoading(false)
    }
  }, [dealId])

  useEffect(() => { void load() }, [load])

  // 등급은 «공수» 를 고를 때만 필요하다 — 열 때 한 번 불러온다
  useEffect(() => {
    if (!adding || grades.length > 0) return
    void (async () => {
      try {
        const res = await fetch('/api/crm/labor-grades')
        if (!res.ok) return
        const body = await res.json()
        setGrades(body.items ?? [])
      } catch { /* 등급이 없어도 금액으로는 넣을 수 있다 */ }
    })()
  }, [adding, grades.length])

  const save = useCallback(async () => {
    if (!draft.name.trim()) { setFormError('항목 이름을 입력해 주세요.'); return }
    setSaving(true)
    setFormError(null)
    try {
      const res = await fetch(`/api/crm/deals/${dealId}/costs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: draft.name.trim(),
          category: draft.category,
          stage: draft.stage,
          inputMode: draft.inputMode,
          amountMinor: draft.inputMode === 'AMOUNT' ? draft.amountMinor : null,
          laborGradeId: draft.inputMode === 'EFFORT' ? draft.laborGradeId || null : null,
          effortMm: draft.inputMode === 'EFFORT' ? draft.effortMm : null,
          ratioPct: draft.inputMode === 'RATIO' ? draft.ratioPct : null,
          ratioBase: draft.inputMode === 'RATIO' ? draft.ratioBase : null,
          basisNote: draft.basisNote,
        }),
      })
      const body = await res.json()
      if (!res.ok) { setFormError(body?.error?.message ?? '저장하지 못했습니다.'); return }
      setAdding(false)
      setDraft({ ...EMPTY_DRAFT })
      await load()
      onChanged?.()
    } catch {
      setFormError('저장하지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setSaving(false)
    }
  }, [dealId, draft, load, onChanged])

  const remove = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/crm/costs/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const body = await res.json()
        setError(body?.error?.message ?? '지우지 못했습니다.')
        return
      }
      await load()
      onChanged?.()
    } catch {
      setError('지우지 못했습니다. 잠시 후 다시 시도해 주세요.')
    }
  }, [load, onChanged])

  if (forbidden) return null
  if (loading && !view) return <AXDotLoader />
  if (error && !view) return <ErrorState message={error} onRetry={() => void load()} />
  if (!view) return null

  const money = (minor: string) => formatAmount(minor, currency) ?? '—'
  const grouped = COST_CATEGORY_ORDER
    .map((c) => ({ category: c, items: view.items.filter((i) => i.category === c) }))
    .filter((g) => g.items.length > 0)

  return (
    <div className={styles.wrap}>
      <p className={styles.confidential}>{COST.internalOnly}</p>

      {/* 답부터 — 남는 장사인가 */}
      <div className={styles.summary}>
        <div className={styles.metric}>
          <span className={styles.metricLabel}>{COST.totalCost}</span>
          <b className={styles.metricValue}><Sensitive>{money(view.totals.totalMinor)}</Sensitive></b>
        </div>
        <div className={styles.metric}>
          <span className={styles.metricLabel}>{COST.grossProfit}</span>
          <b className={styles.metricValue}><Sensitive>{money(view.margin.grossProfitMinor)}</Sensitive></b>
        </div>
        <div className={styles.metric}>
          <span className={styles.metricLabel}>{COST.marginPct}</span>
          {/*
            매출이 0이면 마진율을 **말하지 않는다.** 0% 라고 쓰면 「밑진다」로 읽히는데
            사실은 «아직 모른다»다(computeMargin 이 null 을 준다).
          */}
          <b className={`${styles.metricValue} ${marginTone(view.margin.marginPct)}`}>
            {view.margin.marginPct === null
              ? <span className={styles.unknown}>아직 모름</span>
              : <Sensitive>{`${view.margin.marginPct}%`}</Sensitive>}
          </b>
        </div>
      </div>

      {error && <ErrorState message={error} />}

      {view.items.length === 0 ? (
        <EmptyState
          title={COST.emptyTitle}
          description={COST.emptyHint}
          action={{ label: COST.addCost, onClick: () => setAdding(true) }}
        />
      ) : (
        <>
          {grouped.map((g) => (
            <section key={g.category} className={styles.group}>
              <h4 className={styles.groupTitle}>
                {COST_CATEGORY_LABEL[g.category]}
                <span className={styles.groupSum}>
                  <Sensitive>{money(view.totals.byCategory[g.category] ?? '0')}</Sensitive>
                </span>
              </h4>
              <ul className={styles.list}>
                {g.items.map((it) => (
                  <li key={it.id} className={styles.item}>
                    <span className={styles.itemName}>
                      {it.name}
                      <span className={styles.stage}>{COST_STAGE_LABEL[it.stage]}</span>
                    </span>
                    {/* 어떻게 나온 숫자인지 — 금액만 남기면 나중에 아무도 모른다 */}
                    <span className={styles.basis}>{basisOf(it)}</span>
                    <span className={styles.itemAmount}>
                      <Sensitive>{money(it.amountMinor)}</Sensitive>
                    </span>
                    <button
                      type="button" className={styles.remove}
                      onClick={() => void remove(it.id)}
                      aria-label={`${it.name} ${ACTION.delete}`}
                    >
                      <Trash2 size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <NbButton variant="ghost" onClick={() => setAdding(true)}>
            <Plus size={14} /> {COST.addCost}
          </NbButton>
        </>
      )}

      {adding && (
        <NbModal
          title={COST.addCost}
          onClose={() => { setAdding(false); setFormError(null) }}
          /*
            넣는 방식(금액·공수·비율)마다 칸 수가 달라 모달이 출렁인다 — 높이를 고정한다.
            가장 긴 것(공수·비율: 두 칸이 한 줄 더 생긴다)에 맞춘다.
          */
          fixedHeight="min(620px, 82vh)"
          maxWidth={600}
          footer={
            <div className={styles.modalFoot}>
              <NbButton variant="ghost" onClick={() => setAdding(false)} disabled={saving}>{ACTION.cancel}</NbButton>
              <NbButton onClick={() => void save()} disabled={saving}>
                {saving ? progress(ACTION.save) : ACTION.save}
              </NbButton>
            </div>
          }
        >
          <div className={styles.form}>
            <FormErrorBanner message={formError} />

            <div className={styles.field}>
              <label className="label" htmlFor="cost-name">항목 이름</label>
              <input
                id="cost-name" className="input-field" value={draft.name}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                placeholder="예: 백엔드 개발 인건비"
                autoFocus
              />
            </div>

            <div className={styles.row}>
              <div className={styles.field}>
                <label className="label" htmlFor="cost-category">갈래</label>
                <select
                  id="cost-category" className="input-field" value={draft.category}
                  onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value as CostCategory }))}
                >
                  {COST_CATEGORY_ORDER.map((c) => (
                    <option key={c} value={c}>{COST_CATEGORY_LABEL[c]}</option>
                  ))}
                </select>
                <p className={styles.hint}>{COST_CATEGORY_HINT[draft.category]}</p>
              </div>

              <div className={styles.field}>
                <label className="label" htmlFor="cost-stage">시점</label>
                <select
                  id="cost-stage" className="input-field" value={draft.stage}
                  onChange={(e) => setDraft((d) => ({ ...d, stage: e.target.value as CostStage }))}
                >
                  {COST_STAGE_ORDER.map((c) => (
                    <option key={c} value={c}>{COST_STAGE_LABEL[c]}</option>
                  ))}
                </select>
                <p className={styles.hint}>추정과 실적을 나눠 두면 다음 견적이 정확해집니다.</p>
              </div>
            </div>

            <div className={styles.field}>
              <label className="label" htmlFor="cost-mode">넣는 방식</label>
              <select
                id="cost-mode" className="input-field" value={draft.inputMode}
                onChange={(e) => setDraft((d) => ({ ...d, inputMode: e.target.value as CostInputMode }))}
              >
                {COST_INPUT_MODE_ORDER.map((m) => (
                  <option key={m} value={m}>{COST_INPUT_MODE_LABEL[m]}</option>
                ))}
              </select>
              <p className={styles.hint}>{COST_INPUT_MODE_HINT[draft.inputMode]}</p>
            </div>

            {draft.inputMode === 'AMOUNT' && (
              <div className={styles.field}>
                <label className="label" htmlFor="cost-amount">금액</label>
                <MoneyField
                  id="cost-amount" value={draft.amountMinor}
                  onValueChange={(v) => setDraft((d) => ({ ...d, amountMinor: v }))}
                />
              </div>
            )}

            {draft.inputMode === 'EFFORT' && (
              <div className={styles.row}>
                <div className={styles.field}>
                  <label className="label" htmlFor="cost-grade">등급</label>
                  <select
                    id="cost-grade" className="input-field" value={draft.laborGradeId}
                    onChange={(e) => setDraft((d) => ({ ...d, laborGradeId: e.target.value }))}
                  >
                    <option value="">고르기</option>
                    {grades.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.roleLabel ? `${g.roleLabel} ${g.name}` : g.name} · {money(g.costPerMmMinor)}
                      </option>
                    ))}
                  </select>
                  {grades.length === 0 && (
                    <p className={styles.hint}>{COST.gradeHint}</p>
                  )}
                </div>
                <div className={styles.field}>
                  <label className="label" htmlFor="cost-mm">{COST.effortMm}</label>
                  <input
                    id="cost-mm" className="input-field" inputMode="decimal" value={draft.effortMm}
                    onChange={(e) => setDraft((d) => ({ ...d, effortMm: e.target.value }))}
                    placeholder="예: 2.5"
                  />
                </div>
              </div>
            )}

            {draft.inputMode === 'RATIO' && (
              <div className={styles.row}>
                <div className={styles.field}>
                  <label className="label" htmlFor="cost-base">무엇의</label>
                  <select
                    id="cost-base" className="input-field" value={draft.ratioBase}
                    onChange={(e) => setDraft((d) => ({ ...d, ratioBase: e.target.value as RatioBase }))}
                  >
                    {(['REVENUE', 'COST'] as RatioBase[]).map((b) => (
                      <option key={b} value={b}>{RATIO_BASE_LABEL[b]}</option>
                    ))}
                  </select>
                </div>
                <div className={styles.field}>
                  <label className="label" htmlFor="cost-pct">비율(%)</label>
                  <input
                    id="cost-pct" className="input-field" inputMode="decimal" value={draft.ratioPct}
                    onChange={(e) => setDraft((d) => ({ ...d, ratioPct: e.target.value }))}
                    placeholder="예: 7"
                  />
                </div>
              </div>
            )}

            <div className={styles.field}>
              <label className="label" htmlFor="cost-basis">{COST.basisNote}</label>
              <input
                id="cost-basis" className="input-field" value={draft.basisNote}
                onChange={(e) => setDraft((d) => ({ ...d, basisNote: e.target.value }))}
                placeholder={COST.basisHint}
              />
            </div>
          </div>
        </NbModal>
      )}
    </div>
  )
}

/** 이 금액이 어디서 나왔나 — 한 줄로 */
function basisOf(it: CostItem): string {
  if (it.inputMode === 'EFFORT' && it.effortMm) return `${it.effortMm} M/M`
  if (it.inputMode === 'RATIO' && it.ratioPct) {
    const base = it.ratioBase === 'COST' ? RATIO_BASE_LABEL.COST : RATIO_BASE_LABEL.REVENUE
    return `${base} ${it.ratioPct}%`
  }
  return it.basisNote ?? ''
}

/** 마진율은 **색으로도** 말한다 — 숫자만 보면 좋은지 나쁜지 매번 판단해야 한다 */
function marginTone(pct: number | null): string {
  if (pct === null) return ''
  if (pct < 0) return styles.bad
  if (pct < 10) return styles.warn
  return styles.good
}
