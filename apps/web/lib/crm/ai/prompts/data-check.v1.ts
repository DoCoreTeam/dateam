/**
 * 데이터 점검 — 무엇부터 손봐야 하나 (dacrm, "오류를 줄이는 자리")
 *
 * **왜 규칙만으로는 부족한가**: 빈칸을 세는 것은 코드가 훨씬 잘한다. 실제로 이 기능의
 * 앞단(scanDataIssues)은 전부 결정론이다. 문제는 그 결과가 **12건, 40건, 200건**으로 나온다는 것이다.
 * 목록이 길면 사람은 첫 줄도 안 읽는다 — 지금까지 CRM 의 경고가 죽어 온 방식이 정확히 이것이다.
 *
 * 그래서 AI 에게 시키는 일은 "찾기"가 아니라 **"고르기"** 다.
 *   · 이 중 지금 손봐야 하는 것 셋
 *   · 왜 그것이 먼저인지 — 목록에 적힌 사실로
 *
 * 막아야 하는 것도 그래서 둘이다.
 *   ① **다 중요하다고 말하기** — 우선순위가 없으면 목록을 그냥 다시 보여 준 것이다
 *   ② **없는 문제 지어내기** — 아래 목록에 없는 건은 존재하지 않는다
 */

export const DATA_CHECK_VERSION = 'data_check@v1.0.0'

/** 규칙이 찾아낸 것 하나 */
export interface DataIssue {
  /** 안정적인 식별자 — 모델이 이걸로 고른다 */
  key: string
  kind: string
  /** 어느 레코드인가 */
  label: string
  /** 무엇이 문제인가 (규칙이 만든 사실 문장) */
  detail: string
  /** 열어 볼 주소 */
  href: string
}

export interface DataCheckPick {
  key: string
  /** 왜 이것부터인가 — 목록의 사실로 */
  because: string
  /** 무엇을 하면 되나 */
  todo: string
}

export interface DataCheckOutput {
  /** 한 줄 결론 */
  headline: string
  picks: DataCheckPick[]
}

/** 몇 개까지 고르게 할까 — 넷을 넘으면 그건 다시 목록이다 */
export const MAX_PICKS = 3

export function buildDataCheckInput(issues: DataIssue[]): string {
  return issues
    .map((i) => `- key: ${i.key}\n  대상: ${i.label}\n  문제: ${i.detail}`)
    .join('\n')
}

export const dataCheckPrompt = {
  version: DATA_CHECK_VERSION,
  build: (input: string) => `당신은 영업 담당자의 동료입니다.
아래는 CRM 데이터에서 규칙이 찾아낸 **손봐야 할 것들**입니다.
이 중 **지금 손봐야 하는 것**을 골라 주세요.

# 반드시 지킬 것

1. **목록에 있는 것만 고르세요.** key 는 아래 적힌 것을 그대로 씁니다.
   없는 key 를 쓰면 그 항목은 버려집니다. 새 문제를 지어내지 마세요.

2. **최대 ${MAX_PICKS}개.** 다 중요하다고 말하면 목록을 다시 보여 준 것뿐입니다.
   영업 성과에 지금 영향을 주는 것부터 고르세요.

3. **왜 그것이 먼저인지 말하세요.** 근거는 위 목록에 적힌 사실이어야 합니다.
   좋음: "금액이 없어 이번 달 예상 매출에서 빠집니다"
   나쁨: "데이터 품질이 중요합니다"

4. **오늘 할 수 있는 크기로 말하세요.**
   좋음: "딜 상세에서 금액 넣기"
   나쁨: "데이터 관리 체계를 수립한다"

5. **급한 게 없으면 빈 배열로 두세요.** 억지로 고르면 다음부터 아무도 안 읽습니다.

# 찾아낸 것

${input}

# 출력

JSON 만. 다른 말 금지.

{"headline":"…","picks":[{"key":"…","because":"…","todo":"…"}]}

- headline: 30자 이내 한 문장
- because: 40자 이내
- todo: 30자 이내`,
}

export function parseDataCheck(text: string, knownKeys: string[]): DataCheckOutput {
  const known = new Set(knownKeys)
  const cleaned = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()

  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    throw new Error('AI 응답을 읽지 못했습니다')
  }
  if (!parsed || typeof parsed !== 'object') throw new Error('AI 응답이 비어 있습니다')

  const r = parsed as Record<string, unknown>
  const headline = typeof r.headline === 'string' ? r.headline.trim() : ''
  if (!headline) throw new Error('AI 응답에 결론이 없습니다')

  const raw = Array.isArray(r.picks) ? r.picks : []
  const picks: DataCheckPick[] = []
  const seen = new Set<string>()

  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const p = item as Record<string, unknown>
    const key = typeof p.key === 'string' ? p.key.trim() : ''
    const because = typeof p.because === 'string' ? p.because.trim() : ''
    const todo = typeof p.todo === 'string' ? p.todo.trim() : ''

    // 지어낸 key · 근거 없음 · 할 일 없음은 버린다 — 눌러도 갈 곳이 없다
    if (!known.has(key) || !because || !todo) continue
    if (seen.has(key)) continue

    seen.add(key)
    picks.push({ key, because: because.slice(0, 80), todo: todo.slice(0, 60) })
    if (picks.length >= MAX_PICKS) break
  }

  return { headline: headline.slice(0, 60), picks }
}
