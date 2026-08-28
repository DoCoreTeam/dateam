'use client'

// 사업 리포트 — 세 관점(영업·매출·현금)과 다섯 축(마감·시점·대상·금액·상세)
//
// **이 화면의 규율**
//   · 숫자 옆에 **그 숫자가 답하는 질문**을 적는다. 「수주 22억」만 있으면 사람은
//     그게 이번 달인지 올해인지 앞으로인지 모른다 — 모르면 안 믿고, 안 믿으면 안 쓴다.
//   · 통화를 합치지 않는다. 원과 달러를 더한 숫자는 아무 뜻이 없다.
//   · **못 센 것을 밝힌다.** 종료일을 모르는 사업은 인식 매출에서 빠지는데,
//     그 사실을 안 적으면 매출이 조용히 작아진 채로 보고된다.

import { useMemo } from 'react'
import Sensitive from '@/components/crm/Sensitive'
import EmptyState from '@/components/ui/EmptyState'
import SectionSurface from '@/components/ui/SectionSurface'
import ListSurface from '@/components/ui/list/ListSurface'
import type { ColumnDef } from '@/components/ui/list/types'
import type { ListQuery } from '@/lib/ui/list-query'
import { formatAmount } from '../deals/amount'
import {
  LENS_LABEL, LENS_QUESTION, LENS_AMOUNT_LABEL, LENS_HINT, METRIC, METRIC_HINT,
  PERIOD_LABEL, PERIOD_ORDER, GROUP_LABEL, GROUP_ORDER,
  type PeriodKey, type GroupKey,
} from '@/lib/crm/domain/report-axis'
import styles from './business-panel.module.css'

interface CurrencySum { currency: string; totalMinor: string }
interface TimelinePoint { key: string; label: string; bookings: CurrencySum[]; recognized: CurrencySum[] }
interface GroupRow { key: string; label: string; count: number; bookings: CurrencySum[]; recognized: CurrencySum[] }
interface DealRow {
  id: string; name: string; companyName: string | null; ownerName: string | null
  businessType: string | null; wonAt: string | null; currency: string
  bookedMinor: string; recognizedMinor: string; recognitionUnknown: boolean; termLabel: string | null
}
export interface BusinessReportJson {
  period: { from: string; to: string; label: string }
  bookings: CurrencySum[]; bookingsCount: number
  recognized: CurrencySum[]; cash: CurrencySum[]; backlog: CurrencySum[]
  recognitionUnknownCount: number; recognitionUnknownAmount: CurrencySum[]
  timeline: TimelinePoint[]
  groupBy: GroupKey
  groups: GroupRow[]
  deals: DealRow[]
}

/**
 * 집계 표에 쓰는 고정 질의.
 *
 * 리포트의 표는 **이미 서버가 정렬해 준 결과**다 — 화면에서 다시 정렬하면
 * 위의 합계와 순서가 어긋나 「같은 화면이 두 이야기」를 하게 된다.
 * 그래서 검색·정렬·페이지 없이 표(또는 카드)만 그린다.
 */
const STATIC_QUERY: ListQuery = {
  q: '', sort: { key: '', dir: 'desc' }, filters: {}, view: 'table', size: 100, mode: 'pages', page: 1,
}

interface Props {
  data: BusinessReportJson
  period: PeriodKey
  onPeriodChange: (p: PeriodKey) => void
  onGroupChange: (g: GroupKey) => void
}

/** 통화별로 줄을 나눈다 — 합치지 않는다는 사실이 화면에 보여야 한다 */
function Money({ sums, size }: { sums: CurrencySum[]; size?: 'big' | 'inline' }) {
  if (sums.length === 0) return <span className={styles.none}>—</span>
  /*
    **문장 안에 들어가는 금액은 줄을 만들지 않는다.**
    큰 금액 표시는 block 이라, 그대로 문장에 넣었더니 경고 한 줄이 세 줄로 부서졌다
    (「종료일을 모르는 사업 1건 (」 / 「9억」 / 「)은 …」 — 실브라우저에서 잡았다).
  */
  const cls = size === 'big' ? styles.figureBig : size === 'inline' ? styles.figureInline : styles.figure
  return (
    <span className={cls}>
      {sums.map((s, i) => (
        <span key={s.currency} className={size === 'inline' ? undefined : styles.figureLine}>
          {i > 0 && size === 'inline' ? ' · ' : null}
          <Sensitive>{formatAmount(s.totalMinor, s.currency) ?? `${s.totalMinor} ${s.currency}`}</Sensitive>
        </span>
      ))}
    </span>
  )
}

/**
 * 지표 카드 하나.
 *
 * **설명은 ❓ 안에 넣는다**(§3-1). 카드마다 세 줄짜리 설명을 펼쳐 두면
 * 정작 봐야 할 숫자 넷이 화면 한 판을 다 쓰고, 그 아래 내용은 스크롤 밖으로 밀린다.
 * 뜻을 없애는 것이 아니라 **필요할 때 꺼내 보게** 두는 것이다.
 */
function MetricCard({ tone, question, title, sums, foot, hint }: {
  tone: string; question: string; title: string
  sums: CurrencySum[]; foot: string; hint: string
}) {
  return (
    <article className={`${styles.card} ${tone}`}>
      <p className={styles.cardQuestion}>{question}</p>
      <h3 className={styles.cardTitle}>
        {title}
        <button type="button" className={styles.hintBtn} title={hint} aria-label={`${title} 설명: ${hint}`}>?</button>
      </h3>
      <Money sums={sums} size="big" />
      <p className={styles.cardFoot}>{foot}</p>
    </article>
  )
}

/** 대상별 컬럼 — 이름은 늘어나고 숫자는 고정 폭이라 자릿수가 세로로 맞는다 */
function groupColumns(groupBy: GroupKey): ColumnDef<GroupRow>[] {
  return [
    { key: 'label', header: GROUP_LABEL[groupBy], primary: true, cell: (g) => g.label },
    { key: 'bookings', header: METRIC.bookings, align: 'right', width: '15rem',
      cell: (g) => <Money sums={g.bookings} /> },
    { key: 'recognized', header: '인식 매출', align: 'right', width: '15rem',
      cell: (g) => <Money sums={g.recognized} /> },
    { key: 'count', header: '건수', align: 'right', width: '6rem',
      cell: (g) => `${g.count}건` },
  ]
}

/** 상세 컬럼 — 합계만 있고 내역이 없으면 사람이 그 숫자를 확인할 방법이 없다 */
const DEAL_COLUMNS: ColumnDef<DealRow>[] = [
  { key: 'name', header: '딜', primary: true, cell: (d) => d.name },
  { key: 'company', header: '회사', cell: (d) => d.companyName ?? '—' },
  { key: 'owner', header: '담당', width: '7rem', cell: (d) => d.ownerName ?? '—' },
  { key: 'wonAt', header: '따낸 날', width: '8rem', cell: (d) => d.wonAt ?? '—' },
  {
    key: 'term', header: '사업 기간', cell: (d) => (
      <>
        {d.termLabel ?? '—'}
        {d.recognitionUnknown && <span className={styles.unknownTag}>기간 모름</span>}
      </>
    ),
  },
  {
    key: 'booked', header: '수주', align: 'right', width: '13rem',
    cell: (d) => <Sensitive>{formatAmount(d.bookedMinor, d.currency) ?? '—'}</Sensitive>,
  },
  {
    key: 'recognized', header: '이 기간 인식', align: 'right', width: '13rem',
    // 기간을 모르면 «0» 이 아니라 «모른다» 다 — 0 으로 그리면 안 판 것이 아니라 못 판 것으로 읽힌다
    cell: (d) => (d.recognitionUnknown
      ? <span className={styles.none}>—</span>
      : <Sensitive>{formatAmount(d.recognizedMinor, d.currency) ?? '—'}</Sensitive>),
  },
]

/** 막대 하나의 길이 — 이 기간에서 가장 큰 값을 100% 로 본다 */
function firstMinor(sums: CurrencySum[]): bigint {
  return sums[0] ? BigInt(sums[0].totalMinor) : BigInt(0)
}

export default function BusinessPanel({ data, period, onPeriodChange, onGroupChange }: Props) {
  const peak = useMemo(() => {
    let max = BigInt(0)
    for (const t of data.timeline) {
      const a = firstMinor(t.bookings)
      const b = firstMinor(t.recognized)
      if (a > max) max = a
      if (b > max) max = b
    }
    return max
  }, [data.timeline])

  const pct = (v: bigint) => (peak === BigInt(0) ? 0 : Number((v * BigInt(1000)) / peak) / 10)
  const hasAny = data.bookingsCount > 0 || data.recognized.length > 0

  return (
    <div className={styles.wrap}>
      {/* ── 마감: 어느 기간을 보고 있나. 무엇을 보든 이 답이 먼저 있어야 한다 ── */}
      <div className={styles.periodBar}>
        <div className={styles.periodTabs} role="group" aria-label="기간">
          {PERIOD_ORDER.map((p) => (
            <button
              key={p} type="button"
              className={`${styles.periodTab}${p === period ? ` ${styles.periodTabOn}` : ''}`}
              onClick={() => onPeriodChange(p)}
              aria-pressed={p === period}
            >
              {PERIOD_LABEL[p]}
            </button>
          ))}
        </div>
        <span className={styles.periodRange}>{data.period.from} ~ {data.period.to}</span>
      </div>

      {/* ── 금액: 세 관점 + 잔고. 각 숫자 위에 «무엇을 묻는가»를 적는다 ── */}
      <div className={styles.cards}>
        <MetricCard
          tone={styles.cardSales}
          question={`${LENS_LABEL.SALES} · ${LENS_QUESTION.SALES}`}
          title={LENS_AMOUNT_LABEL.SALES}
          sums={data.bookings}
          foot={`${data.period.label}에 ${data.bookingsCount}건 따냄`}
          hint={LENS_HINT.SALES}
        />
        <MetricCard
          tone={styles.cardRevenue}
          question={`${LENS_LABEL.REVENUE} · ${LENS_QUESTION.REVENUE}`}
          title={LENS_AMOUNT_LABEL.REVENUE}
          sums={data.recognized}
          foot="사업 기간에 나눠 담은 몫"
          hint={LENS_HINT.REVENUE}
        />
        <MetricCard
          tone={styles.cardCash}
          question={`${LENS_LABEL.CASH} · ${LENS_QUESTION.CASH}`}
          title={LENS_AMOUNT_LABEL.CASH}
          sums={data.cash}
          foot="인식 매출에서 현물 몫을 뺀 값"
          hint={LENS_HINT.CASH}
        />
        <MetricCard
          tone={styles.cardBacklog}
          question="회계 · 아직 안 판 것"
          title={METRIC.backlog}
          sums={data.backlog}
          foot={`${data.period.to} 기준`}
          hint={METRIC_HINT.backlog}
        />
      </div>

      {/*
        **못 센 것을 밝힌다.** 이 줄이 없으면 인식 매출이 조용히 작아진 채로 보고된다 —
        그리고 그 사실은 결산 때 알게 된다.
      */}
      {data.recognitionUnknownCount > 0 && (
        <p className={styles.caveat}>
          종료일을 모르는 사업 {data.recognitionUnknownCount}건
          (<Money sums={data.recognitionUnknownAmount} size="inline" />)은 매출을 나눌 수 없어
          <b> 인식 매출에서 뺐습니다.</b> 전액 수주잔고에 남아 있어요.
        </p>
      )}

      {/*
        숫자가 하나도 없을 때는 **다음에 뭘 하면 되는지**까지 말한다.
        「없습니다」로 끝내면 사용자는 고장인지 아직인지 구분할 수 없다.
      */}
      {!hasAny && (
        <EmptyState
          title={`${data.period.label}에 따낸 딜이 아직 없어요`}
          description="딜을 성사로 옮기면 수주·매출이 여기에 쌓입니다. 기간을 넓혀 보셔도 좋아요."
          action={{ label: '딜 보러 가기', href: '/crm/deals' }}
        />
      )}

      {/* ── 시점: 달마다 얼마를 따냈고 얼마가 매출로 잡히나 ── */}
      <SectionSurface
        title="달마다"
        meta={`${data.timeline.length}개월`}
        action={
          <span className={styles.legend}>
            <span className={styles.legendSales} /> 수주
            <span className={styles.legendRevenue} /> 인식 매출
          </span>
        }
      >
        {peak === BigInt(0) ? (
          <EmptyState title="이 기간에는 달마다 쌓인 숫자가 아직 없어요" />
        ) : (
          <ol className={styles.chart}>
            {data.timeline.map((t) => (
              <li key={t.key} className={styles.chartRow}>
                <span className={styles.chartLabel}>{t.label}</span>
                <span className={styles.chartBars}>
                  <span
                    className={`${styles.bar} ${styles.barSales}`}
                    style={{ width: `${pct(firstMinor(t.bookings))}%` }}
                    title={`수주 ${formatAmount(firstMinor(t.bookings).toString(), 'KRW') ?? ''}`}
                  />
                  <span
                    className={`${styles.bar} ${styles.barRevenue}`}
                    style={{ width: `${pct(firstMinor(t.recognized))}%` }}
                    title={`인식 매출 ${formatAmount(firstMinor(t.recognized).toString(), 'KRW') ?? ''}`}
                  />
                </span>
                <span className={styles.chartValue}>
                  <Money sums={t.recognized} size="inline" />
                </span>
              </li>
            ))}
          </ol>
        )}
      </SectionSurface>

      {/* ── 대상: 무엇으로 쪼개 볼 것인가 ── */}
      <SectionSurface
        title="무엇이 벌어 오나"
        meta={`${data.groups.length}${data.groupBy === 'OWNER' ? '명' : '개'}`}
        action={
          <select
            className="input-field"
            aria-label="쪼개 보는 기준"
            value={data.groupBy}
            onChange={(e) => onGroupChange(e.target.value as GroupKey)}
            style={{ width: 'auto', minWidth: 140 }}
          >
            {GROUP_ORDER.filter((g) => g !== 'STAGE').map((g) => (
              <option key={g} value={g}>{GROUP_LABEL[g]}별</option>
            ))}
          </select>
        }
        bleed
      >
        <ListSurface<GroupRow>
          rows={data.groups}
          columns={groupColumns(data.groupBy)}
          query={STATIC_QUERY}
          rowKey={(g) => g.key}
          empty={{ title: '이 기간에는 나눠 볼 것이 없어요' }}
        />
      </SectionSurface>

      {/* ── 상세: 그 숫자를 만든 딜들. 합계만 있고 내역이 없으면 확인할 방법이 없다 ── */}
      <SectionSurface title="이 숫자를 만든 딜" meta={`${data.deals.length}건`} bleed>
        <ListSurface<DealRow>
          rows={data.deals}
          columns={DEAL_COLUMNS}
          query={STATIC_QUERY}
          rowKey={(d) => d.id}
          rowHref={(d) => `/crm/deals/${d.id}`}
          empty={{ title: '이 기간에 해당하는 딜이 없어요' }}
        />
      </SectionSurface>
    </div>
  )
}
