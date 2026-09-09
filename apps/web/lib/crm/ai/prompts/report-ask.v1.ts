/**
 * 리포트 도우미 프롬프트 — 규칙이 못 푼 것만 모델에게 묻는다.
 *
 * **목록을 함께 준다.** 없는 지표·축을 지어내면 그 답은 버려지는데(라우트가 거른다),
 * 버려진 답도 돈은 든다. 고를 수 있는 것을 처음부터 보여 주는 편이 싸고 정확하다.
 */
import type { AiPrompt } from '../runner.ts'

export const REPORT_ASK_V1: AiPrompt = {
  version: 'report_ask@v1.0.0',
  build: (input: string) => input,
}

/** 모델에게 줄 한 덩어리 — 오늘 · 고를 수 있는 것 · 사람이 한 말 */
export function buildReportAskInput(args: {
  todayKey: string
  metrics: { key: string; label: string }[]
  dimensions: { key: string; label: string }[]
  text: string
}): string {
  return [
    '너는 영업 리포트의 조건을 만드는 도우미다.',
    `오늘은 ${args.todayKey} 다.`,
    '아래 목록에 있는 key 만 쓴다. 목록에 없는 것은 지어내지 말고 null 을 넣는다.',
    '',
    `지표: ${args.metrics.map((m) => `${m.key}(${m.label})`).join(' · ')}`,
    `쪼개는 기준: ${args.dimensions.map((d) => `${d.key}(${d.label})`).join(' · ')}`,
    '',
    'period 형식: YEAR:2026 · HALF:2026:1 · QUARTER:2026:3 · MONTH:2026:9',
    '',
    'JSON 만 출력한다: {"metric":string|null,"rows":string|null,"cols":string|null,"period":string|null}',
    '',
    `사람이 한 말: ${args.text}`,
  ].join('\n')
}

/** 모델의 답을 읽는다 — 모양만 본다. 아는 값인지는 라우트가 다시 거른다 */
export function parseReportAsk(text: string): Record<string, unknown> {
  const m = text.match(/\{[\s\S]*\}/)
  if (!m) throw new Error('JSON 을 찾지 못했습니다.')
  const o = JSON.parse(m[0]) as Record<string, unknown>
  if (typeof o !== 'object' || o === null) throw new Error('객체가 아닙니다.')
  return o
}
