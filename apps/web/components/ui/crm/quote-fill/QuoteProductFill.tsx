'use client'

// 제품으로 채우기 — 제품을 고르고 조건 몇 개를 넣으면 가격 기준대로 묶음과 줄이 채워진다.
//
// 말하지 않은 조건(에디션, 노드, 유지보수, 할인)은 엔진이 채우고 「자동으로 채운 값」에 한 줄씩 남는다.
// 계산은 서버의 미리 계산 창구가 한다 — 견적 저장과 같은 엔진이다. 여기서는 셈을 하지 않는다.
// 기관 종류는 딜의 회사 도메인에서 읽어 채워 둔다(학교면 교육기관 할인이 제안값으로 들어간다).

import { useCallback, useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import Sensitive from '@/components/crm/Sensitive'
import { ACTION, PRICEBOOK, PROVENANCE_LABEL, progress } from '@/lib/terms'
import { COMPANY_KIND_LABEL, kindFromDomain, type CompanyKind } from '@/lib/crm/domain/company-kind'
import type { QuoteDraft } from '../quote-draft-shape'
import { applyProductFill, type AutoFilledJson, type EngineLineJson } from './product-fill-apply'
import styles from './quote-fill.module.css'

interface Props {
  dealId: string
  draft: QuoteDraft
  onDraftChange: (fn: (prev: QuoteDraft) => QuoteDraft) => void
  onClose: () => void
}

interface ProductRow { id: string; name: string }
interface ItemRow { id: string; name: string; section: string | null; basis: string; isActive: boolean }
interface GpuDraft { model: string; count: string; timed: boolean }
interface Preview {
  result: {
    lines: EngineLineJson[]
    composed: { lines: { key: string; amounts: { lineTotalMinor: string } }[] }
    onceSupplyMinor: string
    annualSupplyMinor: string
    autoFilled: AutoFilledJson[]
    violations: { level: string; message: string }[]
  }
}

const won = (v: string) => `${Number(v).toLocaleString('ko-KR')}원`

export default function QuoteProductFill({ dealId, draft, onDraftChange, onClose }: Props) {
  const prior = (draft.fillConditions ?? null) as { productId?: string; conditions?: Record<string, unknown> } | null
  const [products, setProducts] = useState<ProductRow[]>([])
  const [productId, setProductId] = useState<string>(prior?.productId ?? '')
  const [items, setItems] = useState<ItemRow[]>([])
  const [sections, setSections] = useState<{ name: string; roundingUnit: number }[]>([])
  const [picked, setPicked] = useState<string[]>(Array.isArray(prior?.conditions?.picked) ? prior!.conditions!.picked as string[] : [])
  const [gpus, setGpus] = useState<GpuDraft[]>([{ model: '', count: '', timed: false }])
  const [nodes, setNodes] = useState('')
  const [kind, setKind] = useState<CompanyKind | ''>('')
  const [out, setOut] = useState<Preview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/crm/pricebook/products', { cache: 'no-store' })
        const body = await res.json()
        if (res.ok) setProducts(body.items ?? [])
        if (res.ok && !productId && body.items?.length === 1) setProductId(body.items[0].id)
      } catch { setError('제품 목록을 불러오지 못했어요.') }
      // 기관 종류는 딜 회사의 도메인에서 — 못 읽으면 비워 두고 사람이 고른다
      try {
        const deal = await (await fetch(`/api/crm/deals/${dealId}`)).json()
        if (deal?.companyId) {
          const company = await (await fetch(`/api/crm/companies/${deal.companyId}`)).json()
          const guess = kindFromDomain(company?.domain ?? null)
          if (guess) setKind(guess.kind)
        }
      } catch { /* 기관 종류를 못 읽어도 채우기는 된다 */ }
    })()
  }, [dealId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!productId) return
    void (async () => {
      try {
        const res = await fetch(`/api/crm/pricebook/products/${productId}`, { cache: 'no-store' })
        const body = await res.json()
        if (!res.ok) { setError(body?.error?.message ?? '제품을 불러오지 못했어요.'); return }
        setItems((body.items ?? []).filter((i: ItemRow) => i.isActive))
        setSections(Array.isArray(body.product?.sections) ? body.product.sections : [])
      } catch { setError('제품을 불러오지 못했어요.') }
    })()
  }, [productId])

  const conditions = useCallback(() => ({
    picked,
    gpus: gpus.filter((g) => g.model.trim() && Number(g.count) > 0).map((g) => ({ model: g.model.trim(), count: Number(g.count), timed: g.timed })),
    nodes: nodes === '' ? null : Number(nodes),
    training: null,
    companyKind: kind || null,
    discount: kind ? 'auto' : 'none',
  }), [picked, gpus, nodes, kind])

  const run = async () => {
    if (!productId) { setError('제품을 고르세요.'); return }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/crm/pricebook/products/${productId}/preview`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conditions: conditions() }),
      })
      const body = await res.json()
      if (!res.ok) { setError(body?.error?.message ?? '계산하지 못했어요.'); return }
      setOut(body)
    } catch {
      setError('계산하지 못했어요. 잠시 후 다시 시도해 주세요.')
    } finally {
      setBusy(false)
    }
  }

  const put = () => {
    if (!out) return
    const name = products.find((p) => p.id === productId)?.name ?? ''
    onDraftChange((prev) => applyProductFill(prev, {
      productId, productName: name, sections, lines: out.result.lines, autoFilled: out.result.autoFilled, conditions: conditions(),
    }))
    onClose()
  }

  // 고를 품목 — 수량을 GPU 장수나 노드에서 받는 품목은 고르지 않는다(엔진이 넣는다)
  const choosable = items.filter((i) => i.basis !== 'PER_UNIT')
  const blocks = out?.result.violations.filter((v) => v.level === 'block') ?? []

  return (
    <section className={styles.panel} aria-label={PRICEBOOK.fillByProduct}>
      <div className={styles.row}>
        <label className="label" htmlFor="pf-product">{PRICEBOOK.tabProduct}</label>
        <select id="pf-product" className="input-field" value={productId} onChange={(e) => { setProductId(e.target.value); setOut(null) }}>
          <option value="">—</option>
          {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      {productId && (
        <>
          <fieldset className={styles.fieldset}>
            <legend className="label">{PRICEBOOK.conditions}</legend>
            <div className={styles.checks}>
              {choosable.map((i) => (
                <label key={i.id}>
                  <input type="checkbox" checked={picked.includes(i.id)} onChange={() => setPicked((p) => (p.includes(i.id) ? p.filter((x) => x !== i.id) : [...p, i.id]))} /> {i.name}
                </label>
              ))}
            </div>
            {gpus.map((g, k) => (
              <div key={k} className={styles.gpuRow}>
                <input className="input-field" aria-label="GPU 모델" placeholder="H100 SXM" value={g.model} onChange={(e) => setGpus((gs) => gs.map((x, j) => (j === k ? { ...x, model: e.target.value } : x)))} />
                <input className="input-field" aria-label="장수" inputMode="numeric" placeholder="장수" value={g.count} onChange={(e) => setGpus((gs) => gs.map((x, j) => (j === k ? { ...x, count: e.target.value.replace(/\D/g, '') } : x)))} />
                <label><input type="checkbox" checked={g.timed} onChange={(e) => setGpus((gs) => gs.map((x, j) => (j === k ? { ...x, timed: e.target.checked } : x)))} /> 지정 시간</label>
                <NbButton variant="ghost" aria-label={ACTION.delete} onClick={() => setGpus((gs) => gs.filter((_, j) => j !== k))}><Trash2 size={14} /></NbButton>
              </div>
            ))}
            <div className={styles.inline}>
              <NbButton variant="ghost" onClick={() => setGpus((gs) => [...gs, { model: '', count: '', timed: false }])}><Plus size={14} /> GPU</NbButton>
              <input className="input-field" aria-label="노드 수" inputMode="numeric" placeholder="노드 수(비우면 기본 포함)" value={nodes} onChange={(e) => setNodes(e.target.value.replace(/\D/g, ''))} />
              <select className="input-field" aria-label="기관 종류" value={kind} onChange={(e) => setKind(e.target.value as CompanyKind | '')}>
                <option value="">할인 없음</option>
                {(Object.keys(COMPANY_KIND_LABEL) as CompanyKind[]).map((k) => <option key={k} value={k}>{COMPANY_KIND_LABEL[k]}</option>)}
              </select>
            </div>
          </fieldset>
          <div className={styles.actions}>
            <NbButton variant="ghost" onClick={onClose}>{ACTION.cancel}</NbButton>
            <NbButton onClick={() => void run()} disabled={busy}>{busy ? progress(PRICEBOOK.previewRun) : PRICEBOOK.previewRun}</NbButton>
          </div>
        </>
      )}
      {error && <p role="alert" className={styles.alert}>{error}</p>}
      {out && (
        <div className={styles.result}>
          {out.result.violations.map((v, k) => <p key={k} className={v.level === 'block' ? styles.alert : styles.small}>{v.message}</p>)}
          <p>
            {PRICEBOOK.previewOnce} <b><Sensitive>{won(out.result.onceSupplyMinor)}</Sensitive></b>
            {out.result.annualSupplyMinor !== '0' && <> · {PRICEBOOK.previewAnnual} <b><Sensitive>{won(out.result.annualSupplyMinor)}</Sensitive></b></>}
            <span className={styles.small}> · 줄 {out.result.lines.length}개</span>
          </p>
          {out.result.autoFilled.length > 0 && (
            <ul className={styles.small}>
              {out.result.autoFilled.map((a, k) => (
                <li key={k}>{a.field} {a.value}: {a.provenance.note ?? PROVENANCE_LABEL[a.provenance.source as keyof typeof PROVENANCE_LABEL] ?? a.provenance.source}</li>
              ))}
            </ul>
          )}
          <div className={styles.actions}>
            <NbButton onClick={put} disabled={blocks.length > 0 && out.result.lines.length === 0}>{PRICEBOOK.putInQuote}</NbButton>
          </div>
        </div>
      )}
    </section>
  )
}
