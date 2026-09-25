// 지금 들고 있는 것과 오늘 손익
//
// 못 잰 값을 0 으로 그리지 않는다. 실현 손익 0원은 「오늘 본전」이라는 사실이고,
// 사람은 그것을 보고 아무 일도 없었다고 읽는다. 못 쟀으면 못 쟀다고 쓴다.
//
// 손절가도 같다. 빈 칸으로 두면 「손절 없음」과 구별이 안 되는데,
// 둘 중 하나는 손절을 안 건 것이고 다른 하나는 우리가 모르는 것이다.

import { DIRECTION_LABEL } from '@/lib/trading/signal-labels'
import { wonText, priceText, seoulTimeText, isRiskyUnknown } from '@/lib/trading/position-labels'
import type { HoldingRow, DayPnlRow } from '@/lib/trading/overview-shape'

const ROW: React.CSSProperties = {
  display: 'flex', gap: 'var(--space-3)', justifyContent: 'space-between',
}
const LABEL: React.CSSProperties = { fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }
const VALUE: React.CSSProperties = { fontSize: 'var(--fs-sm)', color: 'var(--text)', fontWeight: 600 }

export default function PositionPanel({
  holding, dayPnl,
}: { holding: HoldingRow | null; dayPnl: DayPnlRow }) {
  return (
    <section className="card">
      <h2 style={{ fontSize: 'var(--fs-md)', fontWeight: 600, color: 'var(--text)', margin: 0, marginBottom: 'var(--space-2)' }}>
        포지션과 손익
      </h2>

      <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text)', margin: 0, marginBottom: 'var(--space-3)' }}>
        {holding
          ? `${DIRECTION_LABEL[holding.direction]} ${holding.quantity}계약을 들고 있습니다`
          : '들고 있는 것이 없습니다'}
      </p>

      {holding && (
        <dl style={{ display: 'grid', gap: 'var(--space-2)', margin: 0, marginBottom: 'var(--space-4)' }}>
          <div style={ROW}>
            <dt style={LABEL}>평균 진입가</dt>
            <dd style={{ ...VALUE, margin: 0 }}>{priceText(holding.avgPrice)}</dd>
          </div>
          <div style={ROW}>
            <dt style={LABEL}>진입 시각</dt>
            <dd style={{ ...VALUE, margin: 0 }}>{seoulTimeText(holding.openedAt)}</dd>
          </div>
          <div style={ROW}>
            <dt style={LABEL}>손절가</dt>
            <dd style={{ ...VALUE, margin: 0, color: isRiskyUnknown(holding.stopPrice) ? 'var(--nb-danger)' : 'var(--text)' }}>
              {priceText(holding.stopPrice)}
            </dd>
          </div>
          <div style={ROW}>
            <dt style={LABEL}>목표가</dt>
            <dd style={{ ...VALUE, margin: 0 }}>
              {priceText(holding.targetPrice)}
            </dd>
          </div>
        </dl>
      )}

      {holding && holding.signalId === null && (
        <p role="status" style={{ fontSize: 'var(--fs-sm)', color: 'var(--nb-danger)', margin: 0, marginBottom: 'var(--space-3)' }}>
          신호 없이 들어간 포지션입니다. 손절가와 목표가를 시스템이 알 길이 없어 자동 청산이 걸리지 않습니다
        </p>
      )}

      <dl style={{ display: 'grid', gap: 'var(--space-2)', margin: 0 }}>
        <div style={ROW}>
          <dt style={LABEL}>오늘 실현 손익</dt>
          <dd style={{ ...VALUE, margin: 0 }}>
            {wonText(dayPnl.realizedKrw)}
          </dd>
        </div>
        <div style={ROW}>
          <dt style={LABEL}>오늘 닫은 거래</dt>
          <dd style={{ ...VALUE, margin: 0 }}>{dayPnl.tradeCount}건</dd>
        </div>
      </dl>

      {dayPnl.unmeasuredReason !== '' && (
        <p role="status" style={{ fontSize: 'var(--fs-sm)', color: 'var(--nb-danger)', margin: 0, marginTop: 'var(--space-2)' }}>
          손익을 못 쟀습니다: {dayPnl.unmeasuredReason}
        </p>
      )}

      <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', margin: 0, marginTop: 'var(--space-3)' }}>
        실현 손익은 닫은 거래만 셉니다. 들고 있는 것의 평가액은 섞지 않습니다
      </p>
    </section>
  )
}
