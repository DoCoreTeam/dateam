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
import ChartPanel from './ChartPanel'
import LiveRefresh from './LiveRefresh'
import SignalPanel from './SignalPanel'
import PositionPanel from './PositionPanel'
import NotifyPanel from './NotifyPanel'
import JevPanel from './JevPanel'
import PushPanel from './PushPanel'
import { loadTradingOverview } from '@/lib/trading/overview'
import { getPushKey } from './actions'
import { loadTradingSettings } from '@/lib/trading/settings/store'
import { kstTodayKey } from '@/lib/datetime/kst'
import { TRADING_NAV_LABEL } from '@/lib/terms'

export const dynamic = 'force-dynamic'

export default async function TradingPage() {
  const { values } = await loadTradingSettings(kstTodayKey())
  const overview = await loadTradingOverview(new Date())
  // 공개 열쇠만 내려간다. 비밀키는 server-only 모듈 밖으로 안 나온다(S3)
  const pushKey = await getPushKey()

  // 유효 시간은 설정이다. 화면이 따로 정하면 규칙과 화면이 다른 마감을 본다
  const rawValid = Number(values.signal_valid_minutes)
  const validMinutes = Number.isFinite(rawValid) && rawValid > 0 ? rawValid : 10

  // 다시 읽는 간격도 설정이다. env 에 두면 값을 바꾸려고 배포를 기다려야 한다
  const rawRefresh = Number(values.overview_refresh_seconds)
  const refreshSeconds = Number.isFinite(rawRefresh) && rawRefresh >= 5 ? rawRefresh : 30

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
        {/* 화면이 스스로 다시 읽는다. 마지막으로 읽은 때를 이 줄이 말한다 */}
        <LiveRefresh everySeconds={refreshSeconds} lastBarAt={overview.chart.lastBarAt} />
        {/*
          **맨 위가 그림이다.** 사용자 지적 2026-09-28 「차트 보이고 예측한 답은
          어디서 보는 거야? 그게 메인이어야 될 텐데」 — 숫자 표를 먼저 세우면
          가격이 어디로 갔는지를 보려고 표 두 개를 눈으로 맞춰야 한다
        */}
        <ChartPanel
          chart={overview.chart}
          signals={overview.signals}
          emitProgress={overview.emitProgress}
        />
        {/* 꺼져 있을 때만 그린다. 켜져 있으면 이 자리가 없다 */}
        <JevPanel jev={overview.jev} />
        <SignalPanel
          rows={overview.signals}
          validMinutes={validMinutes}
          notifyEnabled={overview.notify.enabled}
          emitProgress={overview.emitProgress}
        />
        <PositionPanel holding={overview.holding} dayPnl={overview.dayPnl} />
        <NotifyPanel notify={overview.notify} position={overview.position} />
        {/* 알림을 켜 놓아도 받을 기기가 없으면 화면에만 남는다 */}
        <PushPanel publicKey={pushKey.publicKey} />
      </div>
    </>
  )
}
