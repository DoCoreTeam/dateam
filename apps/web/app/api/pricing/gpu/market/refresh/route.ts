import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import { saveCompetitorPrices } from '@/lib/gpu/competitor-import'
import { getGeminiConfig, fetchUrlText, callGeminiOnce } from '@/lib/gpu/extract-helpers'
import { buildMarketRefreshCompetitorItem, type RawMarketRefreshItem, type FxSnapshot } from '@/lib/gpu/market-refresh-item'
import type { FxKrwMap } from '@/lib/gpu/normalize-money'
import { kstTodayKey } from '@/lib/datetime/kst'

// R2 재설계(v0.7.351) — AI는 원본(amount/currency/pricing_unit/gpu_count/context)만 보고, 산술은 100% 코드가 한다.
//   SSOT: 시간계수=lib/gpu/hours.ts, 통화환산=lib/gpu/normalize-money.ts, 세그먼트판정=lib/gpu/observation-classify.ts,
//   조립=lib/gpu/market-refresh-item.ts(buildMarketRefreshCompetitorItem). 과거 CLASSIFY_PROMPT의 "월÷720" 등
//   AI 자체환산·USD 단일통화(competitorPriceToUsd)·본문 15k 절단은 전부 폐기(review/stream 경로와 동일 정책 통일).
const CLASSIFY_PROMPT = `당신은 GPU 클라우드 가격 분석 AI입니다. 입력된 내용을 분석하여 분류하세요.

분류 기준:
- competitor_pricing: RunPod, Lambda Labs, AWS, CoreWeave, Vast.ai, NHN Cloud, NAVER Cloud, Azure, GCP, Runyour AI, SaladCloud 등 경쟁 클라우드 서비스의 GPU 가격 정보
- supplier_quote: AX사업본부가 구매/공급받는 GPU 하드웨어/클라우드 자원 견적 (공급사로부터 받은 견적)

【중요 — 산술 절대 금지. 원본 그대로만 보고하세요. 시간환산·장수분할·환율계산은 전부 서버가 합니다】
- amount: 원문에 표기된 금액 숫자만(콤마 제거, 나누지 마세요). 예) "$138.54/월(8장 기준)" → amount: 138.54 (÷8, ÷720 절대 금지)
- currency: 통화 ISO 코드("USD"|"KRW"|"JPY"|"EUR"|"CNY" 등). 통화 기호(₩/円/¥/€/元)나 표기로 판별. 판별 불가면 "USD".
- pricing_unit: 원문의 청구 주기 그대로 하나만: "hour"|"day"|"month"|"year". 판별 불가면 "hour".
- gpu_count: 이 amount가 포함하는 GPU 장수(예: "8장 기준", "×8", "8 GPUs"). 명시 없으면 1.
- context: 가격 판정에 쓴 원문 근거 문구(라벨+숫자+단위, 200자 이내) — 번들·최소약정 등 판정에 서버가 사용.

competitor_pricing인 경우 JSON 반환:
{
  "type": "competitor",
  "items": [
    {
      "competitor_name": "회사명",
      "model_name": "H100",
      "memory": "80GB",
      "amount": 3615,
      "currency": "KRW",
      "pricing_unit": "hour",
      "gpu_count": 1,
      "pricing_model": "on-demand",
      "context": "H100 80GB 온디맨드 3,615원/시간",
      "notes": "원문 표기 그대로(참고용)"
    }
  ]
}

pricing_model 값: "on-demand" | "reserved-1y" | "reserved-3y" | "spot"
memory 값: "80GB", "40GB", "24GB" 등 숫자+단위

【선택 — 복합요금(기본료+종량+스토리지 등 여러 성분으로 구성된 청구) 감지 시에만 components 추가】
원문이 "기본료 + GPU 종량 + 스토리지"처럼 명확히 분리된 여러 요금 성분을 보여줄 때만, 각 성분을 원본 그대로(산술 없이) 보고하세요.
그 외(단일 요금)에는 components를 아예 생략하세요.
{
  "components": [
    { "component_kind": "base_fee", "amount": 30000, "currency": "JPY", "unit": "month", "provenance": "월額基本料金 30,000円" },
    { "component_kind": "usage", "amount": 7.2, "currency": "JPY", "unit": "minute", "gpu_count": 1, "provenance": "GPU利用料金 7.2円/1分" },
    { "component_kind": "storage", "amount": 1000, "currency": "JPY", "unit": "per_gb", "provenance": "ストレージ 1,000円/100GB" }
  ]
}
component_kind 값: "base_fee"(계정 고정비) | "usage"(GPU 종량) | "storage"(용량) | "flat"(월정액 번들 총액)
unit 값: "minute"|"hour"|"day"|"week"|"month"|"year"|"per_gb"|"per_account"

supplier_quote이거나 GPU 가격이 아닌 경우:
{ "type": "supplier" }

JSON만 반환. 설명 없이.`

// POST /api/pricing/gpu/market/refresh
// DB에 저장된 URL들을 AI로 분석해서 market_prices 업데이트
export async function POST(req: Request) {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error

  // 자동 수집 모드(?auto=1) — 그날 첫 접속자가 1회만 구동. run_date(KST) 멱등키로 하루 1회·경합방지. (헌법 제10조)
  const isAuto = new URL(req.url).searchParams.get('auto') === '1'
  const runDate = kstTodayKey()  // KST 기준 '오늘'

  const adminClient = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = adminClient as any

  if (isAuto) {
    // 오늘 실행 기록을 선점(INSERT). 기본키 충돌=이미 누군가 오늘 돌림 → 조용히 스킵.
    const { error: claimErr } = await db.from('market_refresh_runs')
      .insert({ run_date: runDate, status: 'running', trigger_source: 'first-visit' })
    if (claimErr) {
      // 23505=unique_violation → 이미 오늘 돌았음(정상 스킵). 그 외(DB 장애 등)는 원인을 서버 로그로 남긴다(가시성).
      if (claimErr.code && claimErr.code !== '23505') console.error('[gpu/market/refresh] auto claim 실패:', claimErr)
      return NextResponse.json({ skipped: true, reason: claimErr.code === '23505' ? 'already_ran_today' : 'claim_failed', run_date: runDate })
    }
  }

  // Gemini 설정(SSOT — review/stream과 동일 org_content META 조회 재사용, 복사본 금지)
  const { apiKey, model } = await getGeminiConfig(adminClient)

  if (!apiKey) {
    if (isAuto) await db.from('market_refresh_runs').update({ status: 'error', finished_at: new Date().toISOString(), error: 'AI 키가 설정되지 않았습니다' }).eq('run_date', runDate)
    return NextResponse.json({ error: 'AI 키가 설정되지 않았습니다' }, { status: 500 })
  }

  // 활성 매핑 + 경쟁사 URL 조회
  const { data: mappings, error: mapErr } = await db
    .from('competitor_product_mapping')
    .select(`
      id, competitor_url,
      competitors!competitor_id(id, name, pricing_url)
    `)
    .eq('is_active', true)

  if (mapErr) {
    if (isAuto) await db.from('market_refresh_runs').update({ status: 'error', finished_at: new Date().toISOString(), error: '매핑 조회 실패' }).eq('run_date', runDate)
    return NextResponse.json({ error: mapErr.message }, { status: 500 })
  }

  // URL 수집: competitor_url 우선, 없으면 pricing_url
  const urlSet = new Map<string, string>() // url → competitor name
  for (const m of (mappings ?? [])) {
    const compUrl = m.competitor_url as string | null
    const pricingUrl = m.competitors?.pricing_url as string | null
    const compName = m.competitors?.name as string ?? 'unknown'
    const url = compUrl || pricingUrl
    if (url && !urlSet.has(url)) {
      urlSet.set(url, compName)
    }
  }

  if (urlSet.size === 0) {
    if (isAuto) await db.from('market_refresh_runs').update({ status: 'done', finished_at: new Date().toISOString(), urls_checked: 0, prices_updated: 0 }).eq('run_date', runDate)
    return NextResponse.json({
      message: '분석할 URL이 없습니다. 경쟁사에 pricing_url을 등록하거나 매핑에 competitor_url을 추가하세요.',
      urls_checked: 0,
      prices_updated: 0,
    })
  }

  const results: {
    url: string; competitor: string; prices_found: number
    held?: number; rejected?: number; fx_unresolved?: number; components_saved?: number; error?: string
  }[] = []
  let totalPricesUpdated = 0

  // 다통화 환율맵(fx_rates_multi SSOT) — 통화환산은 100% 코드가 한다(amountToKrw). AI 자체환산 폐기.
  //   KRW=그대로, USD=fx_rates.usd_krw(폴백 1400), 그 외는 fx_rates_multi(krw_per_1)에 있을 때만 지원.
  const { data: fxRow } = await db.from('fx_rates').select('usd_krw').order('rate_date', { ascending: false }).limit(1).maybeSingle()
  const krwPerUsd = typeof fxRow?.usd_krw === 'number' && fxRow.usd_krw > 0 ? fxRow.usd_krw : 1400
  const { data: fxMultiRows } = await db.from('fx_rates_multi')
    .select('currency, krw_per_1, rate_date').order('rate_date', { ascending: false }).limit(60)
  const fxMap: FxKrwMap = { KRW: 1, USD: krwPerUsd }
  let fxRateDate: string | null = null
  for (const r of (fxMultiRows ?? []) as Array<{ currency: string; krw_per_1: number; rate_date: string }>) {
    if (fxRateDate === null) fxRateDate = r.rate_date
    if (r.rate_date === fxRateDate && fxMap[r.currency] === undefined) fxMap[r.currency] = r.krw_per_1
  }
  const fxSnapshot: FxSnapshot = { fxMap, krwPerUsd, fxRateDate, fxSource: 'koreaexim' }

  for (const [url, compName] of Array.from(urlSet.entries())) {
    try {
      // 본문 수집 SSOT(review/stream과 동일) — 표 구조 보존 파서 + JS렌더 사이트 헤드리스 폴백.
      //   구 로컬 구현(15k 절단·word-soup)은 폐기.
      const { text: pageText } = await fetchUrlText(url)
      if (!pageText) {
        console.error('[gpu/market/refresh] 페이지 로드 실패:', url)
        results.push({ url, competitor: compName, prices_found: 0, error: '페이지 로드 실패' })
        continue
      }

      let rawText: string
      try {
        rawText = await callGeminiOnce(apiKey, model, `${CLASSIFY_PROMPT}\n\n입력:\n${pageText}`, true)
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'AI 호출 실패'
        console.error('[gpu/market/refresh] AI 분류 호출 실패:', url, msg)
        results.push({ url, competitor: compName, prices_found: 0, error: msg })
        continue
      }

      let classified: { type?: string; items?: RawMarketRefreshItem[] }
      try { classified = JSON.parse(rawText) } catch {
        console.error('[gpu/market/refresh] AI 응답 파싱 실패:', url)
        results.push({ url, competitor: compName, prices_found: 0, error: 'AI 응답 파싱 실패' })
        continue
      }

      if (classified.type === 'competitor' && Array.isArray(classified.items) && classified.items.length > 0) {
        // 조립 SSOT(market-refresh-item.ts) — 시간계수÷통화환산÷세그먼트판정 전부 코드가 수행(AI 산술 없음).
        const built = (classified.items as RawMarketRefreshItem[])
          .map((raw) => buildMarketRefreshCompetitorItem(raw, fxSnapshot))
          .filter((it): it is NonNullable<typeof it> => it !== null)

        // 무음 소실 금지 — 원본 금액은 있는데 통화 미지원(fx_rates_multi에 없는 통화)이라 price_usd가
        //   null로 보류된 건수를 saveCompetitorPrices 진입 전에 여기서 집계해 노출한다.
        //   (saveCompetitorPrices는 price_usd falsy면 held/rejected 집계 없이 조용히 continue하므로 여기서 세지 않으면 무음 드롭이 된다)
        const fxUnresolved = built.filter((it) => it.price_usd == null && it.obs?.amount != null).length
        const componentsSaved = built.reduce((sum, it) => sum + (it.components?.length ?? 0), 0)

        // H1 게이트(validateCompetitorItem)는 saveCompetitorPrices 내부에서 강제 — 자동 크롤 경로도 GPU 아님·이상가 차단.
        const { saved, held, rejected } = await saveCompetitorPrices(db, built, { sourceUrl: url, confidence: 80 })
        results.push({
          url, competitor: compName, prices_found: saved.length,
          ...(held.length ? { held: held.length } : {}),
          ...(rejected.length ? { rejected: rejected.length } : {}),
          ...(fxUnresolved ? { fx_unresolved: fxUnresolved } : {}),
          ...(componentsSaved ? { components_saved: componentsSaved } : {}),
        })
        totalPricesUpdated += saved.length
      } else {
        results.push({ url, competitor: compName, prices_found: 0 })
      }
    } catch (err) {
      console.error('[gpu/market/refresh] url fetch/parse 실패:', url, err)  // 상세는 서버 로그만
      results.push({ url, competitor: compName, prices_found: 0, error: err instanceof Error ? err.message : '수집 실패' })
    }
  }

  // 무음 실패 방지(fire-and-forget 경로라 실패가 화면에 안 뜬다) — 실패·보류 요약을 run 기록+서버 로그에 남긴다.
  const failedUrls = results.filter((r) => !!r.error)
  const heldTotal = results.reduce((s, r) => s + (r.held ?? 0), 0)
  const rejectedTotal = results.reduce((s, r) => s + (r.rejected ?? 0), 0)
  const fxUnresolvedTotal = results.reduce((s, r) => s + (r.fx_unresolved ?? 0), 0)
  const hasIssues = failedUrls.length > 0 || heldTotal > 0 || rejectedTotal > 0 || fxUnresolvedTotal > 0
  const issueSummary = hasIssues
    ? JSON.stringify({
        failed_urls: failedUrls.map((r) => ({ url: r.url, error: r.error })),
        held: heldTotal, rejected: rejectedTotal, fx_unresolved: fxUnresolvedTotal,
      })
    : null
  if (issueSummary) console.error('[gpu/market/refresh] 부분 실패/보류 요약:', issueSummary)
  // 전체 URL이 전부 실패(저장 0건 + 전 URL 오류)면 상태를 error로 — 그 외(일부만 실패/보류)는 done 유지하되 error 필드에 요약 기록.
  const allFailed = urlSet.size > 0 && totalPricesUpdated === 0 && failedUrls.length === urlSet.size

  if (isAuto) {
    await db.from('market_refresh_runs').update({
      status: allFailed ? 'error' : 'done',
      finished_at: new Date().toISOString(),
      urls_checked: urlSet.size,
      prices_updated: totalPricesUpdated,
      ...(issueSummary ? { error: issueSummary } : {}),
    }).eq('run_date', runDate)
  }

  return NextResponse.json({
    urls_checked: urlSet.size,
    prices_updated: totalPricesUpdated,
    results,
  })
}
