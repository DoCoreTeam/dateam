'use client'

// 미리 계산 — 견적과 같은 엔진으로 그 자리에서 센다.
// 가격표의 계산 예시가 저장돼 있으면 같은 금액인지 함께 보인다(검증 5 계산 예시 재현).

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import FormErrorBanner from '@/components/ui/FormErrorBanner'
import Sensitive from '@/components/crm/Sensitive'
import { ACTION, PRICEBOOK, PROVENANCE_LABEL, progress } from '@/lib/terms'
import { COMPANY_KIND_LABEL, type CompanyKind } from '@/lib/crm/domain/company-kind'
import type { DetailJson } from './detail-shape'
import { won } from './detail-shape'
import TcoSettings from './TcoSettings'
import styles from './detail.module.css'

interface GpuDraft { model: string; count: string; timed: boolean }
interface PreviewJson {
  result: {
    lines: { key: string; name: string; sectionKey: string; quantity: number; unit: string | null; formula: string; remark: string | null }[]
    composed: { lines: { key: string; amounts: { lineTotalMinor: string } }[]; sections: { key: string; totalMinor: string; roundingMinor: string }[] }
    onceSupplyMinor: string
    annualSupplyMinor: string
    tcoMinor: string
    autoFilled: { field: string; value: string; provenance: { source: string; note?: string | null } }[]
    violations: { level: string; message: string }[]
  }
  examples: { label: string; ok: boolean; mismatches: string[] }[]
}

interface Props { data: DetailJson; onSaved: () => void }

export default function PreviewTab({ data, onSaved }: Props) {
  const first = data.product.examples[0]?.conditions as Record<string, unknown> | undefined
  const [picked, setPicked] = useState<string[]>(Array.isArray(first?.picked) ? (first?.picked as string[]) : [])
  const [gpus, setGpus] = useState<GpuDraft[]>(Array.isArray(first?.gpus)
    ? (first?.gpus as { model: string; count: number; timed: boolean }[]).map((g) => ({ model: g.model, count: String(g.count), timed: g.timed }))
    : [])
  const [nodes, setNodes] = useState(first?.nodes != null ? String(first.nodes) : '')
  const [training, setTraining] = useState('')
  const [kind, setKind] = useState<CompanyKind | ''>('')
  const [out, setOut] = useState<PreviewJson | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expect, setExpect] = useState({ once: '', annual: '', tco: '' })
  const optional = useMemo(() => data.items.filter((i) => i.isActive), [data.items])

  const conditions = useCallback(() => ({
    picked,
    gpus: gpus.filter((g) => g.model.trim() && Number(g.count) > 0).map((g) => ({ model: g.model.trim(), count: Number(g.count), timed: g.timed })),
    nodes: nodes === '' ? null : Number(nodes),
    training: training === '' ? null : Number(training),
    companyKind: kind || null,
    discount: kind ? 'auto' : 'none',
  }), [picked, gpus, nodes, training, kind])

  const run = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/crm/pricebook/products/${data.product.id}/preview`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conditions: conditions() }),
      })
      const body = await res.json()
      if (!res.ok) { setError(body?.error?.message ?? '계산하지 못했습니다.'); return }
      setOut(body)
    } catch {
      setError('계산하지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setBusy(false)
    }
  }, [conditions, data.product.id])

  useEffect(() => { void run() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const saveExample = async () => {
    if (!expect.once || !expect.annual) { setError('가격표에 적힌 초기 도입 금액과 연 유지보수 금액을 넣어 주세요.'); return }
    setError(null)
    const examples = [...data.product.examples, {
      label: `계산 예시 ${data.product.examples.length + 1}`, conditions: conditions(),
      expectOnceMinor: expect.once, expectAnnualMinor: expect.annual, expectTcoMinor: expect.tco || null,
    }]
    const res = await fetch(`/api/crm/pricebook/products/${data.product.id}/examples`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: data.product.version, examples }),
    })
    const body = await res.json().catch(() => null)
    if (!res.ok) { setError(body?.error?.message ?? '저장하지 못했습니다.'); return }
    onSaved()
  }

  const amountOf = (key: string) => out?.result.composed.lines.find((l) => l.key === key)?.amounts.lineTotalMinor ?? '0'

  return (
    <div className={styles.wrap}>
      <FormErrorBanner message={error} />
      <fieldset className={styles.field} style={{ border: 0, padding: 0 }}>
        <legend className="label">고를 품목</legend>
        <div className={styles.checks}>
          {optional.map((i) => (
            <label key={i.id}>
              <input type="checkbox" checked={picked.includes(i.id)} onChange={() => setPicked((p) => (p.includes(i.id) ? p.filter((x) => x !== i.id) : [...p, i.id]))} /> {i.name}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className={styles.field} style={{ border: 0, padding: 0 }}>
        <legend className="label">GPU</legend>
        {gpus.map((g, k) => (
          <div key={k} className={styles.gpuRow}>
            <input className="input-field" aria-label="GPU 모델" value={g.model} onChange={(e) => setGpus((gs) => gs.map((x, j) => (j === k ? { ...x, model: e.target.value } : x)))} placeholder="H100 SXM" />
            <input className="input-field" aria-label="장수" inputMode="numeric" value={g.count} onChange={(e) => setGpus((gs) => gs.map((x, j) => (j === k ? { ...x, count: e.target.value.replace(/\D/g, '') } : x)))} />
            <label><input type="checkbox" checked={g.timed} onChange={(e) => setGpus((gs) => gs.map((x, j) => (j === k ? { ...x, timed: e.target.checked } : x)))} /> 지정 시간</label>
            <NbButton variant="ghost" aria-label={ACTION.delete} onClick={() => setGpus((gs) => gs.filter((_, j) => j !== k))}><Trash2 size={14} /></NbButton>
          </div>
        ))}
        <div><NbButton variant="ghost" onClick={() => setGpus((gs) => [...gs, { model: '', count: '1', timed: false }])}><Plus size={14} /> GPU</NbButton></div>
      </fieldset>
      <div className={styles.row}>
        <div className={styles.field}>
          <label className="label" htmlFor="pv-nodes">노드 수</label>
          <input id="pv-nodes" className="input-field" inputMode="numeric" value={nodes} onChange={(e) => setNodes(e.target.value.replace(/\D/g, ''))} placeholder="비우면 기본 포함 대수" />
        </div>
        <div className={styles.field}>
          <label className="label" htmlFor="pv-training">추가 교육 횟수</label>
          <input id="pv-training" className="input-field" inputMode="numeric" value={training} onChange={(e) => setTraining(e.target.value.replace(/\D/g, ''))} />
        </div>
        <div className={styles.field}>
          <label className="label" htmlFor="pv-kind">기관 종류</label>
          <select id="pv-kind" className="input-field" value={kind} onChange={(e) => setKind(e.target.value as CompanyKind | '')}>
            <option value="">할인 없음</option>
            {(Object.keys(COMPANY_KIND_LABEL) as CompanyKind[]).map((k) => <option key={k} value={k}>{COMPANY_KIND_LABEL[k]}</option>)}
          </select>
        </div>
      </div>
      <div className={styles.actions}>
        <NbButton onClick={() => void run()} disabled={busy}>{busy ? progress(PRICEBOOK.previewRun) : PRICEBOOK.previewRun}</NbButton>
      </div>

      {out && (
        <>
          {out.result.violations.map((v, k) => (
            <p key={k} className={v.level === 'block' ? styles.verdictBad : styles.small}>{v.message}</p>
          ))}
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <tbody>
                {out.result.composed.sections.map((s) => (
                  <SectionBlock key={s.key} name={s.key} total={s.totalMinor} rounding={s.roundingMinor}
                    lines={out.result.lines.filter((l) => l.sectionKey === s.key)} amountOf={amountOf} />
                ))}
              </tbody>
            </table>
          </div>
          <div className={styles.totals}>
            <div className={styles.totalLine}><span>{PRICEBOOK.previewOnce}</span><b><Sensitive>{won(out.result.onceSupplyMinor)}</Sensitive></b></div>
            <div className={styles.totalLine}><span>{PRICEBOOK.previewAnnual}</span><b><Sensitive>{won(out.result.annualSupplyMinor)}</Sensitive></b></div>
            <div className={styles.totalLine}><span>{PRICEBOOK.previewTco(data.product.tcoYears)}</span><b><Sensitive>{won(out.result.tcoMinor)}</Sensitive></b></div>
          </div>
          <TcoSettings data={data} onSaved={onSaved} />
          {out.result.autoFilled.length > 0 && (
            <div>
              <b>{PRICEBOOK.autoFilled} {out.result.autoFilled.length}개</b>
              <ul>
                {out.result.autoFilled.map((a, k) => (
                  <li key={k}>{a.field} {a.value}: {a.provenance.note ?? PROVENANCE_LABEL[a.provenance.source as keyof typeof PROVENANCE_LABEL] ?? a.provenance.source}</li>
                ))}
              </ul>
            </div>
          )}
          {out.examples.map((ex, k) => (
            <p key={k} className={ex.ok ? styles.verdictOk : styles.verdictBad}>
              {ex.ok ? `(맞음) ${PRICEBOOK.previewMatches}` : `(다름) ${PRICEBOOK.previewDiffers}: ${ex.mismatches.join(', ')}`}
            </p>
          ))}
        </>
      )}

      <fieldset className={styles.field} style={{ border: 0, padding: 0 }}>
        <legend className="label">이 조건을 {PRICEBOOK.example}로 저장 (가격표에 적힌 금액, 원)</legend>
        <div className={styles.row}>
          <input className="input-field" aria-label={PRICEBOOK.previewOnce} inputMode="numeric" placeholder={PRICEBOOK.previewOnce} value={expect.once} onChange={(e) => setExpect((x) => ({ ...x, once: e.target.value.replace(/\D/g, '') }))} />
          <input className="input-field" aria-label={PRICEBOOK.previewAnnual} inputMode="numeric" placeholder={PRICEBOOK.previewAnnual} value={expect.annual} onChange={(e) => setExpect((x) => ({ ...x, annual: e.target.value.replace(/\D/g, '') }))} />
          <input className="input-field" aria-label={PRICEBOOK.previewTco(data.product.tcoYears)} inputMode="numeric" placeholder={PRICEBOOK.previewTco(data.product.tcoYears)} value={expect.tco} onChange={(e) => setExpect((x) => ({ ...x, tco: e.target.value.replace(/\D/g, '') }))} />
        </div>
        <div className={styles.actions}><NbButton variant="ghost" onClick={() => void saveExample()}>{ACTION.save}</NbButton></div>
      </fieldset>
    </div>
  )
}

function SectionBlock({ name, total, rounding, lines, amountOf }: {
  name: string; total: string; rounding: string
  lines: PreviewJson['result']['lines']; amountOf: (key: string) => string
}) {
  return (
    <>
      <tr className={styles.sectionRow}><td>{name}</td><td /><td className={styles.num}><Sensitive>{won(total)}</Sensitive></td></tr>
      {lines.map((l) => (
        <tr key={l.key}>
          <td>{l.name}{l.remark && <div className={styles.small}>{l.remark}</div>}</td>
          <td className={styles.small}>{l.formula}</td>
          <td className={styles.num}><Sensitive>{won(amountOf(l.key))}</Sensitive></td>
        </tr>
      ))}
      {rounding !== '0' && <tr><td className={styles.small}>{PRICEBOOK.sectionRounding}</td><td /><td className={styles.num}>-{won(rounding)}</td></tr>}
    </>
  )
}
