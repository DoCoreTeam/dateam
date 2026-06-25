// 자기평가·자기교정 루프 — 순수 제어로직 SSOT (Reflexion형 Actor–Evaluator).
//  doc 04(자기평가 루프 설계)의 핵심: 추출(Actor)→AI심판(Evaluator)→불합격시 실패필드만 재추출→수렴.
//  여기엔 라이브 AI 호출이 없다 — extract/critic을 "주입"받아 루프만 돌린다(헤드리스 단위검증 가능).
//  실제 Gemini 추출·심판은 호출부가 주입(telemetry/intake-routing core와 동일 분리 패턴).
//
//  설계원칙(doc 04·DC-RES):
//   - 심판은 채점 아닌 검증 — 필드별 PASS/FAIL + 누락목록(holistic 점수 금지, 자기편향 회피).
//   - 수렴 = 전 필드 pass + 누락 0.  무한루프 가드 = maxAttempts + no-progress(실패집합 안 줄면 중단).
//   - 비결정성 회피: 시각·랜덤 미사용(워크플로/테스트 결정성).

/** 필드별 검증 결과 — 채점(score) 아님. reason은 원본 셀 인용 권장(groundedness). */
export interface FieldVerdict {
  field: string
  pass: boolean
  reason?: string
}

/** AI 심판 산출 — 필드별 PASS/FAIL + 누락(원본에 있는데 추출 안 된) 키 목록. */
export interface CritiqueVerdict {
  fields: FieldVerdict[]
  missing: string[]
}

export type LoopOutcome = 'converged' | 'exhausted' | 'no_progress'

export interface LoopResult<T> {
  result: T
  verdict: CritiqueVerdict
  attempts: number
  outcome: LoopOutcome
  /** 사람 에스컬레이션 필요 여부 — converged 아니면 true(후보+사유를 검수로). */
  needsHuman: boolean
}

/** 수렴 판정 — 전 필드 pass + 누락 없음. */
export function isConverged(v: CritiqueVerdict): boolean {
  return v.missing.length === 0 && v.fields.every((f) => f.pass)
}

/** 실패 집합(키) — 실패 필드 + 누락 필드. no-progress 비교 기준. */
export function failingKeys(v: CritiqueVerdict): Set<string> {
  const s = new Set<string>()
  for (const f of v.fields) if (!f.pass) s.add(f.field)
  for (const m of v.missing) s.add(m)
  return s
}

/** no-progress — 이번 실패집합이 이전을 줄이지 못함(부분집합 아님). 줄지 않으면 루프 중단(진동/정체 가드). */
export function noProgress(prev: CritiqueVerdict | null, curr: CritiqueVerdict): boolean {
  if (!prev) return false
  const p = failingKeys(prev)
  const c = failingKeys(curr)
  // 새 실패가 사라지지 않음: c의 모든 원소가 p에 있고(새 실패 없음) 크기가 안 줄면 정체.
  if (c.size === 0) return false
  if (c.size < p.size) return false // 줄었으면 진전
  // 다른 필드가 새로 실패 → 변화 있음(정체 아님). 동일·미축소면 정체.
  //  Array.from: tsconfig target 미명시(ES3) 환경의 Set for...of(TS2802) 회피.
  return Array.from(c).every((k) => p.has(k))
}

/** 실패필드만 겨냥한 피드백 문자열 — 재추출에 주입(전체 재추출 아닌 스코프드 refine). */
export function buildRefineFeedback(v: CritiqueVerdict): string {
  const lines: string[] = []
  const failed = v.fields.filter((f) => !f.pass)
  if (failed.length) {
    lines.push('아래 필드를 원본과 대조해 다시 추출하세요(나머지는 유지):')
    for (const f of failed) lines.push(`- ${f.field}: ${f.reason ?? '원본과 불일치'}`)
  }
  if (v.missing.length) {
    lines.push(`누락된 항목을 추가 추출하세요: ${v.missing.join(', ')}`)
  }
  return lines.join('\n')
}

/**
 * 자기평가 루프 드라이버 — extract(Actor)/critic(Evaluator) 주입. 라이브 AI 의존 없음(단위검증 가능).
 *  수렴 또는 maxAttempts 또는 no-progress까지 반복. 미수렴이면 needsHuman=true(검수 에스컬레이션).
 * @param extract  (feedback?) => 추출결과. feedback은 직전 심판의 실패필드(첫 회는 undefined).
 * @param critic   (result) => 심판(필드별 PASS/FAIL + 누락).
 * @param maxAttempts 기본 3(권장 2~3 — 이득은 빠르게 평탄화).
 */
export async function runSelfEvalLoop<T>(opts: {
  extract: (feedback?: string) => Promise<T>
  critic: (result: T) => Promise<CritiqueVerdict>
  maxAttempts?: number
}): Promise<LoopResult<T>> {
  const maxAttempts = opts.maxAttempts ?? 3
  let feedback: string | undefined
  let prev: CritiqueVerdict | null = null
  let result = await opts.extract(undefined)
  let verdict = await opts.critic(result)
  let attempts = 1

  while (attempts < maxAttempts) {
    if (isConverged(verdict)) {
      return { result, verdict, attempts, outcome: 'converged', needsHuman: false }
    }
    if (noProgress(prev, verdict)) {
      return { result, verdict, attempts, outcome: 'no_progress', needsHuman: true }
    }
    feedback = buildRefineFeedback(verdict)
    prev = verdict
    result = await opts.extract(feedback)
    verdict = await opts.critic(result)
    attempts++
  }

  if (isConverged(verdict)) {
    return { result, verdict, attempts, outcome: 'converged', needsHuman: false }
  }
  return { result, verdict, attempts, outcome: 'exhausted', needsHuman: true }
}
