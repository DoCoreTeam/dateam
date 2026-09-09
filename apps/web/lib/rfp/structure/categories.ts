/**
 * 표준 목차 14분류 (설계서 3.4.2)
 *
 * ## 왜 분류가 필요한가
 *
 * 공고마다 목차 이름이 다르다 — 「사업개요」「추진배경 및 필요성」「과업의 개요」가
 * 모두 같은 것을 가리킨다. 분류가 없으면 **공고 두 건을 나란히 못 놓는다.**
 *
 * ## 키워드만 쓰는 이유
 *
 * 이 단계에 AI 를 쓰면 문서마다 분류가 흔들리고, 흔들리는 분류 위에 쌓은
 * 요구사항 총괄표와 비교표는 믿을 수 없다. **애매한 것은 미분류로 남기고**
 * 사람이 고치게 하는 편이 낫다 — 틀린 분류보다 빈 분류가 고치기 쉽다.
 */

import type { IrSection, SectionCategory } from '../ir/types.ts'

interface CategoryRule {
  category: SectionCategory
  keywords: readonly string[]
}

/**
 * 위에서부터 먼저 맞는 것이 이긴다.
 *
 * 순서가 규칙이다 — 「보안 요구사항」은 보안이지 기능이 아니고,
 * 「제안서 평가 기준」은 평가이지 제안 안내가 아니다.
 */
const RULES: readonly CategoryRule[] = [
  { category: 'evaluation', keywords: ['평가기준', '평가방법', '평가항목', '심사기준', '배점', '제안평가'] },
  { category: 'eligibility', keywords: ['입찰참가자격', '참가자격', '자격요건', '응찰자격', '참여자격'] },
  { category: 'security', keywords: ['보안', '정보보호', '개인정보', '보안요구'] },
  { category: 'performance', keywords: ['성능요구', '성능', '품질요구', '가용성', '응답시간'] },
  { category: 'functional', keywords: ['기능요구', '기능정의', '기능명세', '시스템기능'] },
  { category: 'requirement_summary', keywords: ['요구사항총괄', '요구사항목록', '요구사항정의', '요구사항개요', '요구사항'] },
  { category: 'schedule', keywords: ['추진일정', '사업기간', '일정계획', '수행일정', '납기'] },
  { category: 'budget', keywords: ['사업예산', '사업비', '예산', '대가지급', '지급조건', '배정예산'] },
  { category: 'constraints', keywords: ['제약사항', '제약조건', '준수사항', '유의사항'] },
  { category: 'contract_terms', keywords: ['계약조건', '계약특수', '하자보수', '지체상금', '계약일반'] },
  { category: 'bid_guide', keywords: ['입찰안내', '제안서작성', '제출서류', '제안안내', '입찰방법', '낙찰자결정'] },
  { category: 'forms', keywords: ['서식', '별지', '양식'] },
  { category: 'scope', keywords: ['과업범위', '과업내용', '사업범위', '용역범위', '과업'] },
  { category: 'background', keywords: ['추진배경', '사업배경', '필요성', '추진근거'] },
  { category: 'overview', keywords: ['사업개요', '개요', '사업명', '사업목적', '목적'] },
]

/** 제목을 비교하기 좋게 편다 — 「Ⅱ. 과업 내용」의 공백과 기호를 지운다 */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[\s_\-.,()[\]{}<>·]/g, '')
    .replace(/[0-9]/g, '')
}

export interface CategoryGuess {
  category: SectionCategory | null
  matched: string | null
}

/**
 * 제목으로 분류를 찍는다. 아무 규칙도 안 맞으면 **미분류(null)** 다.
 *
 * 기타 같은 «담는 칸» 을 만들지 않는 이유: 미분류는 사람이 볼 자리이고,
 * 기타는 아무도 안 보는 자리가 된다.
 */
export function guessCategory(title: string | null): CategoryGuess {
  if (!title) return { category: null, matched: null }
  const n = normalizeTitle(title)
  if (!n) return { category: null, matched: null }

  for (const rule of RULES) {
    for (const kw of rule.keywords) {
      if (n.includes(normalizeTitle(kw))) return { category: rule.category, matched: kw }
    }
  }
  return { category: null, matched: null }
}

/**
 * 섹션 트리에 분류를 채운다 — 원본을 바꾸지 않는다.
 *
 * 자기 제목으로 못 정하면 **부모 분류를 물려받는다.**
 * 「1. 기능」 아래 「가.」 같은 무의미한 제목이 미분류로 남으면
 * 그 아래 본문이 어디에도 안 걸린다.
 */
export function applyCategories(sections: readonly IrSection[]): IrSection[] {
  const byId = new Map(sections.map((s) => [s.sectionId, s]))
  const resolved = new Map<string, SectionCategory | null>()

  function categoryOf(s: IrSection): SectionCategory | null {
    const cached = resolved.get(s.sectionId)
    if (cached !== undefined) return cached
    const own = guessCategory(s.title).category
    if (own) { resolved.set(s.sectionId, own); return own }
    const parent = s.parentId ? byId.get(s.parentId) : undefined
    const inherited = parent ? categoryOf(parent) : null
    resolved.set(s.sectionId, inherited)
    return inherited
  }

  return sections.map((s) => ({ ...s, category: categoryOf(s) }))
}

/** 분류가 채워진 비율 — 낮으면 화면이 사람에게 확인을 권한다 */
export function categoryCoverage(sections: readonly IrSection[]): number {
  if (sections.length === 0) return 0
  const filled = sections.filter((s) => s.category !== null).length
  return filled / sections.length
}

/** 이 아래면 사람이 목차를 손봐야 한다 */
export const COVERAGE_WARN_BELOW = 0.5
