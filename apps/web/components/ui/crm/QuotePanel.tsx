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
import { Copy, FileText, Plus, Pencil, Trash2, RotateCcw } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import NbBadge from '@/components/ui/nb/NbBadge'
import EmptyState from '@/components/ui/EmptyState'
import ErrorState from '@/components/ui/ErrorState'
import AXDotLoader from '@/components/ui/AXDotLoader'
import { kstDateKey, formatKstDateTimeShort } from '@/lib/datetime/kst'
import { quoteStatusMeta } from '@/lib/crm/ui/quote-status'
import { formatAmount } from '@/app/(crm)/crm/deals/amount'
import {
  ACTION,
  ENTITY,
  createLabel,
  progress,
  QUOTE,
} from '@/lib/terms'
import NbModal from '@/components/ui/nb/NbModal'
import QuoteEditorModal, { newQuoteDraft, quoteToDraft, type QuoteDraft } from './QuoteEditorModal'
import styles from './quote-panel.module.css'

interface QuoteLine {
  id: string
  descriptionMd?: string | null
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
  /** 개정 차수. 1 이면 첫 판 */
  revision?: number
  /** 다른 안의 이름 */
  variantLabel?: string | null
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
  /**
   * 「다른 안」 이름을 받는 중인 견적.
   *
   * **`window.prompt` 를 쓰지 않는다.** 브라우저 기본 대화상자는 우리 디자인 밖이고,
   * 페이지의 다른 동작을 통째로 막는다. 물어볼 것이 한 칸이어도 우리 모달을 쓴다.
   */
  const [variantOf, setVariantOf] = useState<Quote | null>(null)
  const [variantLabel, setVariantLabel] = useState('2안')
  const [editing, setEditing] = useState<QuoteDraft | null>(null)
  /**
   * 휴지통은 별도 화면이 아니라 **보기 전환**이다(trash.tsx 와 같은 약속).
   * 지운 것을 찾으러 다른 메뉴로 가게 하면 사람은 지우기를 무서워한다.
   */
  const [trash, setTrash] = useState(false)
  /** 새 견적의 기본 유효기간(일). 설정에서 오고, 서버가 목록과 함께 준다 */
  const [validDays, setValidDays] = useState(30)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // 저장·삭제 직후에 다시 읽는 경로다 — 캐시를 받으면 방금 한 일이 화면에 안 나타난다
      const res = await fetch(
        `/api/crm/quotes?dealId=${encodeURIComponent(dealId)}${trash ? '&trash=1' : ''}`,
        { cache: 'no-store' },
      )
      const body = await res.json()
      if (!res.ok) { setError(body?.error?.message ?? '견적을 불러오지 못했습니다.'); return }
      setItems(body.items ?? [])
      if (typeof body.defaultValidDays === 'number') setValidDays(body.defaultValidDays)
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
  /**
   * 개정본 · 다른 안 만들기.
   *
   * **보낸 견적을 고칠 길이 없어서** 영업은 견적을 처음부터 다시 썼고,
   * 그렇게 만든 것과 보낸 것 사이엔 아무 연결도 없었다 —
   * 나중에 「이게 그 건의 몇 번째지?」를 아무도 답할 수 없었다.
   */
  const duplicate = async (quote: Quote, mode: 'revision' | 'variant', label: string | null) => {
    setActionError(null)
    setBusyId(quote.id)
    try {
      const res = await fetch(`/api/crm/quotes/${quote.id}/duplicate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, variantLabel: label }),
      })
      const body = await res.json()
      if (!res.ok) { setActionError(body?.error?.message ?? '만들지 못했습니다.'); return }
      await load()
      onChanged?.()
    } catch {
      setActionError('만들지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setBusyId(null)
      setVariantOf(null)
    }
  }

  const openEdit = async (quote: Quote) => {
    setActionError(null)
    try {
      const res = await fetch(`/api/crm/quotes/${quote.id}`, { cache: 'no-store' })
      const body = await res.json()
      if (!res.ok) { setActionError(body?.error?.message ?? '견적을 불러오지 못했습니다.'); return }
      setEditing(quoteToDraft(body))
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
            title="삭제한 견적이 없어요"
            description="삭제한 견적은 여기에 남고, 언제든 되돌릴 수 있습니다."
            action={{ label: '견적으로 돌아가기', onClick: () => setTrash(false) }}
          />
        ) : (
          <EmptyState
            title="아직 견적이 없어요"
            description="무엇을 얼마에 제안했는지 적어 두면, 딜 금액의 근거가 남습니다."
            action={{
              label: createLabel(ENTITY.quote.label),
              onClick: () => setEditing(newQuoteDraft(dealName, dealCurrency, validDays)),
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
                    {/* 여러 판이 나란히 서므로 목록에서 바로 구분돼야 한다 */}
                    {(q.revision ?? 1) > 1 && <NbBadge status="note">Rev.{q.revision}</NbBadge>}
                    {q.variantLabel && <NbBadge status="note">{q.variantLabel}</NbBadge>}
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
                    {/*
                      **고칠 수 없는 견적에만 나온다.** 초안은 그냥 고치면 되므로
                      여기에 두면 「수정」과 헷갈린다 — 둘 다 있으면 사람은 더 어려워한다.
                    */}
                    {q.status !== 'DRAFT' && (
                      <>
                        <NbButton variant="ghost" onClick={() => void duplicate(q, 'revision', null)} disabled={busy}>
                          <Copy size={14} /> 개정본 만들기
                        </NbButton>
                        <NbButton
                          variant="ghost"
                          onClick={() => { setVariantOf(q); setVariantLabel('2안') }}
                          disabled={busy}
                        >
                          다른 안 만들기
                        </NbButton>
                      </>
                    )}
                    {(q.status === 'ACCEPTED' || q.status === 'REJECTED') && (
                      <NbButton variant="ghost" onClick={() => void openEdit(q)} disabled={busy}>
                        <FileText size={14} /> 내용 보기
                      </NbButton>
                    )}
                    {/*
                      고객이 받는 문서. 편집 모달과 **다른 것**이다 —
                      모달은 우리가 숫자를 맞추는 자리이고 이쪽은 나가는 문서다.
                      경로가 없어서 영업이 화면을 캡처해 보내고 있었다.
                    */}
                    <NbButton variant="ghost" href={`/crm/quotes/${q.id}`}>
                      <FileText size={14} /> {QUOTE.documentTitle}
                    </NbButton>
                    {/* 지우기는 초안에만 — 보낸 견적은 있었던 일의 기록이라 목록에서 치우지 않는다 */}
                    {q.status === 'DRAFT' && (
                      <NbButton variant="ghost" onClick={() => void remove(q)} disabled={busy}>
                        <Trash2 size={14} /> {ACTION.delete}
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
            <NbButton variant="ghost" onClick={() => setEditing(newQuoteDraft(dealName, dealCurrency, validDays))}>
              <Plus size={16} /> {createLabel(ENTITY.quote.label)}
            </NbButton>
          )}
        </>
      )}

      {/* 지운 것을 찾으러 다른 메뉴로 보내지 않는다 — 같은 자리에서 보기만 바꾼다 */}
      <button type="button" className={styles.trashToggle} onClick={() => setTrash((t) => !t)}>
        {trash ? '견적으로 돌아가기' : '삭제한 견적 보기'}
      </button>

      {editing && (
        <QuoteEditorModal
          dealId={dealId}
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void load(); onChanged?.() }}
        />
      )}

      {/*
        **한 칸을 물어보는 자리도 우리 모달이다.**
        `window.prompt` 는 우리 디자인 밖이고 페이지의 다른 동작을 통째로 막는다.
      */}
      {variantOf && (
        <NbModal
          title="다른 안 만들기"
          onClose={() => setVariantOf(null)}
          maxWidth={420}
          footer={
            <div className={styles.variantFoot}>
              <NbButton variant="ghost" onClick={() => setVariantOf(null)} disabled={Boolean(busyId)}>
                {ACTION.cancel}
              </NbButton>
              <NbButton
                onClick={() => void duplicate(variantOf, 'variant', variantLabel.trim() || '다른 안')}
                disabled={Boolean(busyId)}
              >
                {busyId ? progress('만드는') : '만들기'}
              </NbButton>
            </div>
          }
        >
          <div className={styles.variantForm}>
            <label className="label" htmlFor="variant-label">이 안의 이름</label>
            <input
              id="variant-label"
              className="input-field"
              value={variantLabel}
              autoFocus
              placeholder="예: 2안 · 대용량 구성"
              onChange={(e) => setVariantLabel(e.target.value)}
            />
            <p className={styles.variantHint}>
              {variantOf.quoteNo} 의 항목·금액을 그대로 복사해 초안으로 만듭니다.
              앞 견적은 그대로 남아요.
            </p>
          </div>
        </NbModal>
      )}
    </div>
  )
}
