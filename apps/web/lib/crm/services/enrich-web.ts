/**
 * 회사 정보를 **웹에서 찾아** 빈 칸을 채운다
 *
 * **왜 이 파일이 생겼나**: 회사 목록의 산업·지역이 전부 비어 있었다(실측: 화면 전체가 "—").
 * 사람이 인터넷에서 5초면 확인하는 값들인데, 수백 건을 손으로 채우는 일은 아무도 끝내지 못한다.
 * 그래서 인박스는 채울 거리가 없었고, 회사 목록은 이름과 도메인만 있는 명부로 남았다.
 *
 * 붙여넣기 보강(`enrich.ts`)과 **규칙은 같다** — 빈 칸만, 같은 값이면 안 보냄, 근거 필수.
 * 그 규칙을 여기서 다시 쓰지 않고 `enrichFromText` 를 그대로 부른다(재사용·단일구현 정책).
 * 다른 것은 딱 둘이다.
 *
 *   ① **근거가 원문 인용이 아니라 출처 URL 이다.** 웹에는 인용할 원문이 없다.
 *   ② **신뢰도를 경우마다 다르게 매긴다.** 아래가 이 파일의 핵심 판단이다.
 *
 * ## 신뢰도를 왜 나누나
 *
 * 같은 이름의 회사는 아주 흔하다. 이름만으로 찾은 회사 정보를 그대로 채우면
 * 영업 담당자는 **다른 회사의 산업군**을 보고 제안을 준비한다. 그 값은 나중에 진짜처럼 읽힌다.
 *
 * 그런데 도메인이 있으면 이야기가 다르다. 도메인은 그 회사가 실제로 운영하는 주소라
 * 동명이인 문제가 사라진다 — 사람이 확인해도 같은 결론이 나온다.
 *
 * 그래서:
 *   · **도메인으로 특정** → 0.9 → 판정 규칙(apply-policy)이 자동 반영을 연다(빈 칸이므로 덮어쓰기가 아니다)
 *   · **이름만으로 특정** → 0.75 → 인박스로 간다. 사람이 `matchReason` 을 읽고 고른다
 *   · **특정 실패** → 아무것도 만들지 않는다. 0.75 짜리 쓰레기가 인박스에 쌓이면 사람은 인박스를 안 본다
 *
 * 문턱(0.85)은 우리가 여기서 정하지 않는다 — `apply-policy.ts` 가 정하고, 사람이 검증 확정한
 * 필드(verifiedFields)는 어떤 신뢰도에서도 자동 반영되지 않는다. 우리는 **정직한 확신**만 매긴다.
 */

import type { CrmDb } from '../db/client.ts'
import { CrmError, stopsBatch } from '../domain/errors.ts'
import { runAi, type AiAdapter, type AiSource } from '../ai/runner.ts'
import { COMPANY_ENRICH_V1, buildCompanyEnrichInput } from '../ai/prompts/company-enrich.v1.ts'
import { parseCompanyEnrich, ENRICHABLE_FIELDS } from '../ai/schemas/company-enrich.ts'
import { getCompany, type CompanyRow } from './company.ts'
import { enrichFromText } from './enrich.ts'
// 상한·신뢰도는 화면·가드와 함께 보는 값이라 순수 모듈에 있다 — 두 곳에 적으면 언젠가 한쪽만 바뀐다
import { ENRICH_BULK_MAX, enrichConfidence } from '../domain/enrich-limits.ts'

export { ENRICH_BULK_MAX }


export interface EnrichCompanyResult {
  companyId: string
  name: string
  /** 웹에서 이 회사를 특정했는가. false 면 값은 하나도 만들지 않았다 */
  matched: boolean
  /** 왜 그렇게 판단했는지 — 화면이 그대로 보여 준다. 특정 실패면 그 이유다 */
  matchReason: string | null
  /** 인박스로 간 제안 수 */
  suggested: number
  /** 바로 채워진 수 */
  applied: number
  /** 채울 빈 칸이 애초에 없었다 — AI 를 부르지 않았다는 뜻이다 */
  skipped: boolean
  sources: AiSource[]
  runId: string | null
}

/** 현재 비어 있어서 채울 여지가 있는 필드 */
function blankFields(c: CompanyRow): string[] {
  return ENRICHABLE_FIELDS.filter((f) => {
    const v = (c as unknown as Record<string, unknown>)[f]
    return v === null || v === undefined || v === ''
  })
}

/**
 * 회사 한 곳을 웹에서 찾아 빈 칸을 채운다.
 *
 * **빈 칸이 없으면 AI 를 부르지 않는다.** 부르면 돈이 나가는데 결과는 전부 버려진다
 * (`enrichFromText` 가 빈 칸만 통과시키므로). 안 부르는 것이 맞다.
 */
export async function enrichCompanyFromWeb(
  db: CrmDb,
  workspaceId: string,
  actorId: string | null,
  companyId: string,
  adapter: AiAdapter,
): Promise<EnrichCompanyResult> {
  const company = await getCompany(db, companyId)
  const blanks = blankFields(company)

  const base = {
    companyId: company.id,
    name: company.name,
    sources: [] as AiSource[],
    runId: null as string | null,
  }

  if (blanks.length === 0) {
    return {
      ...base,
      matched: false,
      matchReason: '채울 빈 칸이 없어 웹을 찾지 않았습니다.',
      suggested: 0, applied: 0, skipped: true,
    }
  }

  const input = buildCompanyEnrichInput({
    name: company.name,
    domain: company.domain,
    known: { industry: company.industry, region: company.region },
  })

  const run = await runAi({
    db,
    workspaceId,
    kind: 'ENRICH',
    prompt: COMPANY_ENRICH_V1,
    input,
    // 원문을 복제하지 않고 참조만 남긴다 — 지워야 할 때 두 곳을 지우게 되지 않도록
    inputRef: { targetType: 'company', targetId: company.id, blanks },
    parse: parseCompanyEnrich,
    adapter,
  })

  const out = run.output
  const sources = run.sources ?? []

  /**
   * 특정하지 못했으면 **여기서 끝낸다.**
   *
   * 모델이 matched:false 를 주면서도 필드를 채워 보내는 일이 있다(지시를 절반만 지킨다).
   * 그걸 그대로 쓰면 "특정 못 했다면서 값은 넣는" 모순이 데이터로 남는다.
   */
  if (!out.matched) {
    return {
      ...base,
      matched: false,
      matchReason: out.matchReason,
      suggested: 0, applied: 0, skipped: false,
      sources,
      runId: run.runId,
    }
  }

  /**
   * 출처가 하나도 없으면 **검색하지 않고 기억으로 답한 것**이다.
   *
   * 어댑터가 웹 검색을 켰는데도 인용이 안 왔다면 모델이 검색을 건너뛴 것이고,
   * 그 답은 우리가 확인할 방법이 없다. 근거 없는 값은 제안의 자격이 없다(enrich 규칙 ③).
   */
  if (sources.length === 0) {
    return {
      ...base,
      matched: false,
      matchReason: '웹에서 근거를 찾지 못했습니다(출처 없음). 값을 채우지 않았습니다.',
      suggested: 0, applied: 0, skipped: false,
      runId: run.runId,
    }
  }

  // 도메인이 이미 있었으면 그것을 기준으로 찾은 것이다 — 동명이인 문제가 없다
  const confidence = enrichConfidence(Boolean(company.domain))

  const proposed: Record<string, unknown> = {}
  for (const f of ENRICHABLE_FIELDS) proposed[f] = out[f]

  const { suggested, applied } = await enrichFromText(
    workspaceId, actorId, run.runId,
    // 인용할 원문이 없으니 **판단 근거 문장**을 인용 자리에 넣는다.
    // 화면은 이 문장을 보고 "왜 이 회사라고 봤는지"를 사람에게 보여 준다.
    out.matchReason ?? '웹 검색으로 찾은 회사 정보',
    [{
      targetType: 'company',
      targetId: company.id,
      current: company as unknown as Record<string, unknown>,
      proposed,
    }],
    {
      confidence,
      evidence: { kind: 'web_search', sources: sources.slice(0, 8), matchReason: out.matchReason },
    },
  )

  return {
    ...base,
    matched: true,
    matchReason: out.matchReason,
    suggested, applied, skipped: false,
    sources,
    runId: run.runId,
  }
}

export interface EnrichCompaniesResult {
  results: EnrichCompanyResult[]
  /** 한 건이라도 값을 만든 회사 수 */
  enriched: number
  /** 바로 채워진 칸 수 합계 */
  applied: number
  /** 인박스로 간 제안 수 합계 */
  suggested: number
  /** 아예 실패한 건 — 조용히 삼키지 않는다 */
  failed: { companyId: string; message: string }[]
  /**
   * 중단돼서 **시작조차 못 한** 회사들.
   *
   * 왜 필요한가(v0.7.574): 예전에는 `break` 로 멈추면 남은 회사가 `results` 에도 `failed` 에도
   * 없었다. 20곳을 골랐는데 3번째에서 멈추면 요약은 **17곳에 대해 아무 말도 하지 않았다** —
   * 사용자는 "성공 2건"만 보고 나머지가 됐는지 안 됐는지 알 방법이 없었다.
   * 하지 않은 일은 **하지 않았다고 말해야** 한다.
   */
  notStarted: { companyId: string; reason: string }[]
  /**
   * 중단 사유(있으면). 화면이 회사별로 같은 문장을 N번 반복하지 않고
   * **한 번만 말하기 위해** 쓴다.
   */
  stoppedReason: string | null
}

/**
 * 여러 회사를 차례로 보강한다.
 *
 * **하나가 실패해도 나머지를 계속한다.** 20건을 골랐는데 3번째 회사에서
 * 모델이 헛소리를 했다고 나머지 17건이 통째로 없던 일이 되면, 사용자는
 * 무엇이 됐고 무엇이 안 됐는지 모른 채 처음부터 다시 눌러야 한다.
 *
 * **순차로 돈다.** 병렬로 던지면 예산 선점(reserveBudget)이 동시에 통과해
 * 상한을 넘긴 뒤에야 정산에서 드러나고, 프로바이더 쪽 분당 한도에도 걸린다.
 */
export async function enrichCompaniesFromWeb(
  db: CrmDb,
  workspaceId: string,
  actorId: string | null,
  companyIds: string[],
  adapter: AiAdapter,
): Promise<EnrichCompaniesResult> {
  if (companyIds.length === 0) {
    throw new CrmError('VALIDATION_FAILED', '보강할 회사를 골라 주세요.')
  }
  if (companyIds.length > ENRICH_BULK_MAX) {
    throw new CrmError('VALIDATION_FAILED',
      `한 번에 ${ENRICH_BULK_MAX}곳까지예요. 나눠서 눌러 주세요.`)
  }

  const results: EnrichCompanyResult[] = []
  const failed: { companyId: string; message: string }[] = []
  const notStarted: { companyId: string; reason: string }[] = []
  let stoppedReason: string | null = null

  for (let i = 0; i < companyIds.length; i += 1) {
    const id = companyIds[i]
    try {
      results.push(await enrichCompanyFromWeb(db, workspaceId, actorId, id, adapter))
    } catch (e) {
      const message = e instanceof CrmError ? e.message : '보강에 실패했습니다.'
      failed.push({ companyId: id, message })

      /**
       * **더 해 봐야 소용없는 실패면 거기서 멈춘다.**
       *
       * 남은 회사도 전부 같은 이유로 실패할 것이 확실한데 계속 돌면
       * ① 사용자는 같은 실패 문구를 17번 받고
       * ② 회사당 재시도까지 곱해져 **확정된 실패 호출이 수십 번** 나간다(실측: 최대 40회).
       *
       * 판정은 `stopsBatch`(errors.ts SSOT)에 맡긴다 — 여기에 코드 이름을 직접 적었더니
       * 새 중단 사유(PROVIDER_QUOTA)가 생겼을 때 **이 줄만 모르고 계속 돌았다.**
       *
       * 그리고 **남은 회사를 명시한다.** 멈추는 것과 조용히 사라지는 것은 다르다.
       */
      if (stopsBatch(e)) {
        stoppedReason = message
        for (const rest of companyIds.slice(i + 1)) {
          notStarted.push({ companyId: rest, reason: message })
        }
        break
      }
    }
  }

  return {
    results,
    enriched: results.filter((r) => r.suggested + r.applied > 0).length,
    applied: results.reduce((a, r) => a + r.applied, 0),
    suggested: results.reduce((a, r) => a + r.suggested, 0),
    failed,
    notStarted,
    stoppedReason,
  }
}
