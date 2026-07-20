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
  const defaultAction = `이 문서 유형(${DOC_TYPE_LABEL[p.docType]})의 기본 동작: "${DEFAULT_CUT_HINT[p.docType]}" 단위를 근거·시사점·세부사항으로 심화한다.`
  return (
    '아래는 한 문서의 일부인 "그룹" 1건이다. 이 그룹을 상세화(심화)하라.\n\n' +
    (cmd ? `사용자 지시(최우선 — 아래 기본 동작보다 우선한다): ${cmd}\n` : `${defaultAction}\n`) +
    templateGuideLines(p.template) +
    '\n규칙:\n' +
    '- 원문 근거가 있으면 evidence에 원문 문구를 인용한다.\n' +
    '- 원문에 없어 추정한 부분은 assumptions에 명시한다(지어낸 값을 사실처럼 쓰지 않는다).\n' +
    '- 확인이 필요한 미결 사항은 openQuestions에 담는다(없으면 빈 배열).\n' +
    '- 원문 슬라이스 자체를 다시 쓰지 않는다 — 심화·근거·시사점을 더하는 것이지 원문 대체가 아니다.\n' +
    '- 출력은 JSON 객체 하나만. 형식:\n' +
    '  {"markdown":"...", "evidence":["..."], "assumptions":["..."], "openQuestions":["..."]}\n' +
    '- 다른 설명·코드펜스를 추가하지 않는다.\n\n' +
    `문서 전체 구조(맥락 — 이 그룹이 어디에 있는지 참고):\n"""\n${p.docContext.slice(0, 6000)}\n"""\n\n` +
    `이 그룹의 문서 내 위치: ${p.group.treePath} (깊이 ${p.group.depth})\n` +
    `그룹 제목: ${p.group.title}\n\n` +
    `그룹 원문 전체:\n"""\n${p.group.bodyRaw}\n"""`
  )
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
