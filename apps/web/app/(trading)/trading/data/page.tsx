// app/(trading)/trading/data/page.tsx — 자료
//
// 판단의 재료가 제대로 모이고 있나. 봉이 빠진 구간은 파일로 채우고,
// 이벤트는 그 시각 앞뒤로 신호를 막는 근거가 된다.

import { Database } from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'
import BarCoverage from '../BarCoverage'
import CsvImportPanel from '../CsvImportPanel'
import EventPanel from '../EventPanel'
import { loadTradingOverview } from '@/lib/trading/overview'
import { loadTradingSettings } from '@/lib/trading/settings/store'
import { listEvents } from '@/lib/trading/calendar/events'
import { kstTodayKey } from '@/lib/datetime/kst'
import { TRADING_NAV_LABEL } from '@/lib/terms'

export const dynamic = 'force-dynamic'

export default async function TradingDataPage() {
  const { values } = await loadTradingSettings(kstTodayKey())
  const overview = await loadTradingOverview(new Date())
  /**
   * 이벤트 목록. 못 읽어도 화면은 서야 한다 — 곁가지가 본 일을 죽이지 않는다.
   * 판단 쪽은 못 읽으면 막는 쪽으로 가지만(tick), 화면은 비어 보이면 된다.
   */
  const events = await listEvents().catch(() => [])

  /** 설정값 하나를 숫자로. 화면이 자기 상수를 들면 규칙과 다른 값을 그린다 */
  const numSetting = (key: string, fallback: number): number => {
    const raw = Number(values[key])
    return Number.isFinite(raw) ? raw : fallback
  }

  return (
    <>
      <PageHeader
        title={TRADING_NAV_LABEL.data}
        icon={<Database size={22} />}
        description="봉이 빠진 구간은 판단에서 빠집니다. 빈 구간은 파일로 채울 수 있습니다"
      />
      <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
        <BarCoverage days={overview.coverage} />
        <CsvImportPanel contractCode={overview.contractCode} />
        <EventPanel
          rows={events.map((e) => ({ id: e.id, name: e.name, occursAt: e.occursAt }))}
          beforeMinutes={numSetting('signal_event_block_before_minutes', 30)}
          afterMinutes={numSetting('signal_event_block_after_minutes', 15)}
        />
      </div>
    </>
  )
}
