// POST /api/crm/metrics/ask — 자연어를 리포트 조건으로
//
// **두 겹이다.** 규칙이 먼저 풀고(무료·즉시), 남은 것만 모델이 맡는다.
// 회사 보강이 할당량 초과로 37건 전부 죽은 전례가 있어서 그렇게 짰다 —
// 모델이 막혀도 「이번 분기 파이프라인별 수주」는 **여전히 된다.**
//
// **쓰기를 하지 않는다.** 도우미는 조건을 만들어 줄 뿐이고, 목표를 바꾸는 것은
// 사람이 목표 설정에서 한다. 되돌리기 어려운 일을 자연어 한 줄에 맡기지 않는다.
import type { NextRequest } from 'next/server'
import { withCrmApi, readJson } from '@/lib/crm/api/handler'
import { getCrmDb } from '@/lib/crm/db/client'
import { loadDealsForMetrics, resolveHint } from '@/lib/crm/services/metric-query'
import { parseReportAsk, type ReportIntent } from '@/lib/crm/domain/report-intent'
import { metricOf, derivedOf, metricCatalog, isKnownMetric } from '@/lib/crm/domain/metrics'
import { dimensionOf, dimensionCatalog, isKnownDimension } from '@/lib/crm/domain/dimensions'
import { periodLabel, formatPeriodKey, parsePeriodKey, periodOfToday } from '@/lib/crm/domain/target'
import { isTimeAxis, TIME_AXIS_LABEL } from '@/lib/crm/domain/metric-agg'
import { kstTodayKey } from '@/lib/datetime/kst'
import { runAi } from '@/lib/crm/ai/runner'
import { adapterFromSetting } from '@/lib/crm/services/quick-create'
import { REPORT_ASK_V1, buildReportAskInput, parseReportAsk as parseAskOutput } from '@/lib/crm/ai/prompts/report-ask.v1'
import { ASSISTANT } from '@/lib/terms/report'
import { iGa } from '@/lib/ui/josa'

/** 물음 길이 상한 — 긴 글을 통째로 넣으면 값 후보가 폭발한다 */
const MAX_ASK = 200

function axisLabel(key: string): string {
  return TIME_AXIS_LABEL[key] ?? dimensionOf(key)?.label ?? key
}

function metricLabel(key: string): string {
  return metricOf(key)?.label ?? derivedOf(key)?.label ?? key
}

/** 모델이 준 것을 **우리가 아는 것만** 통과시킨다 — 없는 축은 엉뚱한 표가 된다 */
function sanitize(raw: unknown, todayKey: string): Partial<ReportIntent> {
  const o = (raw ?? {}) as Record<string, unknown>
  const ax = (v: unknown) => {
    const s = typeof v === 'string' ? v.trim() : ''
    return s && (isTimeAxis(s) || isKnownDimension(s)) ? s : null
  }
  const m = typeof o.metric === 'string' ? o.metric.trim() : ''
  const p = typeof o.period === 'string' ? parsePeriodKey(o.period, periodOfToday('YEAR', todayKey)) : null
  return {
    metric: isKnownMetric(m) ? m : null,
    rows: ax(o.rows),
    cols: ax(o.cols),
    period: typeof o.period === 'string' && o.period.includes(':') ? p : null,
  }
}

export async function POST(req: NextRequest) {
  return withCrmApi('READONLY', async ({ session }) => {
    const body = await readJson(req)
    const text = String(body.text ?? '').slice(0, MAX_ASK)
    const todayKey = kstTodayKey()

    // ① 규칙 — 모델 없이 푼다
    const rule = parseReportAsk(text, todayKey)

    // ② 값 — 실제 축 값에서 찾는다(코드에 값이 없다)
    const db = getCrmDb(session.workspaceId)
    const loaded = await loadDealsForMetrics(db)
    const filters: { dimension: string; value: string; label: string }[] = []
    const leftover: string[] = []
    for (const h of rule.hints) {
      const hit = resolveHint(loaded, h)
      if (hit && !filters.some((f) => f.dimension === hit.dimension)) filters.push(hit)
      else leftover.push(h)
    }

    let intent: ReportIntent = { ...rule, hints: leftover }
    let usedAi = false
    let aiNote: string | null = null

    // ③ 규칙이 못 푼 것이 남았을 때만 모델을 부른다
    const needsAi = text.trim().length > 0 && (!intent.metric || !intent.period || leftover.length > 0)
    if (needsAi) {
      try {
        const adapter = await adapterFromSetting(db)
        const run = await runAi<Record<string, unknown>>({
          db,
          workspaceId: session.workspaceId,
          kind: 'ASSISTANT',
          prompt: REPORT_ASK_V1,
          input: buildReportAskInput({
            todayKey,
            metrics: metricCatalog().map((m) => ({ key: m.key, label: m.label })),
            dimensions: [
              ...Object.entries(TIME_AXIS_LABEL).map(([key, label]) => ({ key, label })),
              ...dimensionCatalog().map((d) => ({ key: d.key, label: d.label })),
            ],
            text,
          }),
          inputRef: { targetType: 'report_ask', text },
          parse: parseAskOutput,
          adapter,
        })
        usedAi = true
        const s2 = sanitize(run.output, todayKey)
        // **규칙이 이긴다.** 모델은 빈 자리만 채운다 — 규칙은 재현되고 모델은 안 된다
        intent = {
          ...intent,
          metric: intent.metric ?? s2.metric ?? null,
          rows: intent.rows ?? s2.rows ?? null,
          cols: intent.cols ?? s2.cols ?? null,
          period: intent.period ?? s2.period ?? null,
        }
      } catch {
        // 실패를 성공처럼 말하지 않는다 — 규칙이 푼 것은 그대로 쓴다
        aiNote = 'AI 를 못 불러서 아는 만큼만 풀었습니다.'
      }
    }

    const unresolved: string[] = []
    if (!intent.metric) unresolved.push('어느 지표를 볼지')
    if (!intent.period) unresolved.push('어느 기간을 볼지')
    // 조사를 화면이 고르지 않는다 — 「먹지이」 같은 줄이 나온다(용어집 §0-2)
    for (const h of intent.hints) unresolved.push(`「${h}」${iGa(h)} 무엇인지`)

    // 실행할 주소 — 화면은 이걸 그대로 연다
    const params: Record<string, string> = {}
    if (intent.metric) params.metric = intent.metric
    if (intent.rows) params.rows = intent.rows
    if (intent.cols) params.cols = intent.cols
    if (intent.period) params.period = formatPeriodKey(intent.period)
    for (const f of filters) params[`f.${f.dimension}`] = f.value

    const readback = [
      intent.period ? periodLabel(intent.period) : null,
      intent.metric ? metricLabel(intent.metric) : null,
      filters.length > 0 ? filters.map((f) => `${axisLabel(f.dimension)} ${f.label}`).join(' · ') : null,
      [intent.rows, intent.cols].filter(Boolean).length > 0
        ? `${[intent.rows, intent.cols].filter(Boolean).map((a) => axisLabel(a as string)).join(' × ')} 로 쪼개서`
        : null,
    ].filter(Boolean).join(' · ')

    return {
      readbackLabel: ASSISTANT.readback,
      readback,
      params,
      filters,
      unresolved,
      usedAi,
      note: aiNote,
      /** 조건이 하나도 안 잡히면 열지 않는다 — 엉뚱한 표를 열지 않는다 */
      runnable: Boolean(intent.metric && intent.period),
    }
  })
}
