// 자유지시 → 출력 템플릿 결정론 매칭(순수·테스트 대상).
// M3: 지시는 (a)템플릿 선택 (b)템플릿 변형 두 역할. resolve는 (a)만 판정한다.
//   "좀더 디테일하게" 같은 순수 변형 지시는 어떤 템플릿 키워드도 없으므로 null → 호출측이
//   직전 템플릿 유지 or generic 폴백을 결정한다(여기서 강제로 generic 매칭하지 않음).

import { TEMPLATE_CATALOG, GENERIC_TEMPLATE, type TemplateSpec } from './catalog.ts'

export type TemplateSource = 'catalog' | 'custom'

export interface ResolvedTemplate {
  template: TemplateSpec
  source: TemplateSource
  /** 매칭 점수(키워드 히트 수). 0이면 결과에 담기지 않는다(null 반환). */
  score: number
}

/** DB 커스텀 템플릿(172 ai_analysis_templates)을 매칭용 TemplateSpec로. keywords는 name에서 파생. */
export interface CustomTemplateInput {
  id: string
  name: string
  description?: string
  fields: TemplateSpec['fields']
  assembly: TemplateSpec['assembly']
}

function normalize(s: string): string {
  return (s || '').toLowerCase()
}

/** command에 keyword가 몇 번 등장하는지(부분일치). 긴 키워드 우선을 위해 등장 자체를 1점으로 합산. */
function scoreKeywords(cmd: string, keywords: readonly string[]): number {
  let score = 0
  for (const kw of keywords) {
    const k = normalize(kw)
    if (k && cmd.includes(k)) score += 1
  }
  return score
}

/**
 * 자유지시에서 템플릿을 고른다. 커스텀(이름 일치)이 카탈로그보다 우선.
 * generic(범용)은 스코어링에서 제외 — 명시 폴백 전용(getGenericTemplate).
 * 반환 null = 어떤 특정 템플릿 키워드도 없음(순수 변형 지시 등) → 호출측이 폴백 결정.
 */
export function resolveTemplate(
  command: string,
  customTemplates: readonly CustomTemplateInput[] = [],
): ResolvedTemplate | null {
  const cmd = normalize(command)
  if (!cmd.trim()) return null

  let best: ResolvedTemplate | null = null

  // 커스텀: 이름이 지시에 포함되면 강한 신호(가중 2).
  for (const c of customTemplates) {
    const name = normalize(c.name)
    if (name && cmd.includes(name)) {
      const score = 2
      if (!best || score > best.score) {
        best = { template: { id: c.id, name: c.name, description: c.description ?? '', keywords: [], fields: c.fields, assembly: c.assembly }, source: 'custom', score }
      }
    }
  }

  // 카탈로그: generic 제외하고 키워드 스코어.
  for (const t of TEMPLATE_CATALOG) {
    if (t.id === GENERIC_TEMPLATE.id) continue
    const score = scoreKeywords(cmd, t.keywords)
    if (score > 0 && (!best || score > best.score)) {
      best = { template: t, source: 'catalog', score }
    }
  }

  return best
}

/** 명시 폴백 — 특정 템플릿 미매칭 & LLM 생성도 안 할 때 쓰는 범용 템플릿. */
export function getGenericTemplate(): TemplateSpec {
  return GENERIC_TEMPLATE
}
