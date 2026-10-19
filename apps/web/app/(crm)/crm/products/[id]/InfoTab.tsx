'use client'

// 제품 기본 정보 — 이름, 사업 유형, 묶음 순서와 묶음 절사, 몇 년 총비용, 판매 중지

import { useState } from 'react'
import NbButton from '@/components/ui/nb/NbButton'
import FormErrorBanner from '@/components/ui/FormErrorBanner'
import { ACTION, PRICEBOOK, BUSINESS_TYPE_LABEL, BUSINESS_TYPE_ORDER, progress } from '@/lib/terms'
import { roundingUnitName } from '@/lib/terms/quote'
import { ROUNDING_UNITS } from '@/lib/crm/domain/quote-math'
import type { DetailJson, SectionJson } from './detail-shape'
import styles from './detail.module.css'

interface Props { data: DetailJson; onSaved: () => void }

export default function InfoTab({ data, onSaved }: Props) {
  const p = data.product
  const itemSections = [...new Set(data.items.map((i) => i.section ?? '기타'))]
  const initialSections: SectionJson[] = [
    ...p.sections,
    ...itemSections.filter((s) => !p.sections.some((x) => x.name === s)).map((name) => ({ name, roundingUnit: 0 })),
  ]
  const [name, setName] = useState(p.name)
  const [type, setType] = useState(p.businessTypeKey)
  const [desc, setDesc] = useState(p.descriptionMd ?? '')
  const [tco, setTco] = useState(String(p.tcoYears))
  const [free, setFree] = useState(String(p.freeYears))
  const [sections, setSections] = useState<SectionJson[]>(initialSections)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const patch = async (body: Record<string, unknown>) => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/crm/pricebook/products/${p.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, version: p.version }),
      })
      const json = await res.json()
      if (!res.ok) { setError(json?.error?.message ?? '저장하지 못했습니다.'); return }
      onSaved()
    } catch {
      setError('저장하지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setBusy(false)
    }
  }

  const setRounding = (i: number, unit: number) => setSections((ss) => ss.map((x, k) => (k === i ? { ...x, roundingUnit: unit } : x)))

  const move = (i: number, d: -1 | 1) => setSections((ss) => {
    const j = i + d
    if (j < 0 || j >= ss.length) return ss
    const next = [...ss]
    ;[next[i], next[j]] = [next[j], next[i]]
    return next
  })

  return (
    <div className={styles.form}>
      <FormErrorBanner message={error} />
      <div className={styles.row}>
        <div className={styles.field}>
          <label className="label" htmlFor="pi-name">{PRICEBOOK.productName}</label>
          <input id="pi-name" className="input-field" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className={styles.field}>
          <label className="label" htmlFor="pi-type">{PRICEBOOK.businessType}</label>
          <select id="pi-type" className="input-field" value={type} onChange={(e) => setType(e.target.value)}>
            {BUSINESS_TYPE_ORDER.map((k) => <option key={k} value={k}>{BUSINESS_TYPE_LABEL[k]}</option>)}
          </select>
        </div>
        <div className={styles.field}>
          <label className="label" htmlFor="pi-tco">{PRICEBOOK.previewTco(Number(tco) || 5)}</label>
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <input id="pi-tco" className="input-field" inputMode="numeric" value={tco} onChange={(e) => setTco(e.target.value.replace(/\D/g, ''))} aria-label="년수" />
            <input className="input-field" inputMode="numeric" value={free} onChange={(e) => setFree(e.target.value.replace(/\D/g, ''))} aria-label="무상 년수" title="무상 년수" />
          </div>
          <span className={styles.small}>앞 칸은 년수, 뒤 칸은 유지보수 무상 년수</span>
        </div>
      </div>
      <div className={styles.field}>
        <label className="label" htmlFor="pi-desc">{PRICEBOOK.remark}</label>
        <textarea id="pi-desc" className="input-field" rows={2} value={desc} onChange={(e) => setDesc(e.target.value)} />
      </div>
      <fieldset className={styles.field} style={{ border: 0, padding: 0 }}>
        <legend className="label">{PRICEBOOK.section} · {PRICEBOOK.sectionRounding}</legend>
        {sections.map((s, i) => (
          <div key={s.name} className={styles.gpuRow}>
            <span>{s.name}</span>
            <select className="input-field" aria-label={`${s.name} ${PRICEBOOK.sectionRounding}`} value={s.roundingUnit}
              onChange={(e) => setRounding(i, Number(e.target.value))}>
              {ROUNDING_UNITS.map((u) => <option key={u} value={u}>{u === 0 ? '절사 안 함' : `${roundingUnitName(u)} 미만 절사`}</option>)}
            </select>
            <NbButton variant="ghost" onClick={() => move(i, -1)} disabled={i === 0} aria-label="위로">↑</NbButton>
            <NbButton variant="ghost" onClick={() => move(i, 1)} disabled={i === sections.length - 1} aria-label="아래로">↓</NbButton>
          </div>
        ))}
      </fieldset>
      <div className={styles.foot}>
        <NbButton variant="ghost" disabled={busy} onClick={() => void patch({ isActive: !p.isActive })}>
          {p.isActive ? PRICEBOOK.stopSale : PRICEBOOK.resumeSale}
        </NbButton>
        <NbButton disabled={busy} onClick={() => void patch({
          name, businessTypeKey: type, descriptionMd: desc, sections,
          tcoYears: Number(tco) || 5, freeYears: Number(free || 0),
        })}>
          {busy ? progress(ACTION.save) : ACTION.save}
        </NbButton>
      </div>
    </div>
  )
}
