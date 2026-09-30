// app/(trading)/trading/AccuracyPanel.tsx — 그동안 얼마나 맞았고 얼마를 벌었나
//
// 사용자 지시 2026-09-29:
//   「어차피 거래는 내가 직접 할거야 이건 정보를 주는 서비스라구」
//   「결국 돈 버는게 핵심이야 수익 관점에서 다 움직여야 하는거야 알지?」
//
// **적중률을 앞에 세우지 않는다.** 실측 2026-09-29: 적중률 27% 인데 건당 +0.028R 이었다 —
// 적중률만 보면 나쁜 예측이지만 돈은 벌었다. 작게 여러 번 이기고 크게 한 번 지는 반대 판도
// 있다. 그래서 **건당 손익이 큰 글자**고 적중률은 그 옆이다.

import { Target } from 'lucide-react'
import EmptyState from '@/components/ui/EmptyState'
import type { AccuracySummary, AccuracyRow } from '@/lib/trading/overview-shape'
import { replayLines, HIT_MEANING, UNSCORED_MEANING } from '@/lib/trading/judge/accuracy-note'
import styles from './AccuracyPanel.module.css'

/** 건당 손익(R). **없으면 없다고 말한다** — 0 은 「본전이었다」는 사실이다 */
function rText(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '아직'
  return `${value > 0 ? '+' : ''}${value.toFixed(3)}R`
}

/** 적중률. 결판난 것이 0건이면 0% 가 아니라 모름이다 */
function rateText(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '아직'
  return `${Math.round(value * 100)}%`
}

/**
 * 기준금액 대비 수익률. **기준금액을 안 정했으면 빈 칸이다** —
 * 0% 로 적으면 「본전이었다」는 사실이 되고, 0 으로 나누면 무한대가 된다.
 */
function rateOfReturnText(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return ''
  const sign = value > 0 ? '+' : value < 0 ? '−' : ''
  return `${sign}${(Math.abs(value) * 100).toFixed(2)}%`
}

function krwText(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '아직'
  const sign = value > 0 ? '+' : value < 0 ? '−' : ''
  return `${sign}${Math.abs(Math.round(value)).toLocaleString('ko-KR')}원`
}

/**
 * 표본이 적으면 숫자를 믿으면 안 된다.
 *
 * 30건은 임의로 고른 값이 아니라 **이 화면이 「적다」고 말할 최소선**이다. 그 아래에서는
 * 건당 손익이 한두 건에 통째로 흔들린다 — 숫자를 지우지는 않고 무게만 낮춘다.
 */
const THIN_SAMPLE = 30

function Row({ row }: { row: AccuracyRow }) {
  const thin = row.settled < THIN_SAMPLE
  const up = (row.averageR ?? 0) > 0
  const down = (row.averageR ?? 0) < 0
  return (
    <div className={styles.row}>
      <span className={styles.label}>{row.label}</span>
      {/* **돈이 먼저다.** 건당 손익이 이 줄에서 가장 큰 글자다 */}
      <strong className={`${styles.money} ${up ? styles.up : down ? styles.down : ''}`}>
        {rText(row.averageR)}
      </strong>
      <span className={styles.krw}>
        {krwText(row.netKrw)}
        {/* 기준금액을 정했으면 「얼마 넣어 얼마」로도 읽히게 한다 */}
        {row.returnRate !== null && (
          <span className={styles.pct}>{` ${rateOfReturnText(row.returnRate)}`}</span>
        )}
      </span>
      {/*
        적중률은 **표본과 한 덩어리로** 읽혀야 한다.
        3건 중 2건과 300건 중 200건은 같은 67% 가 아니다
      */}
      <span className={styles.rate}>
        {rateText(row.hitRate)}
        <span className={styles.sample}>{` (${row.hit}/${row.settled}건)`}</span>
      </span>
      <span className={styles.aside}>
        {row.pending > 0 && `아직 ${row.pending}건`}
        {row.pending > 0 && row.unscored > 0 && ' · '}
        {row.unscored > 0 && `못 들어간 ${row.unscored}건`}
      </span>
      {thin && <span className={styles.thin}>표본이 적습니다</span>}
    </div>
  )
}

export default function AccuracyPanel({ accuracy }: { accuracy: AccuracySummary }) {
  return (
    <section className={`card ${styles.panel}`}>
      <div className={styles.head}>
        <h2 className={styles.title}>그동안 얼마나 벌었나</h2>
        {accuracy.tradeDays > 0 && (
          <span className={styles.days}>{`${accuracy.tradeDays}거래일치`}</span>
        )}
      </div>
      {/*
        **무엇을 세는지 먼저 말한다.** 이 숫자는 「그 판단대로 매번 들어갔다면」이고
        실제로 낸 주문이 아니다. 그 둘을 섞으면 화면이 거짓말을 한다
      */}
      <p className={styles.note}>
        판단대로 매번 들어갔다면 어땠을지를 지난 봉으로 되짚은 값입니다. 실제 주문 기록이 아닙니다
      </p>
      {/*
        **어떻게 되짚었는지를 적는다** (사용자 지적 2026-09-30 「어떤 근거의 데이터인지
        설명 좀 써주고」). 규칙을 안 말하면 이 숫자를 믿을 근거가 없다.
        늘 펼쳐 두면 안 읽히므로 접어 둔다 — 값은 매일 보고 규칙은 한 번 본다.
      */}
      <details className={styles.how}>
        <summary className={styles.howSummary}>어떻게 셈한 값인가</summary>
        <ul className={styles.howList}>
          {replayLines(accuracy.replay).map((line) => <li key={line}>{line}</li>)}
          <li>{HIT_MEANING}</li>
          <li>{UNSCORED_MEANING}</li>
        </ul>
      </details>
      {/*
        **왜 마이너스인지 말한다** (사용자 지적 2026-09-30 「그리고 다 마이너스네」).
        본전선을 넘으면 이 줄이 사라진다 — 늘 뜨는 설명은 안 읽힌다.
      */}
      {accuracy.whyNegative && (
        <p className={styles.warn}>{accuracy.whyNegative}</p>
      )}
      {/*
        **몇 계약 기준인지 말한다.** 「+714,660원」만 있으면 그것이 1계약인지 열 계약인지
        알 수 없다 (사용자 지적 2026-09-29 「투자하는 기준금액이 있는거 같은데」).
      */}
      <p className={styles.basis}>
        {`${accuracy.contracts}계약 기준`}
        {accuracy.multiplier > 0 && ` · 1계약 ${accuracy.multiplier.toLocaleString('ko-KR')}원짜리`}
        {accuracy.baseKrw > 0
          ? ` · 기준금액 ${accuracy.baseKrw.toLocaleString('ko-KR')}원`
          : ' · 기준금액을 정하면 수익률로도 보여드립니다'}
      </p>
      {/*
        **수수료가 0원이면 그 사실을 말한다.** 말 안 하면 이 숫자를 실제 수익으로 읽는다 —
        선물은 왕복 수수료와 세금이 건당 손익을 쉽게 뒤집는다.
      */}
      {!accuracy.feeIncluded && accuracy.rows.length > 0 && (
        <p className={styles.warn}>
          수수료가 0원으로 설정돼 있어 거래비용이 하나도 안 빠진 숫자입니다. 설정에서 실제 수수료를 넣으면 이 성적이 낮아집니다
        </p>
      )}
      {accuracy.rows.length === 0
        ? (
          <EmptyState
            icon={<Target size={28} />}
            title="아직 채점할 것이 없습니다"
            description={accuracy.unmeasuredReason || '판단이 쌓이면 여기에 성적이 뜹니다'}
          />
        )
        : (
          <div className={styles.rows}>
            <div className={`${styles.row} ${styles.header}`}>
              <span className={styles.label}>묶음</span>
              <span className={styles.money}>건당</span>
              <span className={styles.krw}>합계</span>
              <span className={styles.rate}>적중</span>
              <span className={styles.aside} />
            </div>
            {accuracy.rows.map((r) => <Row key={r.label} row={r} />)}
          </div>
        )}
    </section>
  )
}
