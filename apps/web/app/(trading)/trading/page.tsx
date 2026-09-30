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
import AccuracyPanel from './AccuracyPanel'
import LineagePanel from './LineagePanel'
import PositionPanel from './PositionPanel'
import NotifyPanel from './NotifyPanel'
import { loadTradingOverview } from '@/lib/trading/overview'
import { contractHeadline } from '@/lib/trading/overview-labels'
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

  // 다시 읽는 간격도 설정이다. env 에 두면 값을 바꾸려고 배포를 기다려야 한다
  const rawRefresh = Number(values.overview_refresh_seconds)
  const refreshSeconds = Number.isFinite(rawRefresh) && rawRefresh >= 5 ? rawRefresh : 10

  return (
    <>
      <PageHeader
        title={TRADING_NAV_LABEL.overview}
        icon={<CandlestickChart size={22} />}
        /*
          **머리글은 무엇을 보는 화면인지 하나만 말한다.**

          사용자 개입 2026-09-30: 「A05610 근월물을 모으는 중입니다. 알림은 검증 단계를
          지난 뒤에 켭니다 — 이런 내용은 또 왜 있는지 모르겠네」. 한 줄에 사실이 둘 섞여
          있었고 둘 다 읽는 사람 것이 아니었다. 「근월물」은 선물 용어이고, 알림 이야기는
          아래 알림 칸이 이미 하는 말이다 — 같은 말이 두 곳에 있으면 둘이 갈린다.
        */
        description={contractHeadline(overview.contract)}
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
          lastPrice={overview.lastPrice}
          /* 점을 돈으로 바꾸는 값. 성적표가 이미 읽어 둔 것을 돌려 쓴다 — 두 곳이 다른 승수를 쓰면 같은 값이 두 금액이 된다 */
          multiplier={overview.accuracy.multiplier}
          /* 판단이 얼마나 쓸 만한가. 설정값이고 화면이 따로 정하면 규칙과 다른 마감을 본다 */
          validMinutes={validMinutes}
        />
        {/*
          **차트 바로 아래가 성적이다.** 지금 예측을 보고 나면 다음 질문은
          「그래서 이 예측이 그동안 맞았나」다 — 그 답이 멀리 있으면 아무도 안 찾는다
        */}
        <AccuracyPanel accuracy={overview.accuracy} />
        {/*
          **성적 바로 아래가 계보다.** 「그동안 얼마나 벌었나」를 보고 나면 다음 질문이
          「그래서 이 판단이 어떻게 나온 건가」다 — 그 답이 멀리 있으면 아무도 안 찾는다
        */}
        <LineagePanel lineage={overview.lineage} jev={overview.jev} />
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
