'use client'

// 파일로 가져오기 — 가격 기준 세 탭과 제품 상세가 같이 쓴다
//
// 올리기 → 읽기(AI 가 적힌 그대로 옮기고 규칙이 검증 2~6) → 나란히 보기(검증 7) → 저장(한 트랜잭션).
// 걸린 줄도 채운 채로 저장한다. 그 줄만 색이 다르고 「확인 전」으로 남아 견적의 자동 채움 기준에서 빠진다.

import { useEffect, useRef, useState } from 'react'
import NbModal from '@/components/ui/nb/NbModal'
import NbButton from '@/components/ui/nb/NbButton'
import FormErrorBanner from '@/components/ui/FormErrorBanner'
import WaitProgress from '@/components/ui/WaitProgress'
import { ACTION, PRICEBOOK, IMPORT_CHECK_LABEL, RULE_KIND_LABEL, progress } from '@/lib/terms'
import { waitProgress } from '@/lib/ui/wait-progress'
import styles from './pricebook.module.css'

export type ImportTarget = 'product' | 'items' | 'labor'

interface DraftItemJson { id: string; name: string; section: string; listPriceMinor: string | null; basis: string; ratioPct: number | null; needsReview: boolean; problems: string[] }
interface DraftJson {
  target: ImportTarget
  product: { name: string } | null
  items: DraftItemJson[]
  rules: { rule: { kind: string }; disabledReason: string | null }[]
  exampleChecks: { label: string; ok: boolean; mismatches: string[] }[]
  grades: { name: string; publicRateMinor: string | null; pricePerMmMinor: string | null; problems: string[] }[]
  diff: { changed: unknown[]; added: string[]; removed: string[] } | null
  productNeedsReview: boolean
  notes: string[]
  sourceChecked: boolean
}
interface ReadJson { draft: DraftJson; sourceText: string; fileName: string; route: 'text' | 'vision' }

interface Props {
  target: ImportTarget
  productId?: string | null
  onClose: () => void
  onSaved: (productId: string | null) => void
}

const won = (v: string | null) => (v === null ? PRICEBOOK.survey : `${Number(v).toLocaleString('ko-KR')}원`)
const TICK_MS = 1_000

export default function PricebookImportModal({ target, productId = null, onClose, onSaved }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState<'read' | 'save' | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [out, setOut] = useState<ReadJson | null>(null)

  useEffect(() => {
    if (busy !== 'read') return
    const started = Date.now()
    const t = setInterval(() => setElapsed(Date.now() - started), TICK_MS)
    return () => clearInterval(t)
  }, [busy])

  const read = async () => {
    const file = fileRef.current?.files?.[0]
    if (!file) { setError('가격표 파일을 골라 주세요.'); return }
    setBusy('read')
    setElapsed(0)
    setError(null)
    try {
      const form = new FormData()
      form.set('file', file)
      form.set('target', target)
      if (productId) form.set('productId', productId)
      const res = await fetch('/api/crm/pricebook/import', { method: 'POST', body: form })
      const body = await res.json()
      if (!res.ok) { setError(body?.error?.message ?? '파일을 읽지 못했어요.'); return }
      setOut(body)
    } catch {
      setError('파일을 읽지 못했어요. 잠시 후 다시 시도해 주세요.')
    } finally {
      setBusy(null)
    }
  }

  const save = async () => {
    if (!out) return
    setBusy('save')
    setError(null)
    try {
      const res = await fetch('/api/crm/pricebook/import/save', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draft: out.draft, sourceText: out.sourceText, fileName: out.fileName, productId }),
      })
      const body = await res.json()
      if (!res.ok) { setError(body?.error?.message ?? '저장하지 못했어요.'); return }
      onSaved(body.productId ?? null)
    } catch {
      setError('저장하지 못했어요. 잠시 후 다시 시도해 주세요.')
    } finally {
      setBusy(null)
    }
  }

  const d = out?.draft
  const flagged = d ? d.items.filter((i) => i.needsReview).length + d.grades.filter((g) => g.problems.length).length : 0
  const w = waitProgress(elapsed, '가격표를 옮기고 원문과 대조하고 있어요')

  return (
    <NbModal
      title={PRICEBOOK.importFile}
      onClose={onClose}
      maxWidth={1040}
      footer={(
        <div className={styles.foot}>
          <NbButton variant="ghost" onClick={onClose} disabled={busy !== null}>{ACTION.cancel}</NbButton>
          {!out ? (
            <NbButton onClick={() => void read()} disabled={busy !== null}>{busy === 'read' ? progress('읽기') : '읽기'}</NbButton>
          ) : (
            <NbButton onClick={() => void save()} disabled={busy !== null}>{busy === 'save' ? progress(ACTION.save) : ACTION.save}</NbButton>
          )}
        </div>
      )}
    >
      <div className={styles.form}>
        <FormErrorBanner message={error} />
        {!out && (
          <div className={styles.field}>
            <label className="label" htmlFor="pb-file">엑셀, PDF, 워드, 한글, 이미지</label>
            <input id="pb-file" ref={fileRef} type="file" className="input-field" accept=".xlsx,.xls,.csv,.pdf,.docx,.hwp,.hwpx,.png,.jpg,.jpeg" />
          </div>
        )}
        {busy === 'read' && <WaitProgress message={w.message} elapsedLabel={w.elapsedLabel} reassure={w.reassure} />}
        {d && out && (
          <>
            <p>
              {d.product ? <b>{d.product.name} · </b> : null}
              품목 {d.items.length}줄{d.grades.length ? ` · 등급 ${d.grades.length}줄` : ''}
              {flagged > 0 && <> · <b>{PRICEBOOK.needsReview} {flagged}줄</b></>}
              {d.productNeedsReview && <> · 제품 전체 {PRICEBOOK.needsReview}</>}
            </p>
            {!d.sourceChecked && <p className={styles.small}>{IMPORT_CHECK_LABEL.source}: 그림으로 읽어 원문 글이 없어 대조를 못 했어요.</p>}
            {d.exampleChecks.map((c, k) => (
              <p key={k} className={styles.small}>{IMPORT_CHECK_LABEL.example}: {c.ok ? PRICEBOOK.previewMatches : `${PRICEBOOK.previewDiffers} (${c.mismatches.join(', ')})`}</p>
            ))}
            {d.diff && <p className={styles.small}>{IMPORT_CHECK_LABEL.diff}: 바뀐 정상가 {d.diff.changed.length} · 새 품목 {d.diff.added.length} · 없어진 품목 {d.diff.removed.length}(판매 중지로 둠)</p>}
            {d.notes.map((n, k) => <p key={k} className={styles.small}>{n}</p>)}
            <div className={styles.side}>
              {out.sourceText && <pre className={styles.source} aria-label={IMPORT_CHECK_LABEL.side}>{out.sourceText}</pre>}
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <tbody>
                    {d.items.map((i) => (
                      <tr key={i.id} className={i.needsReview ? styles.review : undefined}>
                        <td>{i.section}</td>
                        <td>{i.name}{i.problems.map((p) => <div key={p} className={styles.small}>{p}</div>)}</td>
                        <td className={styles.num}>{i.basis === 'RATIO' ? `${i.ratioPct ?? 0}%` : won(i.listPriceMinor)}</td>
                      </tr>
                    ))}
                    {d.grades.map((g) => (
                      <tr key={g.name} className={g.problems.length ? styles.review : undefined}>
                        <td>{PRICEBOOK.gradeName}</td>
                        <td>{g.name}{g.problems.map((p) => <div key={p} className={styles.small}>{p}</div>)}</td>
                        <td className={styles.num}>{won(g.publicRateMinor ?? g.pricePerMmMinor)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {d.rules.length > 0 && (
                  <ul className={styles.small}>
                    {d.rules.map((r, k) => (
                      <li key={k}>{RULE_KIND_LABEL[r.rule.kind as keyof typeof RULE_KIND_LABEL] ?? r.rule.kind}{r.disabledReason ? ` · 끈 채로 저장: ${r.disabledReason}` : ''}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </NbModal>
  )
}
