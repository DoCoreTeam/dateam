'use client'

/**
 * 매출 인식 장부 — 기본은 숫자 둘, 나머지는 접혀 있다.
 *
 * **왜 접는가**: 사용자 지시 그대로다 —
 * «계산값이 너무 복잡하면 이걸 보는 영업조직은 머리 아파.
 *  기본 금액만 나오고 상세를 누르면 나오도록 설계해»
 *
 * 그래서 열자마자 보이는 것은 «수주 매출»과 (현물이 있을 때만) «현물 제외» 둘뿐이다.
 * 부가세·재원·현물 명세·연차 배분은 «자세히»를 눌러야 나온다.
 *
 * **화면은 뺄셈을 하지 않는다.** 서버가 계산해 보낸 값을 그대로 그린다 —
 * 화면이 다시 계산하면 두 곳이 어긋날 자리가 생긴다.
 */

import { useCallback, useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, Pencil } from 'lucide-react'
import AXDotLoader from '@/components/ui/AXDotLoader'
import ErrorState from '@/components/ui/ErrorState'
import Sensitive from '@/components/crm/Sensitive'
import {
  ACTION, LEDGER, FUNDING_LABEL, IN_KIND_LOCKED,
  failedTo, inKindShare, taxBasisNote, undatedInKindNote, yearLabel, monthsLabel,
} from '@/lib/terms'
import { formatAmount } from '../amount'
import NbButton from '@/components/ui/nb/NbButton'
import LedgerEditModal, { type LedgerEditRow, type LedgerEditFunding } from './LedgerEditModal'
import { readApiError } from '@/lib/crm/api/read-error'
import styles from './ledger.module.css'

interface FundingRowJson extends LedgerEditFunding {
  id: string
  label: string
  needsSeparateAccount: boolean
  countsAsAccountingRevenue: boolean
}

type InKindRowJson = LedgerEditRow

interface YearRowJson {
  year: number
  months: number
  amountMinor: string
}

interface LedgerJson {
  bookedMinor: string
  bookedFromLabel: string
  netMinor: string
  taxMinor: string
  grossMinor: string
  taxBasis: 'NET' | 'GROSS'
  taxRatePct: string
  inKindMinor: string
  exInKindMinor: string
  accountingRevenueMinor: string | null
  cashInflowMinor: string | null
  hasInKind: boolean
  inKindRatioPct: number | null
  funding: FundingRowJson[]
  /** 볼 권한이 없으면 null 로 온다 — 화면이 «가려진» 것이 아니라 아예 안 받는다 */
  inKind: InKindRowJson[] | null
  inKindCount: number
  inKindByYear: YearRowJson[]
  inKindUndatedMinor: string
  currency: string | null
  /** 서버가 판정한다 — 화면이 역할로 다시 판정하면 답이 갈린다 */
  canEdit: boolean
  budgetMinor: string | null
  contractMinor: string | null
}



export default function LedgerPanel({ dealId }: { dealId: string }) {
  const [data, setData] = useState<LedgerJson | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)

  /**
   * 장부에 «사람이 적은 것»이 하나라도 있나.
   *
   * 금액(수주 매출)은 딜에서 파생될 수 있으므로 판정에 넣지 않는다 —
   * 예상 금액만 있는 딜을 «상세를 적었다»고 보면 버튼이 처음부터 「수정」이 된다.
   */
  const [editing, setEditing] = useState(false)

  /**
   * `silent` 는 «다시 읽되 화면을 갈아치우지 말라»는 뜻이다.
   *
   * 없으면 저장 직후 패널이 통째로 로더로 바뀌면서 열려 있던 모달까지 다시 마운트되고,
   * **사용자가 입력하던 재원·부가세 기준이 통째로 날아간다**(실브라우저에서 잡았다).
   */
  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/crm/deals/${dealId}/ledger`, { cache: 'no-store' })
      const body = await res.json()
      if (!res.ok) throw new Error(readApiError(body, failedTo('매출 인식 장부', '불러오지')))
      setData(body as LedgerJson)
    } catch (e) {
      setError(e instanceof Error ? e.message : failedTo('매출 인식 장부', '불러오지'))
    } finally {
      setLoading(false)
    }
  }, [dealId])

  useEffect(() => { void load() }, [load])

  if (loading) return <AXDotLoader />
  if (error) return <ErrorState message={error} onRetry={() => { void load() }} />
  if (!data) return null

  /**
   * 금액 표기는 **딜 통화를 따라간다.**
   * 「원」을 박아 넣으면 USD 딜에서 「120,000,000원」이라고 말한다(실브라우저에서 잡았다).
   * 표시 변환은 보드·표와 같은 SSOT 를 쓴다(§2 «표시 로직도 SSOT»).
   */
  const money = (minor: string): string => formatAmount(minor, data.currency) ?? '—'

  const hasFunding = data.funding.length > 0
  // 사람이 적은 것이 하나라도 있나 — 예산·계약·재원·현물 중 하나
  const hasDetail = hasFunding || data.inKindCount > 0
    || data.budgetMinor !== null || data.contractMinor !== null

  return (
    <div>
      <div className={styles.head}>
        <div className={styles.primary}>
          <span className={styles.label}>{LEDGER.booked}</span>
          <span className={styles.amount}><Sensitive>{money(data.bookedMinor)}</Sensitive></span>
          <span className={styles.source}>{data.bookedFromLabel} 기준</span>
        </div>

        {/* 현물이 없으면 이 줄 자체를 그리지 않는다 — 대부분의 딜에 현물은 없다 */}
        {data.hasInKind && (
          <div className={`${styles.primary} ${styles.secondary}`}>
            <span className={styles.label}>{LEDGER.exInKind}</span>
            <span className={styles.amount}><Sensitive>{money(data.exInKindMinor)}</Sensitive></span>
            <span className={styles.source}>{inKindShare(money(data.inKindMinor), data.inKindRatioPct)}</span>
          </div>
        )}
      </div>

      <div className={styles.toolbar}>
        <button
          type="button"
          className="btn-ghost"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          {open ? LEDGER.collapse : LEDGER.expand}
        </button>
        {data.canEdit && (
          <NbButton variant="ghost" onClick={() => setEditing(true)}>
            {/*
            아직 아무것도 안 적혔으면 「상세 등록」, 한 번이라도 적었으면 「수정」.
            비어 있는데 「수정」이라고 하면 무엇을 고치라는 건지 알 수 없다.
          */}
          <Pencil size={16} /> {hasDetail ? ACTION.edit : LEDGER.registerDetail}
          </NbButton>
        )}
      </div>

      {open && (
        <div className={styles.detail}>
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>{LEDGER.tax}</h3>
            <div className={styles.rows}>
              <div className={styles.row}>
                <span className={styles.rowLabel}>{LEDGER.net}</span>
                <span className={styles.rowValue}><Sensitive>{money(data.netMinor)}</Sensitive></span>
              </div>
              <div className={styles.row}>
                <span className={styles.rowLabel}>{LEDGER.tax}</span>
                <span className={styles.rowValue}><Sensitive>{money(data.taxMinor)}</Sensitive></span>
              </div>
              <div className={styles.row}>
                <span className={styles.rowLabel}>{LEDGER.gross}</span>
                <span className={styles.rowValue}><Sensitive>{money(data.grossMinor)}</Sensitive></span>
              </div>
            </div>
            <p className={styles.note}>{taxBasisNote(data.taxBasis)}</p>
          </section>

          {hasFunding && (
            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>{LEDGER.fundingSection}</h3>
              <div className={styles.rows}>
                {data.funding.map((f) => (
                  <div key={f.id} className={styles.row}>
                    <span className={styles.rowLabel}>
                      <span className={styles.rowName}>{f.label}</span>
                      {f.agencyName && <span className={styles.basis}>{f.agencyName}</span>}
                      {f.needsSeparateAccount && <span className={styles.basis}>{LEDGER.separateAccount}</span>}
                    </span>
                    <span className={styles.rowValue}><Sensitive>{money(f.amountMinor)}</Sensitive></span>
                  </div>
                ))}
              </div>
              {data.accountingRevenueMinor !== null && (
                <p className={styles.note}>
                  {LEDGER.accountingRevenue} <Sensitive>{money(data.accountingRevenueMinor)}</Sensitive>
                  {` (${FUNDING_LABEL.NATIONAL} + ${FUNDING_LABEL.LOCAL})`}
                  {data.cashInflowMinor !== null && <> · {LEDGER.cashInflow} <Sensitive>{money(data.cashInflowMinor)}</Sensitive></>}
                </p>
              )}
            </section>
          )}

          {data.hasInKind && (
            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>{LEDGER.inKindSection}</h3>
              {data.inKind === null ? (
                <p className={styles.locked}>{IN_KIND_LOCKED}</p>
              ) : (
                <div className={styles.rows}>
                  {data.inKind.map((k) => (
                    <div key={k.id} className={styles.row}>
                      <span className={styles.rowLabel}>
                        <span className={styles.rowName}>{k.name}</span>
                        <span className={styles.basis}>{k.kindLabel}{k.basisNote ? ` · ${k.basisNote}` : ''}</span>
                      </span>
                      <span className={styles.rowValue}><Sensitive>{money(k.valueMinor)}</Sensitive></span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {(data.inKindByYear.length > 0 || BigInt(data.inKindUndatedMinor) > BigInt(0)) && (
            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>{LEDGER.inKindByYear}</h3>
              <div className={styles.rows}>
                {data.inKindByYear.map((y) => (
                  <div key={y.year} className={styles.row}>
                    <span className={styles.rowLabel}>
                      <span className={styles.rowName}>{yearLabel(y.year)}</span>
                      <span className={styles.basis}>{monthsLabel(y.months)}</span>
                    </span>
                    <span className={styles.rowValue}><Sensitive>{money(y.amountMinor)}</Sensitive></span>
                  </div>
                ))}
              </div>
              {BigInt(data.inKindUndatedMinor) > BigInt(0) && (
                <p className={styles.note}>{undatedInKindNote(money(data.inKindUndatedMinor))}</p>
              )}
            </section>
          )}
        </div>
      )}

      {editing && (
        <LedgerEditModal
          dealId={dealId}
          funding={data.funding}
          inKind={data.inKind ?? []}
          taxBasis={data.taxBasis}
          taxRatePct={data.taxRatePct}
          budgetMinor={data.budgetMinor}
          contractMinor={data.contractMinor}
          onClose={() => setEditing(false)}
          onSaved={() => { void load(true) }}
        />
      )}
    </div>
  )
}
