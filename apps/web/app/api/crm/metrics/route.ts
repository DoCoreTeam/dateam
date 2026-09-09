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
import type { Prisma } from '@prisma/client'
import { withCrmApi } from '@/lib/crm/api/handler'
import { CrmError } from '@/lib/crm/domain/errors'
import { getCrmDb } from '@/lib/crm/db/client'
import { withCrmTx } from '@/lib/crm/db/tx'
import { loadDealsForMetrics, runMetrics, dimensionFill, filterLabel } from '@/lib/crm/services/metric-query'
import { loadTargets, saveTargets } from '@/lib/crm/services/target-store'
import { loadCloses, saveCloses } from '@/lib/crm/services/close-store'
import { findClose, isClosable, closeBlockedReason, moveClose, isLive, type CloseStateKey } from '@/lib/crm/domain/close'
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
    const [loaded, targets, closes] = await Promise.all([loadDealsForMetrics(db), loadTargets(db), loadCloses(db)])

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
      // 마감 — 이 기간이 닫혔나. 닫혔으면 화면은 박아 둔 숫자를 함께 보여 준다
      close: (() => {
        const key = formatPeriodKey(period)
        const rec = findClose(closes, key)
        return {
          periodKey: key,
          state: (rec?.state ?? 'draft') as CloseStateKey,
          revision: rec?.revision ?? 0,
          confirmedAt: rec?.confirmedAt ?? null,
          snapshot: rec?.snapshot ?? {},
          live: isLive(rec?.state ?? 'draft'),
          closable: isClosable(period, todayKey),
          blockedReason: closeBlockedReason(period, todayKey),
        }
      })(),
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
  // 목표·마감은 모두가 보는 숫자를 바꾼다 — 화면에서만 숨기면 API 로 새어 나간다
  return withCrmApi('ADMIN', async ({ session }) => {
    const body = (await req.json().catch(() => ({}))) as {
      targets?: unknown
      close?: { period?: string; state?: string }
    }
    const db = getCrmDb(session.workspaceId)
    const tx = <T>(fn: (t: Prisma.TransactionClient) => Promise<T>): Promise<T> =>
      withCrmTx(session.workspaceId, fn as never, db as never) as Promise<T>

    if (body.close) {
      const todayKey = kstTodayKey()
      const period = parsePeriodKey(body.close.period ?? null, periodOfToday('MONTH', todayKey))
      const to = String(body.close.state ?? '') as CloseStateKey

      // **끝나지 않은 기간은 못 닫는다** — 남은 날의 수주가 영원히 빠진다
      if (to === 'confirmed' && !isClosable(period, todayKey)) {
        throw new CrmError('VALIDATION_FAILED', closeBlockedReason(period, todayKey) ?? '아직 마감할 수 없습니다.')
      }

      const [loaded, closes] = await Promise.all([loadDealsForMetrics(db), loadCloses(db)])
      const key = formatPeriodKey(period)
      // 확정 시점의 숫자를 박는다 — 통화별로 나눠 남긴다(합치면 되돌릴 수 없다)
      const snap = runMetrics(loaded, CARD_METRICS.map((m): QuerySpec => ({
        metric: m, period, todayKey, filters: [],
      })))
      const snapshot: Record<string, string> = {}
      const byCurrency: Record<string, Record<string, string>> = {}
      for (const r of snap) {
        snapshot[r.metric] = r.unit === 'money'
          ? (r.total.byCurrency.KRW ?? '0')
          : String(r.total.count)
        if (r.unit === 'money') byCurrency[r.metric] = r.total.byCurrency
      }

      let next
      try {
        next = moveClose(findClose(closes, key), to, {
          snapshot, byCurrency, at: new Date().toISOString(), by: session.memberId ?? null, periodKey: key,
        })
      } catch (e) {
        throw new CrmError('VALIDATION_FAILED', e instanceof Error ? e.message : '마감 상태를 바꾸지 못했습니다.')
      }
      const saved = await saveCloses(db, tx, [...closes.filter((c) => c.periodKey !== key), next], session.memberId ?? null)
      return { closes: saved }
    }

    const targets = await saveTargets(db, tx, body.targets, session.memberId ?? null)
    return { targets }
  })
}
