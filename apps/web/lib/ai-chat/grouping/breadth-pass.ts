// ⑤ 넓이 패스 — "이 문서 유형이라면 있어야 하는데 원문에 없는 그룹" 후보를 제안한다.
// 항목(1줄) 단위였던 미병합 브랜치의 breadth-pass.ts를 그룹 단위로 전환.
// 심화(⑥)는 이미 있는 그룹만 파므로 "통째로 빠뜨린 그룹"은 못 잡는다 — 이 패스가 그 구멍을 메운다.
//
// 순수: 프롬프트 빌드 + 파싱만. AI 호출·세션 반영은 호출측(서버액션)이 한다.
// 계약(FR-9): 자동 반영 절대 금지 — 여기서 나오는 건 "후보"일 뿐, 그룹으로 확정하는 것은 사용자 몫이다.

import type { DocType } from './classify-doc.ts'
import { DOC_TYPE_LABEL, DEFAULT_CUT_HINT } from './classify-doc.ts'

const DEFAULT_MAX_SOURCE_CHARS = 12_000

/**
 * 원문 + 문서 유형 + 기존 그룹 제목들 → "빠진 그룹 후보" 제안 프롬프트(JSON 배열만).
 * 원문 전체가 아니라 상한을 둔다 — 넓이 판단은 구조 감각이지 세부 내용 판단이 아니다.
 */
export function buildBreadthPrompt(
  sourceText: string,
  docType: DocType,
  existingGroupTitles: readonly string[],
  maxSourceChars: number = DEFAULT_MAX_SOURCE_CHARS,
): string {
  const existing = existingGroupTitles.map((t, i) => `${i + 1}. ${t}`).join('\n')
  const head = sourceText.length > maxSourceChars ? sourceText.slice(0, maxSourceChars) : sourceText
  return (
    `"${DOC_TYPE_LABEL[docType]}" 문서를 만들 때, 아래 원문과 기존 그룹이 다뤘어야 하는데 빠뜨린` +
    ' "그룹"(제목만)이 있는지 찾아라.\n' +
    `- 이 유형의 기본 절단 단위: ${DEFAULT_CUT_HINT[docType]}\n` +
    '- 기존 그룹과 중복되지 않는 "새로운" 그룹 제목만 제안한다.\n' +
    '- 원문에 근거가 있거나 이 문서 유형에서 통상 필요한 그룹만 제안한다(억지 추가 금지).\n' +
    '- 없으면 빈 배열 []. 출력은 JSON 문자열 배열만(설명·코드펜스 금지).\n\n' +
    `기존 그룹 제목:\n${existing || '(없음)'}\n\n` +
    `원문:\n"""\n${head}\n"""`
  )
}

/** AI 응답 → 제안 문자열 배열(코드펜스 방어). 실패 시 빈 배열 — 넓이패스는 보조 기능이라 폴백 안전. */
export function parseBreadthProposals(raw: string): string[] {
  const stripped = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '')
  try {
    const parsed: unknown = JSON.parse(stripped)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((v): v is string => typeof v === 'string').map((s) => s.trim()).filter(Boolean)
  } catch {
    return []
  }
}

export interface BreadthCandidate {
  title: string
  /** 사용자 확정 전 상태 — 이 모듈은 항상 'proposed'만 만든다. 확정은 호출측(서버액션+UI) 몫. */
  status: 'proposed'
}

/** 제안 문자열 배열 → 후보 객체 배열(빈 문자열·중복 제거). */
export function toBreadthCandidates(proposals: readonly string[]): BreadthCandidate[] {
  const seen = new Set<string>()
  const out: BreadthCandidate[] = []
  for (const p of proposals) {
    const t = p.trim()
    if (!t || seen.has(t)) continue
    seen.add(t)
    out.push({ title: t, status: 'proposed' })
  }
  return out
}
