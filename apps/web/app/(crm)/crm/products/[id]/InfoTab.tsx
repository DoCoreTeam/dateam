'use client'

// 제품 기본 정보 — 제품, 묶음(더하기, 이름 바꾸기, 지우기, 순서, 절사), 판매 상태
//
// 「몇 년 총비용」 칸은 여기 두지 않는다. 견적에는 안 쓰이고 미리 계산의 총비용 한 줄에만 쓰여
// 사람이 「가격 기준인데 왜 여기?」로 읽었다(사용자 지적 2026-10-20). 미리 계산 탭의 그 줄 옆으로 옮겼다.
//
// 칸마다 이름과 단위를 붙이고 그 값이 견적에 어떻게 쓰이는지 그 자리에서 말한다.
// 예전엔 이름 없는 숫자 칸 둘에 「앞 칸은 년수, 뒤 칸은 무상 년수」 안내가 붙어 있었다(사용자 지적 2026-10-20).
// 판매 중지는 곧바로 저장되는 상태 전환이라 폼 저장 단추와 떨어진 자리에 둔다.

import { useMemo, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import NbBadge from '@/components/ui/nb/NbBadge'
import FormErrorBanner from '@/components/ui/FormErrorBanner'
import SectionSurface from '@/components/ui/SectionSurface'
import ReorderList from '@/components/ui/ReorderList'
import { ACTION, PRICEBOOK, BUSINESS_TYPE_LABEL, BUSINESS_TYPE_ORDER, progress } from '@/lib/terms'
import { roundingUnitName } from '@/lib/terms/quote'
import { ROUNDING_UNITS } from '@/lib/crm/domain/quote-math'
import { SUPPLY_ROUNDING_UNITS } from '@/lib/crm/domain/quote-compose'
import type { DetailJson, SectionJson } from './detail-shape'
import styles from './detail.module.css'

interface Props { data: DetailJson; onSaved: () => void }

/** 묶음 한 줄 — 원래 이름을 들고 있어야 이름 바꾸기를 서버가 품목과 규칙까지 따라 고친다 */
interface SectionRow extends SectionJson { key: string; orig: string | null }

type StackMode = DetailJson['product']['discountStackMode']

const STACK_MODES: readonly StackMode[] = ['MAX', 'MULTIPLY', 'ADD']

interface FormState { name: string; type: string; desc: string; sections: SectionRow[]; stackMode: StackMode; supplyRounding: number }

function initialForm(data: DetailJson): FormState {
  const p = data.product
  const itemSections = [...new Set(data.items.map((i) => i.section ?? '기타'))]
  return {
    name: p.name,
    type: p.businessTypeKey,
    desc: p.descriptionMd ?? '',
    stackMode: p.discountStackMode ?? 'MAX',
    supplyRounding: p.supplyRoundingUnit ?? 0,
    sections: [
      ...p.sections,
      ...itemSections.filter((s) => !p.sections.some((x) => x.name === s)).map((name) => ({ name, roundingUnit: 0 })),
    ].map((x) => ({ ...x, key: x.name, orig: x.name })),
  }
}

export default function InfoTab({ data, onSaved }: Props) {
  const p = data.product
  const start = useMemo(() => initialForm(data), [data])
  const [form, setForm] = useState<FormState>(start)
  const [busy, setBusy] = useState<'save' | 'sale' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const dirty = JSON.stringify(form) !== JSON.stringify(start)
  const [newSection, setNewSection] = useState('')
  /** 판매 중인 품목 수 — 품목이 남은 묶음은 지우지 못한다(서버도 막는다) */
  const countOf = (name: string | null) => (name === null ? 0 : data.items.filter((i) => i.isActive && (i.section ?? '기타') === name).length)
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

  const names = form.sections.map((x) => x.name.trim())
  const nameClash = names.some((n, i) => n === '' || names.indexOf(n) !== i)

  const save = () => void patch({
    name: form.name, businessTypeKey: form.type, descriptionMd: form.desc, discountStackMode: form.stackMode, supplyRoundingUnit: form.supplyRounding,
    sections: form.sections.map((x) => ({ name: x.name.trim(), roundingUnit: x.roundingUnit })),
    sectionRenames: form.sections.filter((x) => x.orig && x.orig !== x.name.trim()).map((x) => ({ from: x.orig, to: x.name.trim() })),
  }, 'save')

  const setSection = (key: string, patchRow: Partial<SectionRow>) =>
    set('sections', form.sections.map((x) => (x.key === key ? { ...x, ...patchRow } : x)))
  const reorder = (ids: string[]) =>
    set('sections', ids.map((id) => form.sections.find((s) => s.key === id)!))
  const addSection = () => {
    const name = newSection.trim()
    if (!name || form.sections.some((x) => x.name.trim() === name)) return
    set('sections', [...form.sections, { key: `new-${Date.now()}`, orig: null, name, roundingUnit: 0 }])
    setNewSection('')
  }

  return (
    <div className={styles.info}>
      <FormErrorBanner message={error} />

      <SectionSurface
        title={PRICEBOOK.infoProduct}
        meta={`${PRICEBOOK.revisionLabel(p.revision ?? 1)}${p.effectiveFrom ? ` · ${PRICEBOOK.effectiveFrom} ${p.effectiveFrom.slice(0, 10)}` : ''}`}
      >
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

      <SectionSurface title={PRICEBOOK.section} meta={PRICEBOOK.sectionsMeta}>
        <p className={styles.small}>{PRICEBOOK.sectionsHint}</p>
        <ReorderList
          items={form.sections}
          getId={(s) => s.key}
          getLabel={(s) => s.name}
          onReorder={reorder}
          disabled={busy !== null}
          className={styles.sectionList}
        >
          {(s, _i, controls) => {
            const used = countOf(s.orig)
            return (
              <div className={styles.sectionRow}>
                <span className={styles.sectionCtrl}>{controls}</span>
                <input
                  className={`input-field ${styles.sectionName}`}
                  aria-label={PRICEBOOK.sectionRename(s.orig ?? s.name)}
                  value={s.name}
                  maxLength={100}
                  onChange={(e) => setSection(s.key, { name: e.target.value })}
                />
                <select className="input-field" aria-label={`${s.name} ${PRICEBOOK.sectionRounding}`} value={s.roundingUnit}
                  onChange={(e) => setSection(s.key, { roundingUnit: Number(e.target.value) })}>
                  {ROUNDING_UNITS.map((u) => (
                    <option key={u} value={u}>{u === 0 ? PRICEBOOK.roundingNone : PRICEBOOK.roundingUnder(roundingUnitName(u) ?? u.toLocaleString('ko-KR'))}</option>
                  ))}
                </select>
                <NbButton
                  variant="ghost"
                  disabled={busy !== null || used > 0}
                  title={used > 0 ? PRICEBOOK.sectionInUse(used) : undefined}
                  aria-label={`${s.name} ${ACTION.delete}`}
                  onClick={() => set('sections', form.sections.filter((x) => x.key !== s.key))}
                >
                  <Trash2 size={14} />
                </NbButton>
              </div>
            )
          }}
        </ReorderList>
        <div className={styles.sectionAdd}>
          <input
            className="input-field"
            aria-label={PRICEBOOK.sectionNew}
            placeholder={PRICEBOOK.sectionNew}
            value={newSection}
            maxLength={100}
            onChange={(e) => setNewSection(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); addSection() } }}
          />
          <NbButton variant="ghost" onClick={addSection} disabled={!newSection.trim()}><Plus size={14} /> {PRICEBOOK.sectionAdd}</NbButton>
        </div>
        {nameClash && <p className={styles.alert} role="alert">{PRICEBOOK.sectionNameClash}</p>}
      </SectionSurface>

      <SectionSurface title={PRICEBOOK.discountCalc}>
        <div className={styles.infoGrid}>
          <div className={styles.field}>
            <label className="label" htmlFor="pi-stack">{PRICEBOOK.stackMode}</label>
            <select id="pi-stack" className="input-field" value={form.stackMode} onChange={(e) => set('stackMode', e.target.value as StackMode)}>
              {STACK_MODES.map((m) => <option key={m} value={m}>{PRICEBOOK.stackModeLabel[m]}</option>)}
            </select>
          </div>
          <div className={styles.field}>
            <label className="label" htmlFor="pi-supply-round">{PRICEBOOK.supplyRounding}</label>
            <select id="pi-supply-round" className="input-field" value={form.supplyRounding} onChange={(e) => set('supplyRounding', Number(e.target.value))}>
              {SUPPLY_ROUNDING_UNITS.map((u) => (
                <option key={u} value={u}>{u === 0 ? PRICEBOOK.roundingNone : PRICEBOOK.roundingUnder(roundingUnitName(u) ?? u.toLocaleString('ko-KR'))}</option>
              ))}
            </select>
          </div>
        </div>
        <p className={styles.small}>{PRICEBOOK.stackModeHint}</p>
        <p className={styles.small}>{PRICEBOOK.supplyRoundingHint}</p>
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
        <NbButton disabled={!dirty || busy !== null || !form.name.trim() || nameClash} onClick={save}>
          {busy === 'save' ? progress(ACTION.save) : ACTION.save}
        </NbButton>
      </div>
    </div>
  )
}
