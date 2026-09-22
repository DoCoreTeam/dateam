/**
 * 분석이 못 만든 절의 사유 — 밖에서 온 오류를 사람 말 한 줄로 접는다
 *
 * ## 왜 원문을 그대로 안 쓰나
 *
 * 공급자가 돌려주는 문구에는 우리 조직 id 와 과금 페이지 주소가 들어 있다.
 * 실측 2026-09-22 의 실제 문구다 —
 * `429 Request too large for model 'qwen/...' in organization 'org_01EXAMPLE...'
 *  service tier 'on_demand' ... Upgrade to Dev Tier today at https://console.groq.com/settings/billing`
 * 이걸 화면에 그대로 실으면 내부 구조를 사용자에게 알려 주는 셈이고,
 * 사용자는 정작 «무엇 때문에 이 절이 비었나»는 못 읽는다.
 *
 * 그래서 원문은 잡 기록(`rfp_analysis_jobs.progress`)에만 남기고,
 * 화면으로는 여기서 접은 사유 이름만 나간다.
 *
 * ## 순서가 뜻을 정한다
 *
 * 한 문구에 429 와 «too large» 가 같이 들어 있다. 앞에서 429 로 잡아 버리면
 * 「몰려서 막혔다」가 되고, 사람은 잠시 뒤 다시 걸면 될 줄 안다 — 실제로는
 * 문서가 커서 몇 번을 다시 걸어도 같은 자리에서 죽는다.
 * 좁은 뜻부터 본다.
 */

import { EXTRACT_TASKS } from '../report/tasks.ts'

/** 화면이 아는 사유. 새 사유를 늘릴 때는 terms 의 문구도 같이 늘린다 */
export type FailureReason =
  | 'no_credit'
  | 'too_large'
  | 'rate_limit'
  | 'timeout'
  | 'no_model'
  | 'unknown'

export const FAILURE_REASONS: readonly FailureReason[] =
  ['no_credit', 'too_large', 'rate_limit', 'timeout', 'no_model', 'unknown']

/** 잡 기록에 남는 실패 한 줄 */
export interface AnalyzeFailure {
  taskId: string
  error: string
}

/** 화면으로 나가는 실패 한 줄 — 원문은 없다 */
export interface MissingSection {
  taskId: string
  reason: FailureReason
}

export function classifyFailure(error: string): FailureReason {
  const s = String(error ?? '').toLowerCase()
  if (!s) return 'unknown'

  /*
    잔액이 없는 것은 기다린다고 풀리지 않는다 — 가장 먼저 가른다.

    과금 페이지 주소(`.../settings/billing`)로 잡으면 안 된다. 그 주소는
    **양이 넘쳤다는 문구에도 같이 붙어 온다**(«Need more tokens? Upgrade to Dev Tier today at …»).
    실제로 그렇게 짰다가 「크다」를 전부 「잔액 없음」으로 읽었다.
    잔액을 말하는 말만 본다.
  */
  if (/no credits|add credits|out of credit|insufficient[_ ]quota|payment required|\b402\b/.test(s)) {
    return 'no_credit'
  }

  // 「크다」는 다시 걸어도 같은 자리에서 죽는다. 429 안에 섞여 와도 이쪽이다
  if (/too large|enforced limit|context length|maximum context|too many tokens|reduce max_tokens/.test(s)) {
    return 'too_large'
  }

  // 우리 예산 게이트와 공급자 한도를 한 뜻으로 묶는다 — 사람이 할 일이 같다(기다린다)
  if (/budget_denied|per_minute|분당|일일 한도|rate.?limit|too many requests|quota|429/.test(s)) {
    return 'rate_limit'
  }

  if (/timeout|timed out|abort|etimedout/.test(s)) return 'timeout'

  // 위 어느 것도 아닌데 모델을 못 골랐다면 고를 것 자체가 없었다는 뜻이다
  if (/no usable model|no model|모델이 없/.test(s)) return 'no_model'

  return 'unknown'
}

/**
 * 잡 기록의 `progress.failures` 를 화면이 쓸 모양으로 접는다.
 *
 * 모르는 모양이 오면 **빈 배열**이다. 여기서 던지면 리포트 화면 전체가 안 뜨고,
 * 「왜 비었는지 말해 주는 장치」가 화면을 죽이는 장치가 된다.
 */
export function missingSections(progress: unknown): MissingSection[] {
  const raw = (progress as { failures?: unknown } | null)?.failures
  if (!Array.isArray(raw)) return []

  const out: MissingSection[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    const taskId = String((item as AnalyzeFailure | null)?.taskId ?? '').trim()
    if (!taskId || seen.has(taskId)) continue
    seen.add(taskId)
    out.push({ taskId, reason: classifyFailure(String((item as AnalyzeFailure).error ?? '')) })
  }
  return out
}

/**
 * 못 만든 작업의 이름과 그것이 앉을 절 — 둘 다 작업 목록에서 가져온다
 *
 * 화면이 「예산」이라고 손으로 적으면 작업 이름이 바뀔 때 한쪽만 바뀐다.
 * 모르는 id 면 null 이다 — 옛 기록에 지금 없는 작업이 남아 있을 수 있고,
 * 그때 던지면 리포트가 통째로 안 뜬다.
 */
export function taskFace(taskId: string): { title: string; section: string } | null {
  const t = EXTRACT_TASKS.find((x) => x.id === taskId)
  return t ? { title: t.title, section: String(t.target) } : null
}
