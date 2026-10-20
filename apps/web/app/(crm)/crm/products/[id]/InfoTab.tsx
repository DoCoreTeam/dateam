'use client'

// 제품 기본 정보 — 제품, 총비용 계산, 묶음 순서와 절사, 판매 상태
//
// 칸마다 이름과 단위를 붙이고 그 값이 견적에 어떻게 쓰이는지 그 자리에서 말한다.
// 예전엔 이름 없는 숫자 칸 둘에 「앞 칸은 년수, 뒤 칸은 무상 년수」 안내가 붙어 있었다(사용자 지적 2026-10-20).
// 판매 중지는 곧바로 저장되는 상태 전환이라 폼 저장 단추와 떨어진 자리에 둔다.

import { useMemo, useState } from 'react'
import NbButton from '@/components/ui/nb/NbButton'
import NbBadge from '@/components/ui/nb/NbBadge'
import FormErrorBanner from '@/components/ui/FormErrorBanner'
import SectionSurface from '@/components/ui/SectionSurface'
import ReorderList from '@/components/ui/ReorderList'
import { ACTION, PRICEBOOK, BUSINESS_TYPE_LABEL, BUSINESS_TYPE_ORDER, progress } from '@/lib/terms'
import { roundingUnitName } from '@/lib/terms/quote'
import { ROUNDING_UNITS } from '@/lib/crm/domain/quote-math'
import type { DetailJson, SectionJson } from './detail-shape'
import styles from './detail.module.css'

interface Props { data: DetailJson; onSaved: () => void }

const DEFAULT_TCO_YEARS = 5
const MAX_YEARS = 2

interface FormState { name: string; type: string; desc: string; tco: string; free: string; sections: SectionJson[] }

function initialForm(data: DetailJson): FormState {
  const p = data.product
  const itemSections = [...new Set(data.items.map((i) => i.section ?? '기타'))]
  return {
    name: p.name,
    type: p.businessTypeKey,
    desc: p.descriptionMd ?? '',
    tco: String(p.tcoYears),
    free: String(p.freeYears),
    sections: [
      ...p.sections,
      ...itemSections.filter((s) => !p.sections.some((x) => x.name === s)).map((name) => ({ name, roundingUnit: 0 })),
    ],
  }
}

const digits = (v: string) => v.replace(/\D/g, '').slice(0, MAX_YEARS)

export default function InfoTab({ data, onSaved }: Props) {
  const p = data.product
  const start = useMemo(() => initialForm(data), [data])
  const [form, setForm] = useState<FormState>(start)
  const [busy, setBusy] = useState<'save' | 'sale' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const dirty = JSON.stringify(form) !== JSON.stringify(start)
  const years = Number(form.tco) || DEFAULT_TCO_YEARS
  const free = Number(form.free || 0)
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }))

  const patch = async (body: Record<string, unknown>, kind: 'save' | 'sale') => {
    setBusy(kind)
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
      setBusy(null)
    }
  }

  const save = () => void patch({
    name: form.name, businessTypeKey: form.type, descriptionMd: form.desc, sections: form.sections,
    tcoYears: years, freeYears: free,
  }, 'save')

  const setRounding = (name: string, unit: number) =>
    set('sections', form.sections.map((x) => (x.name === name ? { ...x, roundingUnit: unit } : x)))
  const reorder = (ids: string[]) =>
    set('sections', ids.map((id) => form.sections.find((s) => s.name === id)!))

  return (
    <div className={styles.info}>
      <FormErrorBanner message={error} />

      <SectionSurface title={PRICEBOOK.infoProduct}>
        <div className={styles.infoGrid}>
          <div className={`${styles.field} ${styles.wide}`}>
            <label className="label" htmlFor="pi-name">{PRICEBOOK.productName}</label>
            <input id="pi-name" className="input-field" value={form.name} onChange={(e) => set('name', e.target.value)} />
          </div>
          <div className={styles.field}>
            <label className="label" htmlFor="pi-type">{PRICEBOOK.businessType}</label>
            <select id="pi-type" className="input-field" value={form.type} onChange={(e) => set('type', e.target.value)}>
              {BUSINESS_TYPE_ORDER.map((k) => <option key={k} value={k}>{BUSINESS_TYPE_LABEL[k]}</option>)}
            </select>
          </div>
          <div className={`${styles.field} ${styles.full}`}>
            <label className="label" htmlFor="pi-desc">{PRICEBOOK.remark}</label>
            <textarea id="pi-desc" className="input-field" rows={3} value={form.desc} onChange={(e) => set('desc', e.target.value)} />
          </div>
        </div>
      </SectionSurface>

      <SectionSurface title={PRICEBOOK.infoCost} meta={PRICEBOOK.infoCostMeta}>
        <div className={styles.yearRow}>
          <div className={styles.field}>
            <label className="label" htmlFor="pi-tco">{PRICEBOOK.tcoYears}</label>
            <div className={styles.unitInput}>
              <input id="pi-tco" className="input-field" inputMode="numeric" value={form.tco} onChange={(e) => set('tco', digits(e.target.value))} />
              <span aria-hidden>{PRICEBOOK.yearUnit}</span>
            </div>
          </div>
          <div className={styles.field}>
            <label className="label" htmlFor="pi-free">{PRICEBOOK.freeYears}</label>
            <div className={styles.unitInput}>
              <input id="pi-free" className="input-field" inputMode="numeric" value={form.free} onChange={(e) => set('free', digits(e.target.value))} />
              <span aria-hidden>{PRICEBOOK.yearUnit}</span>
            </div>
          </div>
        </div>
        <p className={styles.formula}>{PRICEBOOK.tcoExplain(years, free)}</p>
      </SectionSurface>

      <SectionSurface title={PRICEBOOK.section} meta={PRICEBOOK.sectionsMeta}>
        <p className={styles.small}>{PRICEBOOK.sectionsHint}</p>
        <ReorderList
          items={form.sections}
          getId={(s) => s.name}
          getLabel={(s) => s.name}
          onReorder={reorder}
          disabled={busy !== null}
          className={styles.sectionList}
        >
          {(s, _i, controls) => (
            <div className={styles.sectionRow}>
              <span className={styles.sectionCtrl}>{controls}</span>
              <span className={styles.sectionName}>{s.name}</span>
              <select className="input-field" aria-label={`${s.name} ${PRICEBOOK.sectionRounding}`} value={s.roundingUnit}
                onChange={(e) => setRounding(s.name, Number(e.target.value))}>
                {ROUNDING_UNITS.map((u) => (
                  <option key={u} value={u}>{u === 0 ? PRICEBOOK.roundingNone : PRICEBOOK.roundingUnder(roundingUnitName(u) ?? u.toLocaleString('ko-KR'))}</option>
                ))}
              </select>
            </div>
          )}
        </ReorderList>
      </SectionSurface>

      <SectionSurface
        title={PRICEBOOK.saleStatus}
        meta={<NbBadge status={p.isActive ? 'done' : 'note'}>{p.isActive ? PRICEBOOK.onSale : PRICEBOOK.stopped}</NbBadge>}
      >
        <div className={styles.saleRow}>
          <p className={styles.small}>{p.isActive ? PRICEBOOK.onSaleHint : PRICEBOOK.offSaleHint}</p>
          <NbButton variant={p.isActive ? 'danger-ghost' : 'ghost'} disabled={busy !== null} onClick={() => void patch({ isActive: !p.isActive }, 'sale')}>
            {busy === 'sale' ? progress(p.isActive ? PRICEBOOK.stopSale : PRICEBOOK.resumeSale) : (p.isActive ? PRICEBOOK.stopSale : PRICEBOOK.resumeSale)}
          </NbButton>
        </div>
      </SectionSurface>

      <div className={styles.saveBar} data-dirty={dirty || undefined}>
        <span className={styles.saveState} role="status">{dirty ? PRICEBOOK.unsaved : PRICEBOOK.noChanges}</span>
        <NbButton variant="ghost" disabled={!dirty || busy !== null} onClick={() => setForm(start)}>{PRICEBOOK.discardChanges}</NbButton>
        <NbButton disabled={!dirty || busy !== null || !form.name.trim()} onClick={save}>
          {busy === 'save' ? progress(ACTION.save) : ACTION.save}
        </NbButton>
      </div>
    </div>
  )
}
