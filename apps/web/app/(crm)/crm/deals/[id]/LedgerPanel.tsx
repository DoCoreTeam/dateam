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
import { ChevronDown, ChevronRight } from 'lucide-react'
import AXDotLoader from '@/components/ui/AXDotLoader'
import ErrorState from '@/components/ui/ErrorState'
import Sensitive from '@/components/crm/Sensitive'
import { failedTo } from '@/lib/terms'
import { formatMinor } from '@/lib/crm/domain/money'
import styles from './ledger.module.css'

interface FundingRowJson {
  id: string
  sourceType: string
  label: string
  amountMinor: string
  agencyName: string | null
  needsSeparateAccount: boolean
  countsAsAccountingRevenue: boolean
}

interface InKindRowJson {
  id: string
  kind: string
  kindLabel: string
  name: string
  valueMinor: string
  basisNote: string | null
}

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
}

function won(minor: string): string {
  return `${formatMinor(BigInt(minor))}원`
}

export default function LedgerPanel({ dealId }: { dealId: string }) {
  const [data, setData] = useState<LedgerJson | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/crm/deals/${dealId}/ledger`, { cache: 'no-store' })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.message ?? failedTo('매출 인식 장부', '불러오지'))
      setData(body as LedgerJson)
    } catch (e) {
      setError(e instanceof Error ? e.message : failedTo('매출 인식 장부', '불러오지'))
    } finally {
      setLoading(false)
    }
  }, [dealId])

  useEffect(() => { void load() }, [load])

  if (loading) return <AXDotLoader />
  if (error) return <ErrorState message={error} onRetry={load} />
  if (!data) return null

  const hasFunding = data.funding.length > 0

  return (
    <div>
      <div className={styles.head}>
        <div className={styles.primary}>
          <span className={styles.label}>수주 매출</span>
          <span className={styles.amount}><Sensitive>{won(data.bookedMinor)}</Sensitive></span>
          <span className={styles.source}>{data.bookedFromLabel} 기준</span>
        </div>

        {/* 현물이 없으면 이 줄 자체를 그리지 않는다 — 대부분의 딜에 현물은 없다 */}
        {data.hasInKind && (
          <div className={`${styles.primary} ${styles.secondary}`}>
            <span className={styles.label}>현물 제외</span>
            <span className={styles.amount}><Sensitive>{won(data.exInKindMinor)}</Sensitive></span>
            <span className={styles.source}>
              현물 {won(data.inKindMinor)}
              {data.inKindRatioPct !== null && ` · 사업비의 ${data.inKindRatioPct}%`}
            </span>
          </div>
        )}
      </div>

      <button
        type="button"
        className="btn-ghost"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        {open ? '접기' : '자세히'}
      </button>

      {open && (
        <div className={styles.detail}>
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>부가세</h3>
            <div className={styles.rows}>
              <div className={styles.row}>
                <span className={styles.rowLabel}>공급가액</span>
                <span className={styles.rowValue}><Sensitive>{won(data.netMinor)}</Sensitive></span>
              </div>
              <div className={styles.row}>
                <span className={styles.rowLabel}>부가세</span>
                <span className={styles.rowValue}><Sensitive>{won(data.taxMinor)}</Sensitive></span>
              </div>
              <div className={styles.row}>
                <span className={styles.rowLabel}>합계</span>
                <span className={styles.rowValue}><Sensitive>{won(data.grossMinor)}</Sensitive></span>
              </div>
            </div>
            <p className={styles.note}>
              {data.taxBasis === 'GROSS'
                ? '수주 매출이 부가세 포함 금액입니다. 공급가액과 세액은 여기서 나눠 계산했습니다.'
                : '수주 매출이 공급가액입니다. 세액은 여기서 더해 계산했습니다.'}
            </p>
          </section>

          {hasFunding && (
            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>재원 구성</h3>
              <div className={styles.rows}>
                {data.funding.map((f) => (
                  <div key={f.id} className={styles.row}>
                    <span className={styles.rowLabel}>
                      <span className={styles.rowName}>{f.label}</span>
                      {f.agencyName && <span className={styles.basis}>{f.agencyName}</span>}
                      {f.needsSeparateAccount && <span className={styles.basis}>별도 계좌</span>}
                    </span>
                    <span className={styles.rowValue}><Sensitive>{won(f.amountMinor)}</Sensitive></span>
                  </div>
                ))}
              </div>
              {data.accountingRevenueMinor !== null && (
                <p className={styles.note}>
                  회계 수익 인식 <Sensitive>{won(data.accountingRevenueMinor)}</Sensitive> (국비 + 지방비)
                  {data.cashInflowMinor !== null && <> · 현금 유입 <Sensitive>{won(data.cashInflowMinor)}</Sensitive></>}
                </p>
              )}
            </section>
          )}

          {data.hasInKind && (
            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>현물 명세</h3>
              {data.inKind === null ? (
                <p className={styles.locked}>
                  현물 명세는 관리자만 볼 수 있습니다. 합계는 위에 있습니다.
                </p>
              ) : (
                <div className={styles.rows}>
                  {data.inKind.map((k) => (
                    <div key={k.id} className={styles.row}>
                      <span className={styles.rowLabel}>
                        <span className={styles.rowName}>{k.name}</span>
                        <span className={styles.basis}>{k.kindLabel}{k.basisNote ? ` · ${k.basisNote}` : ''}</span>
                      </span>
                      <span className={styles.rowValue}><Sensitive>{won(k.valueMinor)}</Sensitive></span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {data.inKindByYear.length > 0 && (
            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>현물 연차 배분</h3>
              <div className={styles.rows}>
                {data.inKindByYear.map((y) => (
                  <div key={y.year} className={styles.row}>
                    <span className={styles.rowLabel}>
                      <span className={styles.rowName}>{y.year}년</span>
                      <span className={styles.basis}>{y.months}개월</span>
                    </span>
                    <span className={styles.rowValue}><Sensitive>{won(y.amountMinor)}</Sensitive></span>
                  </div>
                ))}
              </div>
              {BigInt(data.inKindUndatedMinor) > BigInt(0) && (
                <p className={styles.note}>
                  기간을 정하지 않은 현물 <Sensitive>{won(data.inKindUndatedMinor)}</Sensitive>은 연차에 배분하지 않았습니다.
                </p>
              )}
            </section>
          )}
        </div>
      )}
    </div>
  )
}
