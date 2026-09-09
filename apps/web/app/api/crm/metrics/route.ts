// GET /api/crm/metrics — 선언형 지표 조회
// PUT /api/crm/metrics — 목표 저장
//
// **한 번에 준다.** 카드 아홉 개를 그리려고 아홉 번 부르면 화면이 아홉 시점을
// 나란히 놓게 되고, 「수주는 3억인데 파이프라인이 0」 같은 줄을 설명할 수 없다.
// 딜을 한 번 읽어 같은 배열 위에서 지표를 전부 돌린다.
//
// 금액은 문자열로 나간다 — BigInt 는 JSON 에 못 싣고, number 로 접으면 큰 금액에서
// 조용히 값이 틀어진다. 리포트에서 그게 일어나면 아무도 눈치 못 챈다.
import type { NextRequest } from 'next/server'
import { withCrmApi } from '@/lib/crm/api/handler'
import { getCrmDb } from '@/lib/crm/db/client'
import { withCrmTx } from '@/lib/crm/db/tx'
import { loadDealsForMetrics, runMetrics, dimensionFill, filterLabel } from '@/lib/crm/services/metric-query'
import { loadTargets, saveTargets } from '@/lib/crm/services/target-store'
import { metricCatalog, isKnownMetric } from '@/lib/crm/domain/metrics'
import { dimensionCatalog, isKnownDimension, DIMENSIONS } from '@/lib/crm/domain/dimensions'
import { parsePeriodKey, periodOfToday, formatPeriodKey } from '@/lib/crm/domain/target'
import { isTimeAxis, type QuerySpec } from '@/lib/crm/domain/metric-agg'
import { kstTodayKey } from '@/lib/datetime/kst'

/** 첫 화면 카드에 서는 지표 — 영업이 말하는 순서(아직 안 판 것 → 판 것 → 밀린 것) */
const CARD_METRICS = [
  'open_pipeline', 'weighted', 'bookings',
  'new_deals', 'won_count', 'lost_count',
  'overdue', 'stalled',
] as const

/** 모르는 축 이름은 조용히 버린다 — 없는 축으로 500 을 주지 않는다 */
function axisOrNull(raw: string | null): string | null {
  const v = raw?.trim()
  if (!v) return null
  return isTimeAxis(v) || isKnownDimension(v) ? v : null
}

export async function GET(req: NextRequest) {
  return withCrmApi('READONLY', async ({ session }) => {
    const sp = req.nextUrl.searchParams
    const todayKey = kstTodayKey()

    // 못 읽는 값은 기본값으로 되돌린다 — 주소를 손으로 고친 사람에게 500 을 주지 않는다
    const period = parsePeriodKey(sp.get('period'), periodOfToday('YEAR', todayKey))
    const rows = axisOrNull(sp.get('rows'))
    const cols = axisOrNull(sp.get('cols'))
    const rawMetric = sp.get('metric')?.trim() || ''
    const metric = isKnownMetric(rawMetric) ? rawMetric : null

    // 조건은 f.<축>=<값> 으로 온다. 축을 아는 것만 받는다
    const filters: { dimension: string; value: string }[] = []
    sp.forEach((v, k) => {
      if (!k.startsWith('f.') || !v.trim()) return
      const dim = k.slice(2)
      if (isKnownDimension(dim)) filters.push({ dimension: dim, value: v.trim() })
    })

    const db = getCrmDb(session.workspaceId)
    const [loaded, targets] = await Promise.all([loadDealsForMetrics(db), loadTargets(db)])

    const base = { period, todayKey, filters }
    const cards = runMetrics(loaded, CARD_METRICS.map((m): QuerySpec => ({ ...base, metric: m })))
    // 교차표는 고른 지표가 있을 때만 — 없으면 화면이 카드만 그린다
    const matrix = metric ? runMetrics(loaded, [{ ...base, metric, rows, cols }])[0] : null

    // 축이 지금 쓸 만한지 함께 준다 — 「없음 한 줄」을 데이터가 없는 것으로 읽지 않게
    const fill: Record<string, { filled: number; total: number }> = {}
    for (const d of DIMENSIONS) fill[d.key] = dimensionFill(loaded, d.key)

    return {
      period: formatPeriodKey(period),
      from: cards[0]?.from ?? null,
      to: cards[0]?.to ?? null,
      todayKey,
      rows, cols, metric,
      // 조건은 id 로 실려 오지만 화면은 이름을 그린다 — 이름을 여기서 붙여 보낸다
      filters: filters.map((f) => ({ ...f, label: filterLabel(loaded, f.dimension, f.value) })),
      cards, matrix, targets,
      catalog: { metrics: metricCatalog(), dimensions: dimensionCatalog() },
      notes: {
        // 조용히 자르면 「이게 전부」로 읽고 보고에 쓴다
        truncated: loaded.truncated,
        dealCount: loaded.deals.length,
        hiddenPipelines: loaded.hiddenPipelines,
        fill,
      },
    }
  })
}

export async function PUT(req: NextRequest) {
  // 목표는 모두의 달성률을 바꾼다 — 화면에서만 숨기면 API 로 새어 나간다
  return withCrmApi('ADMIN', async ({ session }) => {
    const body = await req.json().catch(() => ({}))
    const db = getCrmDb(session.workspaceId)
    const targets = await saveTargets(
      db,
      (fn) => withCrmTx(session.workspaceId, fn, db as never),
      (body as { targets?: unknown }).targets,
      session.memberId ?? null,
    )
    return { targets }
  })
}
