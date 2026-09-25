// app/(member)/trading/page.tsx — AI 트레이딩 설정 골격 (Release 1-A)
//
// 지금 이 화면이 하는 일은 하나다: **무엇으로 판단하게 되는가를 보여 준다.**
// 봉 수집 상태와 판단 기록은 수집이 서고 나서 이 화면에 붙는다.
//
// 신호 단추·체결 단추는 없다. 1-C 것이고, 못 하는 동작의 단추를 그리면
// 사용자는 눌러 보고 나서야 없다는 것을 안다.

import { CandlestickChart } from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'
import BarCoverage from './BarCoverage'
import JudgmentList from './JudgmentList'
import { loadTradingOverview } from '@/lib/trading/overview'
import { TRADING_SETTINGS, type TradingSettingGroup } from '@/lib/trading/settings/registry'
import { formatKstDateTimeExact } from '@/lib/datetime/kst'
import {
  TRADING_GROUP_LABEL,
  TRADING_USED_FROM_LABEL,
  formatTradingSettingValue,
} from '@/lib/trading/settings/labels'
import { loadTradingSettings } from '@/lib/trading/settings/store'

export const dynamic = 'force-dynamic'

/** 서울 기준 오늘. 설정은 거래일 기준으로 유효한 판을 고른다 */
function todayInSeoul(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())
}

export default async function TradingPage() {
  const now = new Date()
  const today = todayInSeoul()
  const { values, version } = await loadTradingSettings(today)
  const overview = await loadTradingOverview(now)

  const groups = Object.keys(TRADING_GROUP_LABEL) as TradingSettingGroup[]

  return (
    <>
      <PageHeader
        title="AI 트레이딩"
        icon={<CandlestickChart size={22} />}
        description={
          overview.contractCode
            ? `${overview.contractCode} 근월물을 모으는 중입니다. 알림은 검증 단계를 지난 뒤에 켭니다`
            : '아직 월물이 정해지지 않았습니다. 종목 정보가 들어오면 여기에 뜹니다'
        }
      />

      <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
        <BarCoverage days={overview.coverage} />
        <JudgmentList rows={overview.judgments} />

        {overview.recentRuns.length > 0 && (
          <section className="card">
            <h2 style={{ fontSize: 'var(--fs-md)', fontWeight: 600, color: 'var(--text)', margin: 0, marginBottom: 'var(--space-3)' }}>
              최근 실행
            </h2>
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 'var(--space-2)' }}>
              {overview.recentRuns.map((run) => (
                <li key={run.scheduledMinute} style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
                  <span style={{ color: 'var(--text)' }}>{formatKstDateTimeExact(run.scheduledMinute)}</span>
                  {' · '}
                  {run.status}
                  {run.reason ? ` · ${run.reason}` : ''}
                </li>
              ))}
            </ul>
          </section>
        )}

        {groups.map((group) => {
          const rows = TRADING_SETTINGS.filter((s) => s.group === group)
          if (rows.length === 0) return null
          return (
            <section key={group} className="card">
              <h2
                style={{
                  fontSize: 'var(--fs-md)', fontWeight: 600, color: 'var(--text)',
                  margin: 0, marginBottom: 'var(--space-3)',
                }}
              >
                {TRADING_GROUP_LABEL[group]}
              </h2>
              <dl style={{ display: 'grid', gap: 'var(--space-3)', margin: 0 }}>
                {rows.map((s) => (
                  <div
                    key={s.key}
                    style={{
                      display: 'flex', gap: 'var(--space-3)', alignItems: 'baseline',
                      flexWrap: 'wrap', justifyContent: 'space-between',
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <dt style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text)' }}>
                        {s.label}
                      </dt>
                      <dd style={{ margin: 0, fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
                        {s.help}
                      </dd>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>
                        {formatTradingSettingValue(values[s.key])}
                        {s.unit ? <span style={{ color: 'var(--text-muted)' }}> {s.unit}</span> : null}
                      </div>
                      <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
                        {TRADING_USED_FROM_LABEL[s.usedFrom]}
                      </div>
                    </div>
                  </div>
                ))}
              </dl>
            </section>
          )
        })}
      </div>
    </>
  )
}
