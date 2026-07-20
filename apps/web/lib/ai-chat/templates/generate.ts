// 자유지시 → LLM 템플릿 스키마 생성(순수: 프롬프트 빌드 + 응답 파싱·검증). AI 호출은 호출측(서버액션).
// 카탈로그 6종에 매칭 안 될 때만 사용(resolve null). USAI 방어 차용: AI 응답은 신뢰경계 밖 —
// 프로토타입 오염 키 거부, 형태 검증 실패 시 null(호출측이 generic 폴백).

import type { FieldSpec, TemplateSpec } from './catalog.ts'

const POLLUTION_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
const MAX_FIELDS = 12

/** 지시에서 출력 템플릿 스키마를 만들라는 프롬프트(JSON만 반환 강제). */
export function buildTemplateGenPrompt(command: string): string {
  return (
    '사용자가 원하는 "출력 문서 양식"을 아래 JSON 스키마로 설계하라.\n' +
    '각 필드는 문서의 각 항목을 상세화할 때 채워야 하는 칸이다(막연한 "상세히"가 아니라 구체적 칸).\n' +
    '- name: 문서 양식 이름(짧게)\n' +
    '- description: 한 줄 설명\n' +
    '- fields: 3~8개. 각 {key(영문 소문자 스네이크), label(한글), description(무엇을 채우는지), required(bool)}\n' +
    '- assembly: {mode: "table"|"sections", itemNoun: 항목을 부르는 한글 명사}\n' +
    '출력은 JSON 객체 하나만. 설명·마크다운·코드펜스 없이 순수 JSON.\n\n' +
    `사용자 지시: "${command}"`
  )
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function sanitizeKey(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const key = raw.trim()
  if (!key || POLLUTION_KEYS.has(key)) return null
  if (!/^[a-z][a-z0-9_]*$/.test(key)) return null
  return key
}

function parseField(v: unknown): FieldSpec | null {
  if (!isPlainObject(v)) return null
  const key = sanitizeKey(v.key)
  const label = typeof v.label === 'string' ? v.label.trim() : ''
  const description = typeof v.description === 'string' ? v.description.trim() : ''
  if (!key || !label) return null
  return { key, label, description: description || label, required: v.required !== false }
}

/**
 * LLM 응답 → 검증된 TemplateSpec(origin='llm'). 실패 시 null(호출측 generic 폴백).
 * id는 호출측(서버액션)이 DB 저장 후 부여 — 여기선 빈 id.
 */
export function parseTemplateSpec(raw: string): Omit<TemplateSpec, 'id' | 'keywords'> | null {
  const stripped = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '')
  let parsed: unknown
  try {
    parsed = JSON.parse(stripped)
  } catch {
    return null
  }
  if (!isPlainObject(parsed)) return null

  const name = typeof parsed.name === 'string' ? parsed.name.trim() : ''
  if (!name) return null

  const rawFields = Array.isArray(parsed.fields) ? parsed.fields : []
  const seen = new Set<string>()
  const fields: FieldSpec[] = []
  for (const rf of rawFields) {
    const field = parseField(rf)
    if (!field || seen.has(field.key)) continue
    seen.add(field.key)
    fields.push(field)
    if (fields.length >= MAX_FIELDS) break
  }
  if (fields.length === 0) return null

  const asm = isPlainObject(parsed.assembly) ? parsed.assembly : {}
  const mode = asm.mode === 'table' ? 'table' : 'sections'
  const itemNoun = typeof asm.itemNoun === 'string' && asm.itemNoun.trim() ? asm.itemNoun.trim() : '항목'

  return {
    name,
    description: typeof parsed.description === 'string' ? parsed.description.trim() : '',
    fields,
    assembly: { mode, itemNoun },
  }
}
