'use client'

// 딜의 견적 (딜 상세 우측)
//
// **왜 딜 안에 두나**: 견적은 딜의 금액이 어디서 나왔는지에 대한 답이다.
// 따로 메뉴를 만들면 "이 딜의 3,000만원은 무슨 근거지"를 물을 때 화면을 옮겨야 하고,
// 옮기는 순간 사람은 대충 넘어간다.
//
// 상태를 바꾸는 버튼은 **지금 할 수 있는 것만** 보여 준다. 전이 규칙은 서버의
// canTransitQuote 가 판정하므로, 여기서 버튼을 감추는 것은 안전장치가 아니라 안내다.

import { useCallback, useEffect, useState } from 'react'
import { FileText, Plus, Pencil, Trash2, RotateCcw } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import NbBadge from '@/components/ui/nb/NbBadge'
import EmptyState from '@/components/ui/EmptyState'
import ErrorState from '@/components/ui/ErrorState'
import AXDotLoader from '@/components/ui/AXDotLoader'
import { kstDateKey, formatKstDateTimeShort } from '@/lib/datetime/kst'
import { quoteStatusMeta } from '@/lib/crm/ui/quote-status'
import { formatAmount } from '@/app/(crm)/crm/deals/amount'
import QuoteEditorModal, { newQuoteDraft, type QuoteDraft } from './QuoteEditorModal'
import styles from './quote-panel.module.css'

interface QuoteLine {
  id: string
  /** 카탈로그의 어느 품목인지. 손으로 적기만 한 옛 항목은 null 이다 */
  productId: string | null
  name: string
  quantity: string
  unit: string | null
  unitPriceMinor: string
  discountPercent: string
  taxRate: string
}

interface Quote {
  id: string
  quoteNo: string
  title: string
  status: string
  currency: string
  validUntil: string | null
  subtotalMinor: string
  discountMinor: string
  taxMinor: string
  totalMinor: string
  discountRate: number
  approvalRequired: boolean
  approvedAt: string | null
  sentAt: string | null
  expired?: boolean
  version: number
  updatedAt: string
  lines?: QuoteLine[]
}

interface Props {
  dealId: string
  dealName: string
  dealCurrency: string | null
  /** 견적이 딜 금액을 바꿀 수 있다 — 바뀌면 상세를 다시 읽는다 */
  onChanged?: () => void
}

export default function QuotePanel({ dealId, dealName, dealCurrency, onChanged }: Props) {
  const [items, setItems] = useState<Quote[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [editing, setEditing] = useState<QuoteDraft | null>(null)
  /**
   * 휴지통은 별도 화면이 아니라 **보기 전환**이다(trash.tsx 와 같은 약속).
   * 지운 것을 찾으러 다른 메뉴로 가게 하면 사람은 지우기를 무서워한다.
   */
  const [trash, setTrash] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/crm/quotes?dealId=${encodeURIComponent(dealId)}${trash ? '&trash=1' : ''}`,
      )
      const body = await res.json()
      if (!res.ok) { setError(body?.error?.message ?? '견적을 불러오지 못했습니다.'); return }
      setItems(body.items ?? [])
    } catch {
      setError('견적을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setLoading(false)
    }
  }, [dealId, trash])

  useEffect(() => { void load() }, [load])

  /** 상태 전이·승인 — 실패는 조용히 삼키지 않고 그 자리에 띄운다 */
  const act = async (quote: Quote, path: string, payload: Record<string, unknown>) => {
    setBusyId(quote.id)
    setActionError(null)
    try {
      const res = await fetch(`/api/crm/quotes/${quote.id}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: quote.version, ...payload }),
      })
      const body = await res.json()
      if (!res.ok) {
        setActionError(body?.error?.message ?? '처리하지 못했습니다.')
        return
      }
      await load()
      onChanged?.()
    } catch {
      setActionError('처리하지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setBusyId(null)
    }
  }

  /**
   * 휴지통으로 보낸다. **되돌릴 수 있으므로 다시 묻지 않는다** —
   * 확인창은 되돌릴 수 없는 일에만 쓴다. 지운 것은 '지운 견적 보기'에서 되살린다.
   */
  const remove = async (quote: Quote) => {
    setBusyId(quote.id)
    setActionError(null)
    try {
      const res = await fetch(`/api/crm/quotes/${quote.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        setActionError(body?.error?.message ?? '지우지 못했습니다.')
        return
      }
      await load()
    } catch {
      setActionError('지우지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setBusyId(null)
    }
  }

  /** 수정하려면 항목까지 필요하다 — 목록에는 없으므로 그때 한 건만 더 읽는다 */
  const openEdit = async (quote: Quote) => {
    setActionError(null)
    try {
      const res = await fetch(`/api/crm/quotes/${quote.id}`)
      const body = await res.json()
      if (!res.ok) { setActionError(body?.error?.message ?? '견적을 불러오지 못했습니다.'); return }
      setEditing({
        id: body.id,
        version: body.version,
        title: body.title,
        currency: body.currency,
        validUntil: body.validUntil ? String(body.validUntil).slice(0, 10) : '',
        notesMd: body.notesMd ?? '',
        status: body.status,
        lines: (body.lines ?? []).map((l: QuoteLine) => ({
          id: l.id,
          // 카탈로그 연결을 들고 가지 않으면 저장하는 순간 손으로 친 이름으로 되돌아간다
          productId: l.productId ?? null,
          name: l.name,
          quantity: String(l.quantity),
          unit: l.unit ?? '',
          unitPriceMinor: String(l.unitPriceMinor),
          discountPercent: String(l.discountPercent),
          taxRate: String(l.taxRate),
        })),
      })
    } catch {
      setActionError('견적을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.')
    }
  }

  if (loading && items.length === 0) return <AXDotLoader />
  if (error) return <ErrorState message={error} onRetry={() => void load()} />

  return (
    <div className={styles.wrap}>
      {actionError && <ErrorState message={actionError} />}

      {items.length === 0 ? (
        trash ? (
          <EmptyState
            title="지운 견적이 없어요"
            description="지운 견적은 여기에 남고, 언제든 되살릴 수 있습니다."
            action={{ label: '견적으로 돌아가기', onClick: () => setTrash(false) }}
          />
        ) : (
          <EmptyState
            title="아직 견적이 없어요"
            description="무엇을 얼마에 제안했는지 적어 두면, 딜 금액의 근거가 남습니다."
            action={{
              label: '견적 작성',
              onClick: () => setEditing(newQuoteDraft(dealName, dealCurrency)),
            }}
          />
        )
      ) : (
        <>
          <ul className={styles.list}>
            {items.map((q) => {
              // 기한이 지난 건 서버가 읽는 시점에 판정해 준다 — 말과 색은 SSOT 가 정한다
              const meta = quoteStatusMeta(q)
              const busy = busyId === q.id
              return (
                <li className={styles.item} key={q.id}>
                  <div className={styles.itemTop}>
                    <span className={styles.quoteNo}>{q.quoteNo}</span>
                    <NbBadge status={meta.status}>{meta.label}</NbBadge>
                  </div>
                  <div className={styles.itemTitle}>{q.title}</div>
                  <div className={styles.amount}>{formatAmount(q.totalMinor, q.currency)}</div>
                  <div className={styles.meta}>
                    {q.discountRate > 0 && `할인 ${q.discountRate}% · `}
                    {q.validUntil ? `${kstDateKey(q.validUntil)}까지` : '기한 없음'}
                    {q.sentAt && ` · ${formatKstDateTimeShort(q.sentAt)} 보냄`}
                  </div>

                  {q.approvalRequired && !q.approvedAt && (
                    <div className={styles.meta} style={{ color: 'var(--warning)' }}>
                      할인이 커서 승인이 필요해요.
                    </div>
                  )}

                  <div className={styles.itemActions}>
                    {trash ? (
                      <NbButton variant="ghost" onClick={() => void act(q, '/restore', {})} disabled={busy}>
                        <RotateCcw size={14} /> 되살리기
                      </NbButton>
                    ) : (
                    <>
                    {q.status === 'DRAFT' && (
                      <>
                        <NbButton variant="ghost" onClick={() => void openEdit(q)} disabled={busy}>
                          <Pencil size={14} /> 수정
                        </NbButton>
                        {q.approvalRequired && !q.approvedAt && (
                          <NbButton variant="ghost" onClick={() => void act(q, '/approve', {})} disabled={busy}>
                            할인 승인
                          </NbButton>
                        )}
                        <NbButton onClick={() => void act(q, '/status', { to: 'SENT' })} disabled={busy}>
                          {busy ? '처리 중…' : '보냄으로 표시'}
                        </NbButton>
                      </>
                    )}
                    {q.status === 'SENT' && (
                      <>
                        <NbButton onClick={() => void act(q, '/status', { to: 'ACCEPTED' })} disabled={busy}>
                          수락됨
                        </NbButton>
                        <NbButton variant="ghost" onClick={() => void act(q, '/status', { to: 'REJECTED' })} disabled={busy}>
                          거절됨
                        </NbButton>
                        {q.expired && (
                          <NbButton variant="ghost" onClick={() => void act(q, '/status', { to: 'EXPIRED' })} disabled={busy}>
                            기한 지남으로 정리
                          </NbButton>
                        )}
                      </>
                    )}
                    {q.status === 'EXPIRED' && (
                      <NbButton variant="ghost" onClick={() => void act(q, '/status', { to: 'DRAFT' })} disabled={busy}>
                        초안으로 되돌려 고치기
                      </NbButton>
                    )}
                    {(q.status === 'ACCEPTED' || q.status === 'REJECTED') && (
                      <NbButton variant="ghost" onClick={() => void openEdit(q)} disabled={busy}>
                        <FileText size={14} /> 내용 보기
                      </NbButton>
                    )}
                    {/* 지우기는 초안에만 — 보낸 견적은 있었던 일의 기록이라 목록에서 치우지 않는다 */}
                    {q.status === 'DRAFT' && (
                      <NbButton variant="ghost" onClick={() => void remove(q)} disabled={busy}>
                        <Trash2 size={14} /> 지우기
                      </NbButton>
                    )}
                    </>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>

          {!trash && (
            <NbButton variant="ghost" onClick={() => setEditing(newQuoteDraft(dealName, dealCurrency))}>
              <Plus size={16} /> 견적 작성
            </NbButton>
          )}
        </>
      )}

      {/* 지운 것을 찾으러 다른 메뉴로 보내지 않는다 — 같은 자리에서 보기만 바꾼다 */}
      <button type="button" className={styles.trashToggle} onClick={() => setTrash((t) => !t)}>
        {trash ? '견적으로 돌아가기' : '지운 견적 보기'}
      </button>

      {editing && (
        <QuoteEditorModal
          dealId={dealId}
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void load(); onChanged?.() }}
        />
      )}
    </div>
  )
}
