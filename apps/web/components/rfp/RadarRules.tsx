'use client'

// 공고 레이더 — **모으고, 거르고, 사람이 고른다.**
//
// ## 예전에 왜 안 됐나
//
// 구멍이 셋이었다. ⓐ 나라장터에서 공고를 가져오는 코드가 없어 훑을 대상이 0건이었고,
// ⓑ 「조건 추가」라는 말만 있고 만들 길이 없었고, ⓒ 걸린 공고의 이름조차 안 보였다.
// 셋 다 있어야 하나라도 쓸모가 생긴다.
//
// ## 조건은 말로 만든다
//
// 이름·키워드·기관·예산 하한·상한을 각각 채우라는 것은 **사용자에게 표처럼 생각하라**는
// 요구다. 사람은 「AI 관련 3억 이상 공공기관 사업」이라고 말한다.
// 그래서 한 줄로 받아 정형화하고, **그 결과를 화면에 채워 사람이 확인한 뒤** 저장한다 —
// 바로 저장하면 조건이 틀렸을 때 사용자는 「레이더가 이상하다」로만 느낀다.
//
// 자동은 **찾기까지**다. 케이스로 만드는 것은 사람이 고른다 —
// 자동으로 만들면 분석 비용이 자동으로 나가고 아무도 안 볼 리포트가 쌓인다.

import { useCallback, useState } from 'react'
import { Radar as RadarIcon, Plus, X, Wand2 } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import NbBadge from '@/components/ui/nb/NbBadge'
import EmptyState from '@/components/ui/EmptyState'
import FormErrorBanner from '@/components/ui/FormErrorBanner'
import { isEnterKey, isImeComposing } from '@/lib/ui/ime'
import { RFP_RADAR, RFP_COMMON } from '@/lib/rfp/terms'
import styles from '@/app/(rfp)/rfp.module.css'

export interface RadarHitRow {
  id: string
  rule_id: string
  source_id: string
  case_id: string | null
  pre_score: number | null
  reason: string | null
  status: string
  /** 걸린 공고가 무엇인지 — 이게 없으면 점수와 사유만 보인다 */
  notice?: {
    title: string | null
    agency: string | null
    budgetAmount: number | null
    noticeDate: string | null
  } | null
}

export interface RadarRuleRow {
  id: string
  name: string
  keywords: string[]
  agencies?: string[]
  budget_min: number | null
  budget_max: number | null
  enabled: boolean
}

export interface RadarRulesProps {
  initialRules: RadarRuleRow[]
  initialHits: RadarHitRow[]
}

interface NewRule {
  name: string
  keywords: string
  agencies: string
  budgetMin: string
  budgetMax: string
}

const EMPTY_RULE: NewRule = { name: '', keywords: '', agencies: '', budgetMin: '', budgetMax: '' }

/** 정형화 결과를 폼 값으로 — 숫자는 문자열로 둔다(사람이 고칠 칸이다) */
function toForm(d: {
  name: string; keywords: string[]; agencies: string[]; budgetMin: number | null; budgetMax: number | null
}): NewRule {
  return {
    name: d.name,
    keywords: d.keywords.join(', '),
    agencies: d.agencies.join(', '),
    budgetMin: d.budgetMin === null ? '' : String(d.budgetMin),
    budgetMax: d.budgetMax === null ? '' : String(d.budgetMax),
  }
}

/** 억 단위로 읽는다 — 원 단위 열한 자리는 사람이 못 읽는다 */
function money(v: number | null | undefined): string {
  if (v === null || v === undefined) return '-'
  if (v >= 100_000_000) return `${(v / 100_000_000).toFixed(1)}${RFP_RADAR.unitEok}`
  if (v >= 10_000) return `${Math.round(v / 10_000)}${RFP_RADAR.unitMan}`
  return String(v)
}

export default function RadarRules({ initialRules, initialHits }: RadarRulesProps) {
  const [rules, setRules] = useState(initialRules)
  const [hits, setHits] = useState(initialHits)
  const [draft, setDraft] = useState<NewRule | null>(null)
  const [ask, setAsk] = useState('')
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const sweep = useCallback(async () => {
    setError(null)
    setNote(null)
    setBusy(true)
    try {
      const res = await fetch('/api/rfp/radar', { method: 'POST' })
      const body = await res.json()
      if (!res.ok) { setError(RFP_COMMON.error); return }

      // 0건이 «없다»인지 «못 가져왔다»인지 화면이 말해야 한다
      if (body.collected?.reason === 'no_service_key') setNote(RFP_RADAR.noServiceKey)
      else if (body.reason === 'no_rules') setNote(RFP_RADAR.noRules)
      else setNote(`${RFP_RADAR.collected} ${body.collected?.inserted ?? 0} · ${RFP_RADAR.matched} ${body.hits?.length ?? 0}`)

      const list = await fetch('/api/rfp/radar', { cache: 'no-store' })
      setHits((await list.json()).hits ?? [])
    } catch {
      setError(RFP_COMMON.error)
    } finally {
      setBusy(false)
    }
  }, [])

  const addRule = useCallback(async () => {
    if (!draft) return
    setError(null)
    if (!draft.name.trim()) { setError(RFP_RADAR.nameRequired); return }
    if (!draft.keywords.trim() && !draft.agencies.trim() && !draft.budgetMin && !draft.budgetMax) {
      // 조건이 없으면 모든 공고가 걸린다 — 그건 레이더가 아니라 목록이다
      setError(RFP_RADAR.noCondition); return
    }
    setBusy(true)
    try {
      const res = await fetch('/api/rfp/radar/rules', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: draft.name, keywords: draft.keywords, agencies: draft.agencies,
          budgetMin: draft.budgetMin || null, budgetMax: draft.budgetMax || null,
        }),
      })
      const body = await res.json()
      if (!res.ok) { setError(body.error === 'no_condition' ? RFP_RADAR.noCondition : RFP_COMMON.error); return }
      setRules((p) => [...p, body.rule])
      setDraft(null)
    } catch {
      setError(RFP_COMMON.error)
    } finally {
      setBusy(false)
    }
  }, [draft])

  /** 말한 것을 조건으로 바꾼다 — 저장은 사람이 확인한 뒤에 한다 */
  const structure = useCallback(async () => {
    setError(null)
    if (!ask.trim()) { setError(RFP_RADAR.askEmpty); return }
    setAsking(true)
    try {
      const res = await fetch('/api/rfp/radar/rules/draft', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: ask.trim() }),
      })
      const body = await res.json()
      if (!res.ok) { setError(RFP_COMMON.error); return }
      setDraft(toForm(body.draft))
      // 왜 덜 채워졌는지 화면이 말한다
      setNote(body.aiSkipped ? RFP_RADAR.askAiSkipped : null)
    } catch {
      setError(RFP_COMMON.error)
    } finally {
      setAsking(false)
    }
  }, [ask])

  const toggle = useCallback(async (rule: RadarRuleRow) => {
    setRules((p) => p.map((r) => (r.id === rule.id ? { ...r, enabled: !r.enabled } : r)))
    await fetch('/api/rfp/radar/rules', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: rule.id, enabled: !rule.enabled }),
    })
  }, [])

  const remove = useCallback(async (id: string) => {
    setRules((p) => p.filter((r) => r.id !== id))
    await fetch(`/api/rfp/radar/rules?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
  }, [])

  return (
    <div className={styles.stack}>
      {error && <FormErrorBanner message={error} />}

      {/* ① 조건 */}
      <section className="card">
        <div className={styles.sectionHead}>
          <div className={styles.between}>
            <span className={styles.sectionTitle}>{RFP_RADAR.rules}</span>
            <NbBadge status="note">{rules.filter((r) => r.enabled).length} / {rules.length}</NbBadge>
          </div>
          <span className={styles.sectionDesc}>{RFP_RADAR.sweepDesc}</span>
        </div>

        {rules.length === 0 && <span className={styles.sectionDesc}>{RFP_RADAR.emptyDesc}</span>}

        <div className={styles.ruleList}>
          {rules.map((r) => (
            <div key={r.id} className={styles.ruleItem}>
              <label className={styles.row}>
                <input type="checkbox" checked={r.enabled} onChange={() => void toggle(r)} />
                <span className={styles.ruleName}>{r.name}</span>
              </label>
              <span className={styles.row}>
                {r.keywords.length > 0 && <NbBadge status="note">{r.keywords.join(', ')}</NbBadge>}
                {(r.agencies?.length ?? 0) > 0 && <NbBadge status="note">{r.agencies?.join(', ')}</NbBadge>}
                {(r.budget_min !== null || r.budget_max !== null) && (
                  <NbBadge status="note">{money(r.budget_min)} ~ {money(r.budget_max)}</NbBadge>
                )}
                <NbButton variant="ghost" onClick={() => void remove(r.id)} aria-label={RFP_RADAR.removeRule}>
                  <X size={12} />
                </NbButton>
              </span>
            </div>
          ))}
        </div>

        {/* 말로 먼저 받는다 — 다섯 칸을 채우라는 요구가 아니라 한 줄이면 된다 */}
        {!draft && (
          <div className={styles.field}>
            <label className="label" htmlFor="radar-ask">{RFP_RADAR.askTitle}</label>
            <div className={styles.row}>
              <input
                id="radar-ask"
                className="input-field"
                value={ask}
                placeholder={RFP_RADAR.askPlaceholder}
                onChange={(e) => setAsk(e.target.value)}
                onKeyDown={(e) => { if (isEnterKey(e) && !isImeComposing(e)) void structure() }}
              />
              <NbButton onClick={() => void structure()} disabled={asking || !ask.trim()}>
                <Wand2 size={14} /> {asking ? RFP_RADAR.askBusy : RFP_RADAR.askSubmit}
              </NbButton>
            </div>
            <span className={styles.sectionDesc}>{RFP_RADAR.askHint}</span>
          </div>
        )}

        {draft && (
          <div className={styles.sectionHead}>
            <span className={styles.sectionTitle}>{RFP_RADAR.reviewTitle}</span>
            <span className={styles.sectionDesc}>{RFP_RADAR.reviewHint}</span>
          </div>
        )}

        {draft && (
          <div className={styles.fieldGrid}>
            <Field label={RFP_RADAR.ruleName} value={draft.name}
              onChange={(v) => setDraft({ ...draft, name: v })} />
            <Field label={RFP_RADAR.keywords} value={draft.keywords} hint={RFP_RADAR.keywordsHint}
              onChange={(v) => setDraft({ ...draft, keywords: v })} />
            <Field label={RFP_RADAR.agencies2} value={draft.agencies} hint={RFP_RADAR.keywordsHint}
              onChange={(v) => setDraft({ ...draft, agencies: v })} />
            <Field label={RFP_RADAR.budgetMin} value={draft.budgetMin} numeric
              onChange={(v) => setDraft({ ...draft, budgetMin: v })} />
            <Field label={RFP_RADAR.budgetMax} value={draft.budgetMax} numeric
              onChange={(v) => setDraft({ ...draft, budgetMax: v })} />
          </div>
        )}

        <div className={styles.actions}>
          {draft ? (
            <>
              <NbButton onClick={() => void addRule()} disabled={busy}>{RFP_COMMON.save}</NbButton>
              <NbButton variant="secondary" onClick={() => { setDraft(null); setAsk('') }}>
                {RFP_COMMON.cancel}
              </NbButton>
            </>
          ) : (
            // 말로 안 되는 사람에게 직접 적는 길도 남긴다
            <NbButton variant="secondary" onClick={() => setDraft({ ...EMPTY_RULE })}>
              <Plus size={14} /> {RFP_RADAR.editManually}
            </NbButton>
          )}
          <NbButton onClick={() => void sweep()} disabled={busy}>
            <RadarIcon size={14} /> {busy ? RFP_COMMON.loading : RFP_RADAR.sweepNow}
          </NbButton>
        </div>

        {note && <span className={styles.sectionDesc}>{note}</span>}
      </section>

      {/* ② 걸린 공고 */}
      <section className="card">
        <div className={styles.sectionHead}>
          <div className={styles.between}>
            <span className={styles.sectionTitle}>{RFP_RADAR.hits}</span>
            {hits.length > 0 && <NbBadge status="note">{hits.length}</NbBadge>}
          </div>
        </div>

        {hits.length === 0 ? (
          <EmptyState title={RFP_RADAR.emptyTitle} description={RFP_RADAR.emptyDesc} />
        ) : (
          <div className={styles.ruleList}>
            {/* 사전 점수 높은 것부터 — 사용자는 위에서 몇 개만 본다 */}
            {hits.map((h) => (
              <div key={h.id} className={styles.ruleItem}>
                <span className={styles.tight}>
                  {/* 무엇이 걸렸는지가 먼저다. 점수와 사유만으로는 아무것도 못 정한다 */}
                  <span className={styles.ruleName}>{h.notice?.title ?? h.source_id}</span>
                  <span className={styles.sectionDesc}>
                    {RFP_RADAR.noticeAgency} {h.notice?.agency ?? '-'}
                    {' · '}{RFP_RADAR.noticeBudget} {money(h.notice?.budgetAmount)}
                    {' · '}{RFP_RADAR.noticeDate} {h.notice?.noticeDate ?? '-'}
                  </span>
                  <span className={styles.sectionDesc}>{h.reason}</span>
                </span>
                <span className={styles.row}>
                  <NbBadge status="doing">{h.pre_score ?? 0}</NbBadge>
                  <NbButton variant="secondary" href={`/rfp/new?source=${h.source_id}`}>
                    {RFP_RADAR.openCase}
                  </NbButton>
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function Field({ label, value, onChange, hint, numeric }: {
  label: string; value: string; onChange: (v: string) => void; hint?: string; numeric?: boolean
}) {
  return (
    <div className={styles.field}>
      <label className="label">{label}</label>
      <input
        className="input-field"
        value={value}
        onChange={(e) => onChange(numeric ? e.target.value.replace(/[^0-9]/g, '') : e.target.value)}
      />
      {hint && <span className={styles.sectionDesc}>{hint}</span>}
    </div>
  )
}
