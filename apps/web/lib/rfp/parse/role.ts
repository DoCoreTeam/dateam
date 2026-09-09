/**
 * 파일 이름으로 역할 추정 (설계서 3.2.2)
 *
 * ## 왜 이름으로 추정하나
 *
 * 나라장터 첨부는 「(붙임1)과업내용서.hwp」처럼 **이름에 역할이 적혀 있다.**
 * 내용을 읽어 분류하려면 먼저 파싱해야 하고, 파싱은 비싸고 실패할 수 있다.
 * 이름으로 먼저 찍고, 파싱 뒤에 내용으로 고치는 편이 싸고 안전하다.
 *
 * ## 추정은 추정이다
 *
 * 결과에 `confidence` 를 함께 돌려준다. 낮으면 화면이 사람에게 확인을 받는다 —
 * 「과업내용서」로 잘못 찍힌 서식 파일이 요구사항 총괄표에 섞이면
 * 그 뒤 모든 판정이 조용히 틀린다.
 */

import type { FileRole } from '../terms.ts'

export interface RoleGuess {
  role: FileRole
  /** 0~1. 사람 확인이 필요한지를 이 값으로 가른다 */
  confidence: number
  /** 무엇을 보고 찍었나 — 화면이 그대로 보여 준다 */
  matched: string | null
}

/** 이 아래면 사람에게 확인을 받는다 */
export const ROLE_CONFIRM_BELOW = 0.7

interface Rule {
  role: FileRole
  /** 이름에 이 말이 있으면 그 역할로 본다 */
  keywords: readonly string[]
  confidence: number
}

/**
 * 위에서부터 먼저 맞는 것이 이긴다.
 *
 * 순서가 규칙이다 — 「제안요청서(정정)」은 정정공고이지 본문이 아니다.
 * 좁은 규칙을 먼저 두지 않으면 넓은 규칙이 다 먹는다.
 */
const RULES: readonly Rule[] = [
  { role: 'amendment', keywords: ['정정공고', '변경공고', '재공고', '정정'], confidence: 0.9 },
  { role: 'qna', keywords: ['질의응답', '질의회신', '질의답변', 'q&a', '질의'], confidence: 0.9 },
  { role: 'special_terms', keywords: ['특수조건', '계약특수', '일반조건', '계약조건'], confidence: 0.9 },
  { role: 'proposal_guide', keywords: ['제안서작성', '작성안내', '제안안내', '작성요령', '평가기준', '제안요령'], confidence: 0.85 },
  { role: 'forms', keywords: ['서식', '양식', '별지', '첨부서식', '제출서류'], confidence: 0.85 },
  { role: 'scope', keywords: ['과업내용', '과업지시', '과업설명', '사업수행계획', '요구사항정의'], confidence: 0.9 },
  { role: 'notice', keywords: ['입찰공고', '공고문', '입찰안내', '사전규격', '규격공고'], confidence: 0.85 },
  { role: 'main', keywords: ['제안요청서', 'rfp', '제안요청'], confidence: 0.9 },
]

/**
 * 이름을 비교하기 좋게 편다.
 *
 * 실제 첨부 이름은 「(붙임 1) 과업 내용서_최종.hwp」처럼 **공백·괄호·번호가 뒤섞인다.**
 * 그대로 비교하면 「과업내용」이 「과업 내용」을 못 잡는다.
 */
export function normalizeFileName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\.[a-z0-9]{1,5}$/i, '')      // 확장자
    .replace(/[\s_\-.()[\]{}<>~·,]/g, '')  // 구분자와 괄호
    .replace(/[0-9]/g, '')                 // 붙임 번호
}

/**
 * 이름으로 역할을 찍는다. 아무 규칙도 안 맞으면 기타다.
 *
 * 기타의 신뢰도를 0.3 으로 두는 이유: 「모르겠다」를 0 으로 두면
 * 화면이 그것을 «분류 실패»로 그리는데, 실제로는 **분류가 안 되는 파일이 정상**이다.
 */
export function guessFileRole(fileName: string): RoleGuess {
  const n = normalizeFileName(fileName)
  if (!n) return { role: 'etc', confidence: 0.3, matched: null }

  for (const rule of RULES) {
    for (const kw of rule.keywords) {
      if (n.includes(normalizeFileName(kw))) {
        return { role: rule.role, confidence: rule.confidence, matched: kw }
      }
    }
  }
  return { role: 'etc', confidence: 0.3, matched: null }
}

export function needsRoleConfirm(guess: RoleGuess): boolean {
  return guess.confidence < ROLE_CONFIRM_BELOW
}

/**
 * 케이스 안에서 본문이 하나로 정해지는지 본다.
 *
 * 본문 후보가 없으면 리포트가 무엇을 근거로 쓸지 모르고,
 * 둘 이상이면 어느 쪽을 믿을지 사람이 정해야 한다.
 */
export function pickMainFile<T extends { fileName: string }>(
  files: readonly T[],
): { main: T | null; ambiguous: T[] } {
  const mains = files.filter((f) => guessFileRole(f.fileName).role === 'main')
  if (mains.length === 1) return { main: mains[0], ambiguous: [] }
  if (mains.length > 1) return { main: null, ambiguous: mains }

  // 본문이 없으면 과업내용서가 사실상 본문 노릇을 한다
  const scopes = files.filter((f) => guessFileRole(f.fileName).role === 'scope')
  if (scopes.length === 1) return { main: scopes[0], ambiguous: [] }
  return { main: null, ambiguous: scopes }
}
