// ⑥ 그룹별 재가공 — 프롬프트 빌더 + 응답 파서 (순수 함수. AI 호출은 호출측).
//
// 핵심 계약 변경(Phase 4): 입력은 "항목 1줄"이 아니라 "그룹"이다 — 제목 + 원문 슬라이스 전체 +
// 문서 내 위치(treePath/depth) + 문서 유형 + 문서 전체 맥락(아웃라인) + 사용자 지시.
// 이 4가지가 전부 프롬프트에 들어가야 "심화"가 성립한다(맥락 없는 1줄 분석의 근본 한계 해소).
//
// 유실 0 폴백: parseRefineResult가 JSON을 못 읽어도 AI가 낸 텍스트 자체는 절대 버리지 않는다
// (raw를 그대로 markdown으로 보존). AI 호출 자체가 실패해 raw조차 없을 때는 호출측이
// group.bodyRaw를 최종 폴백으로 써야 한다(이 모듈은 그 판단을 하지 않는다 — 순수 함수 경계 유지).

import type { DocType } from './classify-doc.ts'
import { DOC_TYPE_LABEL, DEFAULT_CUT_HINT } from './classify-doc.ts'
import type { TemplateSpec } from '../templates/catalog.ts'

/** 그룹 재가공 입력 — Group(types.ts)에서 재가공에 필요한 필드만 취한 계약. */
export interface GroupRefineInput {
  title: string
  /** 원문 슬라이스 그대로. 재작성 대상이 아니라 심화의 근거 원문. */
  bodyRaw: string
  treePath: string
  depth: number
}

export interface RefineGroupResult {
  /** 심화 본문(마크다운, 소제목 없이 내용만). */
  markdown: string
  evidence: string[]
  assumptions: string[]
  openQuestions: string[]
  /** false = AI 응답이 JSON이 아니었다 — markdown엔 raw 텍스트를 그대로 보존(유실 0 폴백). */
  parseOk: boolean
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function toStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.filter((x): x is string => typeof x === 'string').map((s) => s.trim()).filter(Boolean)
}

/** 템플릿이 있으면 "이런 관점으로 채워라" 가이드 문장을 만든다(강제 스키마 아님 — markdown 서술 가이드). */
function templateGuideLines(template?: Pick<TemplateSpec, 'name' | 'fields'>): string {
  if (!template) return ''
  const fieldLines = template.fields
    .map((f) => `  - ${f.label}${f.required ? '(필수)' : ''}: ${f.description}`)
    .join('\n')
  return `\n이 그룹은 "${template.name}" 관점으로 심화한다. 아래 항목을 본문(markdown)에 자연스럽게 포함하라:\n${fieldLines}\n`
}

export interface BuildRefinePromptParams {
  group: GroupRefineInput
  docType: DocType
  /** 문서 전체 아웃라인 요약(cut-groups.ts의 serializeOutline 재사용). 이 그룹을 문서 전체 맥락 안에 놓는다. */
  docContext: string
  /** 사용자 자유 지시 — 있으면 이것이 지배, 없으면 문서 유형 기본 동작(심화). */
  command: string
  template?: Pick<TemplateSpec, 'name' | 'fields'>
}

export function buildRefinePrompt(p: BuildRefinePromptParams): string {
  const cmd = p.command.trim()
  const defaultAction = `기본 동작: 이 문서 유형(${DOC_TYPE_LABEL[p.docType]})의 관점에서, "${DEFAULT_CUT_HINT[p.docType]}" 단위로 복원한다.`
  return (
    // ── 핵심 프레임: 원문은 "압축본"이다. 심화 = 압축 복원 ──
    // 사용자 통찰: 원문 각 줄("- 사용자 확보 10만 명")은 작성자가 머릿속 큰 그림을 한 줄로 압축한 것.
    // 그러니 심화는 "더 길게 쓰기"(재표현)도, 없는 걸 지어내기(환각)도 아니라 그 압축을 풀어
    // 작성자가 원래 의도했을 완전한 형태로 복원하는 것이다.
    '아래는 한 문서의 일부인 "그룹" 1건이다.\n' +
    '이 그룹의 원문은 작성자가 더 큰 내용을 짧게 "압축"해 적은 것이다(예: "사용자 확보 10만 명" 한 줄에는 획득 채널·시점·측정 기준 등이 생략돼 있다).\n' +
    '네 일은 그 압축을 풀어(decompress), 작성자가 원래 머릿속에 갖고 있었을 완전한 내용으로 복원하되 — **실무에서 바로 쓸 수 있는 깊이까지 구체화**하는 것이다.\n\n' +
    (cmd ? `사용자 지시(최우선): ${cmd}\n` : `${defaultAction}\n`) +
    templateGuideLines(p.template) +
    '\n반드시 지킬 것:\n' +
    '- **포괄적·원론적 서술 절대 금지.** "~를 검토해야 한다 / ~가 중요하다 / ~를 고려한다" 같은 하나마나 한 일반론은 심화가 아니다. 실패다.\n' +
    '- **한 단계 더 파고들어라.** 각 요소마다 아래를 구체적으로 제시하라:\n' +
    '    · 무엇을 — 실제 선택지·후보·옵션을 나열(예: "PG사 비교"가 아니라 "비교 축: 수수료율, 정산주기(T+N), 지원 결제수단, 연동 난이도, 월 최소보장"까지)\n' +
    '    · 어떻게 — 실행 방법·절차·판단 기준·측정 지표(숫자·단위 포함)\n' +
    '    · 무엇을 기준으로 — 결정 기준, 트레이드오프, 우선순위\n' +
    '- 재표현 금지: 원문을 말만 바꿔 되풀이하지 마라. 생략된 정보를 실제로 펼쳐 정보 밀도를 높여라.\n' +
    '- 복원·구체화의 근거는 이 문서다: 원문이 빈약하면 **문서 전체 맥락**(다른 그룹·문서 유형·목적)을 단서로 삼아 합리적으로 구체화하라.\n' +
    '- 근거 등급을 반드시 구분하라(이게 재표현/환각을 가르는 핵심):\n' +
    '    · evidence   = 원문 또는 문서 다른 곳에 명시된 근거(문구 인용)\n' +
    '    · assumptions = 문서 맥락상 합리적으로 추론한 것(문서에 직접 안 적혔음을 밝힘)\n' +
    '    · openQuestions = 문서 어디에도 단서가 없어 작성자만 답할 수 있는 것\n' +
    '- 문서 어디에도 근거가 없는 사실을 evidence처럼 단정하지 마라 — 그런 건 assumptions나 openQuestions로 내린다.\n' +
    '- 원문에 정말 복원할 재료가 없으면 억지로 부풀리지 말고, 무엇이 비었는지를 openQuestions로 드러내라.\n' +
    '- 원문 슬라이스 자체를 다시 쓰지 않는다(원문은 이미 보존돼 있다).\n' +
    '- 출력은 JSON 객체 하나만. 형식:\n' +
    '  {"markdown":"...", "evidence":["..."], "assumptions":["..."], "openQuestions":["..."]}\n' +
    '- 다른 설명·코드펜스를 추가하지 않는다.\n\n' +
    `문서 전체 구조(복원의 맥락 단서 — 이 그룹이 문서 어디에 있고 앞뒤에 뭐가 있는지):\n"""\n${p.docContext.slice(0, 6000)}\n"""\n\n` +
    `이 그룹의 문서 내 위치: ${p.group.treePath} (깊이 ${p.group.depth})\n` +
    `그룹 제목: ${p.group.title}\n\n` +
    `복원할 그룹 원문(압축본):\n"""\n${p.group.bodyRaw}\n"""`
  )
}

/**
 * "증강(augment)" 프롬프트 — 지시가 없을 때의 새 기본. 원문을 재서술·대체하지 않는다.
 * 원문은 호출측이 결과 앞에 그대로(verbatim) 붙이므로, AI는 **원문 아래에 덧붙일 '분석·보강'만** 생성한다.
 * 이렇게 하면 (1)원문 100% 보존 (2)양이 원문 이하로 안 내려감 (3)ID·수치 보존율 100%가 설계상 보장된다.
 * (기존 "복원 골격"은 원문을 산문으로 재서술해 고밀도 정본에서 양·구체성이 되레 줄던 문제가 있었다.)
 */
export function buildAugmentPrompt(p: BuildRefinePromptParams, density: 'dense' | 'sparse' = 'sparse'): string {
  const cmd = p.command.trim()
  // 입력 밀도에 따라 보강의 방향을 바꾼다(P2 모드 자동분기):
  //  dense  = 이미 상세한 정본 → 없는 걸 지어내 부풀리지 말고 검증·갭·리스크·상충·미결 중심.
  //  sparse = 압축된 목록 → 생략된 실행 상세를 적극적으로 펼친다.
  const densityLine =
    density === 'dense'
      ? '이 원문은 이미 상세하다. **새 정보를 지어내 부풀리지 말고**, 검증 포인트·빠진 조건(갭)·리스크·상충점·확인이 필요한 미결 질문 중심으로 보강하라.\n'
      : '이 원문은 압축돼 있다. 생략된 실행 상세(선택지·절차·판단 기준·수치)를 적극적으로 펼쳐 정보 밀도를 높여라.\n'
  return (
    '아래 "그룹 원문"은 사용자에게 그대로 보존되어 보여진다. 너는 원문을 다시 쓰지 않는다.\n' +
    '네 일은 원문 바로 아래에 붙일 **"분석·보강"** 블록만 작성하는 것이다 — 원문 각 요소를 실무에서 바로 쓸 깊이로 구체화한다.\n' +
    densityLine +
    '\n' +
    (cmd ? `참고 지시: ${cmd}\n` : '') +
    templateGuideLines(p.template) +
    '\n반드시 지킬 것:\n' +
    '- 원문을 다시 출력하지 마라(원문은 이미 위에 그대로 있다). 오직 "덧붙일 보강"만 낸다.\n' +
    '- 원문에 이미 있는 문장을 말만 바꿔 반복하지 마라. 원문이 생략한 것을 실제로 더한다:\n' +
    '    · 실제 선택지·후보·비교 축(예: "PG 비교" → "수수료율·정산주기(T+N)·지원수단·연동난이도")\n' +
    '    · 실행 절차·판단 기준·측정 지표(숫자·단위 포함)\n' +
    '    · 원문 수치·ID를 인용해 그 근거·트레이드오프·리스크를 전개(원문 ID/수치는 지우지 말고 참조)\n' +
    '- 포괄적·원론적 서술("~를 검토해야 한다"류) 금지. 근거 없는 사실을 지어내지 마라(불확실하면 밝힌다).\n' +
    '- 출력은 순수 markdown 보강 본문만. 제목은 붙이지 마라(호출측이 "분석·보강" 헤더를 붙인다).\n\n' +
    `문서 전체 구조(맥락 단서):\n"""\n${p.docContext.slice(0, 6000)}\n"""\n\n` +
    `이 그룹의 문서 내 위치: ${p.group.treePath} (깊이 ${p.group.depth})\n` +
    `그룹 제목: ${p.group.title}\n\n` +
    `그룹 원문(보존됨 — 재출력 금지):\n"""\n${p.group.bodyRaw}\n"""`
  )
}

/**
 * command 주도 "자유 서술" 프롬프트 — 사용자 지시가 있을 때 사용한다.
 * 근거/가정/미결질문 고정 래퍼도, JSON 스키마 강제도 없다. 지시가 출력 형식·구성을 지배한다.
 * (문서 맥락·위치·원문은 여전히 주입 — 고립되지 않은 심화를 위해.) 압축복원 원칙(재표현·환각 금지)은 유지.
 */
export function buildFreeRefinePrompt(p: BuildRefinePromptParams): string {
  const cmd = p.command.trim()
  return (
    '아래는 한 문서의 일부인 "그룹" 1건이다.\n' +
    '이 그룹의 원문은 작성자가 더 큰 내용을 짧게 "압축"해 적은 것이다(예: "사용자 확보 10만 명" 한 줄에 채널·시점·측정 기준이 생략됨).\n' +
    '네 일은 그 압축을 풀어 실무에서 바로 쓸 수 있는 깊이까지 구체화하되 — 아래 사용자 지시가 요구하는 형식·구성 그대로 내는 것이다.\n\n' +
    `사용자 지시(최우선 — 이 지시가 출력 형식·구성·말투를 지배한다): ${cmd}\n` +
    templateGuideLines(p.template) +
    '\n반드시 지킬 것:\n' +
    '- 사용자 지시가 요구하는 형식·구성 그대로 markdown으로 출력하라. 지시가 요구하지 않은 "근거 / 가정 / 미결 질문" 같은 고정 섹션을 임의로 붙이지 마라.\n' +
    '- 포괄적·원론적 서술 금지("~를 검토해야 한다 / ~가 중요하다"류 일반론은 심화가 아니다). 실제 선택지·절차·판단 기준·측정 지표(숫자·단위)까지 구체화하라.\n' +
    '- 재표현·환각 금지: 원문을 말만 바꿔 되풀이하지 말고, 생략된 정보를 실제로 펼쳐라. 문서에 근거가 없는 사실을 단정하지 마라(불확실하면 그렇다고 밝혀라).\n' +
    '- 원문 슬라이스 자체를 그대로 다시 쓰지 않는다(원문은 이미 보존돼 있다).\n' +
    '- 출력은 순수 markdown 본문만. JSON·코드펜스·메타설명을 붙이지 않는다.\n\n' +
    `문서 전체 구조(복원의 맥락 단서):\n"""\n${p.docContext.slice(0, 6000)}\n"""\n\n` +
    `이 그룹의 문서 내 위치: ${p.group.treePath} (깊이 ${p.group.depth})\n` +
    `그룹 제목: ${p.group.title}\n\n` +
    `대상 그룹 원문(압축본):\n"""\n${p.group.bodyRaw}\n"""`
  )
}

/**
 * 증강 모드 렌더 — 원문(verbatim) + 구분선 + "분석·보강"(AI). AI 보강이 비면 원문만(무손실).
 * 원문을 코드가 직접 붙이므로 AI가 원문을 지우거나 축약할 수 없다(보존 100% 보장).
 */
export function renderAugmentMarkdown(bodyRaw: string, augmentationRaw: string): string {
  const aug = augmentationRaw.trim().replace(/^```(?:\w+)?\s*/i, '').replace(/```\s*$/i, '').trim()
  const original = bodyRaw.trim()
  if (!aug) return original
  return `${original}\n\n---\n\n**🔎 분석·보강**\n\n${aug}`
}

/**
 * 자유 서술 모드 유실0 — AI 응답을 그대로 본문으로 쓴다(코드펜스만 벗김). 빈 응답이면 그룹 원문으로 폴백.
 * JSON 파싱을 하지 않는다(자유 markdown이 곧 결과).
 */
export function freeRefineOrFallback(raw: string, group: GroupRefineInput): string {
  const stripped = raw.trim().replace(/^```(?:\w+)?\s*/i, '').replace(/```\s*$/i, '').trim()
  return stripped || group.bodyRaw
}

/**
 * AI 응답 파싱. JSON이 아니면 raw를 그대로 markdown으로 보존한다(유실 0).
 * raw 자체가 빈 문자열이면 markdown도 빈 문자열 — 호출측이 group.bodyRaw로 최종 폴백해야 한다.
 */
export function parseRefineResult(raw: string): RefineGroupResult {
  const trimmed = raw.trim()
  const stripped = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '')
  let parsed: unknown
  try {
    parsed = JSON.parse(stripped)
  } catch {
    return { markdown: trimmed, evidence: [], assumptions: [], openQuestions: [], parseOk: false }
  }
  if (!isPlainObject(parsed) || typeof parsed.markdown !== 'string' || !parsed.markdown.trim()) {
    return { markdown: trimmed, evidence: [], assumptions: [], openQuestions: [], parseOk: false }
  }
  return {
    markdown: parsed.markdown.trim(),
    evidence: toStringArray(parsed.evidence),
    assumptions: toStringArray(parsed.assumptions),
    openQuestions: toStringArray(parsed.openQuestions),
    parseOk: true,
  }
}

/**
 * 최종 유실 0 보증 — AI 호출이 아예 실패했거나(raw='') 파싱 결과 markdown이 비었으면
 * 그룹 원문(bodyRaw)을 그대로 결과로 쓴다. 호출측(runner-worker)이 항상 이 함수를 거쳐야 한다.
 */
export function refineResultOrFallback(raw: string, group: GroupRefineInput): RefineGroupResult {
  const parsed = parseRefineResult(raw)
  if (parsed.markdown.trim()) return parsed
  return {
    markdown: group.bodyRaw,
    evidence: [],
    assumptions: [],
    openQuestions: [],
    parseOk: false,
  }
}

/** 그룹 1건 재가공 결과를 저장·조립용 단일 텍스트 블록으로 렌더(근거/가정/미결질문 섹션 포함). */
export function renderRefineMarkdown(result: RefineGroupResult): string {
  const parts = [result.markdown.trim()]
  if (result.evidence.length > 0) {
    parts.push('**근거**\n' + result.evidence.map((e) => `- ${e}`).join('\n'))
  }
  if (result.assumptions.length > 0) {
    parts.push('**가정**\n' + result.assumptions.map((a) => `- ${a}`).join('\n'))
  }
  if (result.openQuestions.length > 0) {
    parts.push('**미결 질문**\n' + result.openQuestions.map((q) => `- ${q}`).join('\n'))
  }
  return parts.join('\n\n')
}
