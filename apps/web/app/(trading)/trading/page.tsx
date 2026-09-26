// app/(trading)/trading/page.tsx — 현황
//
// **왜 여기에 셋만 있나** (사용자 지적 2026-09-27: 「지금 화면 스크롤은 너무 과한데?」):
// 이 화면은 패널 12개 + 최근 실행 + 설정 묶음 15개를 한 장에 세로로 쌓고 있었다.
// 매일 보는 것은 「신호가 나갔나 · 지금 뭘 들고 있나 · 알림이 켜져 있나」 셋인데,
// 그 셋을 보려고 나머지 전부를 스크롤로 지나야 했다.
//
// 나머지는 사라지지 않았다. 사이드바의 다른 자리로 갔고 목록은 `lib/trading/nav/groups.ts` 다.

import { CandlestickChart } from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'
import SignalPanel from './SignalPanel'
import PositionPanel from './PositionPanel'
import NotifyPanel from './NotifyPanel'
import { loadTradingOverview } from '@/lib/trading/overview'
import { loadTradingSettings } from '@/lib/trading/settings/store'
import { kstTodayKey } from '@/lib/datetime/kst'
import { TRADING_NAV_LABEL } from '@/lib/terms'

export const dynamic = 'force-dynamic'

export default async function TradingPage() {
  const { values } = await loadTradingSettings(kstTodayKey())
  const overview = await loadTradingOverview(new Date())

  // 유효 시간은 설정이다. 화면이 따로 정하면 규칙과 화면이 다른 마감을 본다
  const rawValid = Number(values.signal_valid_minutes)
  const validMinutes = Number.isFinite(rawValid) && rawValid > 0 ? rawValid : 10

  return (
    <>
      <PageHeader
        title={TRADING_NAV_LABEL.overview}
        icon={<CandlestickChart size={22} />}
        description={
          overview.contractCode
            ? `${overview.contractCode} 근월물을 모으는 중입니다. 알림은 검증 단계를 지난 뒤에 켭니다`
            : '아직 월물이 정해지지 않았습니다. 종목 정보가 들어오면 여기에 뜹니다'
        }
      />

      <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
        <SignalPanel
          rows={overview.signals}
          validMinutes={validMinutes}
          notifyEnabled={overview.notify.enabled}
          emitProgress={overview.emitProgress}
        />
        <PositionPanel holding={overview.holding} dayPnl={overview.dayPnl} />
        <NotifyPanel notify={overview.notify} position={overview.position} />
      </div>
    </>
  )
}
