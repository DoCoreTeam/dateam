// GET /api/crm/reports — 사업 리포트
//
// 세 관점(영업·매출·현금)이 **같은 응답 안에** 있어야 한다.
// 나눠서 두 번 부르면 화면이 서로 다른 시점의 숫자를 나란히 놓게 되고,
// 그러면 「수주는 3억인데 매출이 5천」 같은 줄이 왜 그런지 설명할 수 없다.
//
// 금액은 문자열로 나간다. BigInt 는 JSON 에 못 싣고, number 로 접으면
// 큰 금액에서 조용히 값이 틀어진다 — 리포트에서 그게 일어나면 아무도 눈치 못 챈다.
import type { NextRequest } from 'next/server'
import { withCrmApi } from '@/lib/crm/api/handler'
import { getCrmDb } from '@/lib/crm/db/client'
import { buildPipelineReport } from '@/lib/crm/services/report'
import { buildVelocity } from '@/lib/crm/services/velocity'
import { buildForecasts } from '@/lib/crm/services/forecast'
import { buildBusinessReport } from '@/lib/crm/services/business-report'
import { periodRange, type PeriodKey, type GroupKey, PERIOD_ORDER, GROUP_ORDER } from '@/lib/crm/domain/report-axis'
import { kstTodayKey } from '@/lib/datetime/kst'

export async function GET(req: NextRequest) {
  return withCrmApi('READONLY', async ({ session }) => {
    const sp = req.nextUrl.searchParams
    const pipelineId = sp.get('pipelineId')?.trim() || undefined

    // 모르는 값은 기본값으로 되돌린다 — 주소를 손으로 고친 사람에게 500 을 주지 않는다
    const rawPeriod = sp.get('period') as PeriodKey | null
    const period = rawPeriod && PERIOD_ORDER.includes(rawPeriod) ? rawPeriod : 'THIS_YEAR'
    const rawGroup = sp.get('groupBy') as GroupKey | null
    const groupBy = rawGroup && GROUP_ORDER.includes(rawGroup) ? rawGroup : 'BUSINESS_TYPE'

    // 「오늘」은 KST 로 정한다 — UTC 로 재면 한국 자정~아침 9시에 어제 달이 나온다
    const range = periodRange(period, kstTodayKey())

    const db = getCrmDb(session.workspaceId)
    // 한 번에 준다 — 두 번 부르면 화면이 두 시점을 섞어 보여 준다
    const [items, velocity, forecast, business] = await Promise.all([
      buildPipelineReport(db, pipelineId),
      buildVelocity(db, pipelineId),
      buildForecasts(db, pipelineId),
      buildBusinessReport(db, { period: range, groupBy, pipelineId }),
    ])
    return { items, velocity, forecast, business, period, groupBy }
  })
}
