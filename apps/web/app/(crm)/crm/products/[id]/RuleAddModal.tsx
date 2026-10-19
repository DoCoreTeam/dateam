'use client'

// 규칙 하나 더하기 — 종류마다 고를 칸이 다르다. 종류는 일곱으로 닫혀 있다.

import { useState } from 'react'
import NbModal from '@/components/ui/nb/NbModal'
import NbButton from '@/components/ui/nb/NbButton'
import FormErrorBanner from '@/components/ui/FormErrorBanner'
import { ACTION, PRICEBOOK, RULE_KIND_LABEL, VAR_LABEL, GPU_CLASS_LABEL } from '@/lib/terms'
import { COMPANY_KIND_LABEL, type CompanyKind } from '@/lib/crm/domain/company-kind'
import { RULE_KINDS, VAR_KEYS, type GpuClass, type PriceRule, type RuleKind, type VarKey } from '@/lib/crm/domain/pricebook/types'
import type { ItemJson } from './detail-shape'
import styles from './detail.module.css'

interface Props {
  items: ItemJson[]
  discountOnly: boolean
  onClose: () => void
  onAdd: (rule: PriceRule) => void
}

const CLASSES: GpuClass[] = ['DC', 'WS', 'CONSUMER', 'NPU']
const KINDS_WITH_LIST: RuleKind[] = ['ONE_OF', 'WITH', 'INCLUDES']

export default function RuleAddModal({ items, discountOnly, onClose, onAdd }: Props) {
  const kinds = discountOnly ? (['DISCOUNT'] as RuleKind[]) : RULE_KINDS.filter((k) => k !== 'DISCOUNT')
  const [kind, setKind] = useState<RuleKind>(kinds[0])
  const [item, setItem] = useState(items[0]?.id ?? '')
  const [list, setList] = useState<string[]>([])
  const [varKey, setVarKey] = useState<VarKey>('gpu.total')
  const [num, setNum] = useState('')
  const [minus, setMinus] = useState(false)
  const [classes, setClasses] = useState<GpuClass[]>(['WS', 'CONSUMER', 'NPU'])
  const [companyKind, setCompanyKind] = useState<CompanyKind | 'partner'>('school')
  const [label, setLabel] = useState('')
  const [includesVar, setIncludesVar] = useState(false)
  const sections = [...new Set(items.map((i) => i.section ?? '기타'))]
  const [section, setSection] = useState(sections[0] ?? '')
  const [error, setError] = useState<string | null>(null)

  const toggle = (id: string) => setList((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]))

  const build = (): PriceRule | string => {
    const n = Number(num)
    switch (kind) {
      case 'ONE_OF': return list.length >= 2 ? { kind, items: list } : '품목을 둘 이상 고르세요'
      case 'WITH': return list.length ? { kind, item, with: list } : '같이 들어갈 품목을 고르세요'
      case 'INCLUDES':
        if (includesVar) return n > 0 ? { kind, item, varKey, qty: n } : '기본 포함 수를 넣으세요'
        return list.length ? { kind, item, items: list } : '기본 포함할 품목을 고르세요'
      case 'QTY_FROM': return { kind, item, varKey, minusIncluded: minus }
      case 'CAP': return n > 0 ? { kind, item, varKey, max: n } : '상한을 넣으세요'
      case 'ELIGIBLE': return classes.length ? { kind, item, classes } : '구분을 하나 이상 고르세요'
      case 'SCALE_CAP':
        return n > 0 && section ? { kind, section, varKey, perUnitMinor: Math.round(n) } : '묶음과 단위 금액(원)을 넣으세요'
      case 'DISCOUNT':
        if (!(n >= 0 && n <= 100) || num === '') return '할인율을 0에서 100 사이로 넣으세요'
        return { kind, companyKind, pct: n, confirmed: false, label: label.trim() || (companyKind === 'partner' ? '파트너 공급' : COMPANY_KIND_LABEL[companyKind]) }
    }
  }

  const add = () => {
    const r = build()
    if (typeof r === 'string') { setError(r); return }
    onAdd(r)
  }

  const needsItem = kind !== 'ONE_OF' && kind !== 'DISCOUNT' && kind !== 'SCALE_CAP'
  const needsList = KINDS_WITH_LIST.includes(kind) && !(kind === 'INCLUDES' && includesVar)
  const needsVar = kind === 'QTY_FROM' || kind === 'CAP' || kind === 'SCALE_CAP' || (kind === 'INCLUDES' && includesVar)

  return (
    <NbModal
      title={discountOnly ? `${PRICEBOOK.detailDiscounts} 추가` : `${PRICEBOOK.detailRules} 추가`}
      onClose={onClose}
      maxWidth={600}
      footer={(
        <div className={styles.foot}>
          <NbButton variant="ghost" onClick={onClose}>{ACTION.cancel}</NbButton>
          <NbButton onClick={add}>{ACTION.save}</NbButton>
        </div>
      )}
    >
      <div className={styles.form}>
        <FormErrorBanner message={error} />
        {!discountOnly && (
          <div className={styles.field}>
            <label className="label" htmlFor="ra-kind">{PRICEBOOK.detailRules}</label>
            <select id="ra-kind" className="input-field" value={kind} onChange={(e) => { setKind(e.target.value as RuleKind); setList([]) }}>
              {kinds.map((k) => <option key={k} value={k}>{RULE_KIND_LABEL[k]}</option>)}
            </select>
          </div>
        )}
        {kind === 'INCLUDES' && (
          <label className="label" style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <input type="checkbox" checked={includesVar} onChange={(e) => setIncludesVar(e.target.checked)} /> 품목이 아니라 수를 기본 포함(노드 20대 같은 것)
          </label>
        )}
        {needsItem && (
          <div className={styles.field}>
            <label className="label" htmlFor="ra-item">{PRICEBOOK.tabItem}</label>
            <select id="ra-item" className="input-field" value={item} onChange={(e) => setItem(e.target.value)}>
              {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
          </div>
        )}
        {needsList && (
          <fieldset className={styles.field} style={{ border: 0, padding: 0 }}>
            <legend className="label">{kind === 'ONE_OF' ? '하나만 고를 품목' : kind === 'WITH' ? '같이 들어갈 품목' : '기본 포함할 품목'}</legend>
            <div className={styles.checks}>
              {items.filter((i) => kind === 'ONE_OF' || i.id !== item).map((i) => (
                <label key={i.id}><input type="checkbox" checked={list.includes(i.id)} onChange={() => toggle(i.id)} /> {i.name}</label>
              ))}
            </div>
          </fieldset>
        )}
        {needsVar && (
          <div className={styles.field}>
            <label className="label" htmlFor="ra-var">{PRICEBOOK.conditions}</label>
            <select id="ra-var" className="input-field" value={varKey} onChange={(e) => setVarKey(e.target.value as VarKey)}>
              {VAR_KEYS.map((v) => <option key={v} value={v}>{VAR_LABEL[v]}</option>)}
            </select>
          </div>
        )}
        {kind === 'SCALE_CAP' && (
          <div className={styles.field}>
            <label className="label" htmlFor="ra-section">{PRICEBOOK.section}</label>
            <select id="ra-section" className="input-field" value={section} onChange={(e) => setSection(e.target.value)}>
              {sections.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        )}
        {(kind === 'CAP' || (kind === 'INCLUDES' && includesVar) || kind === 'DISCOUNT' || kind === 'SCALE_CAP') && (
          <div className={styles.field}>
            <label className="label" htmlFor="ra-num">{kind === 'CAP' ? '상한' : kind === 'DISCOUNT' ? '할인율(%)' : kind === 'SCALE_CAP' ? '단위 금액(원)' : '기본 포함 수'}</label>
            <input id="ra-num" className="input-field" inputMode="decimal" value={num} onChange={(e) => setNum(e.target.value)} />
          </div>
        )}
        {kind === 'QTY_FROM' && (
          <label className="label" style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <input type="checkbox" checked={minus} onChange={(e) => setMinus(e.target.checked)} /> 기본 포함 수를 빼고 센다(추가 노드처럼)
          </label>
        )}
        {kind === 'ELIGIBLE' && (
          <div className={styles.checks}>
            {CLASSES.map((c) => (
              <label key={c}><input type="checkbox" checked={classes.includes(c)} onChange={() => setClasses((cs) => (cs.includes(c) ? cs.filter((x) => x !== c) : [...cs, c]))} /> {GPU_CLASS_LABEL[c]}</label>
            ))}
          </div>
        )}
        {kind === 'DISCOUNT' && (
          <div className={styles.row}>
            <div className={styles.field}>
              <label className="label" htmlFor="ra-ck">기관 종류</label>
              <select id="ra-ck" className="input-field" value={companyKind} onChange={(e) => setCompanyKind(e.target.value as CompanyKind | 'partner')}>
                {(Object.keys(COMPANY_KIND_LABEL) as CompanyKind[]).map((k) => <option key={k} value={k}>{COMPANY_KIND_LABEL[k]}</option>)}
                <option value="partner">파트너 공급</option>
              </select>
            </div>
            <div className={styles.field}>
              <label className="label" htmlFor="ra-label">이름</label>
              <input id="ra-label" className="input-field" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="교육기관" />
            </div>
          </div>
        )}
      </div>
    </NbModal>
  )
}
