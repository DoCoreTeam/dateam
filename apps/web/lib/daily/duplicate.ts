import type { DailyLog } from '@/types/database'

/**
 * 일일업무 "중복 의심" 후보 탐지 (P1) — 순수 함수 SSOT.
 *
 * 비파괴 원칙: 이 모듈은 절대 데이터를 변형하지 않는다. 유사도 점수만 계산하고
 * 임계 초과 후보 목록을 반환할 뿐, 병합·삭제·수정은 하지 않는다. 정리는 전적으로
 * 사용자가 [병합 요청]을 눌러 relations 1건을 추가할 때만 일어난다.
 *
 * 결정론: 외부 의존 없이 토큰 Jaccard 유사도만 사용한다(임베딩·랜덤 없음).
 */

/** 중복으로 간주하는 유사도 임계값 (0~1). 단일 소스. */
export const DUPLICATE_THRESHOLD = 0.7

/** 후보 1건: 비교 대상 로그 + 유사도 점수(0~1). */
export interface DuplicateCandidate {
  log: DailyLog
  score: number
}

/**
 * 제목 정규화: 소문자화, 문장부호 제거, 공백 단일화.
 * 한글/영문/숫자만 남기고 나머지는 공백으로 치환한다.
 */
export function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    // 한글 음절·자모, 영문, 숫자, 공백만 보존 — 그 외(문장부호 등)는 공백으로
    .replace(/[^0-9a-z가-힣ㄱ-ㆎ\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 정규화 후 공백 토큰 집합으로 분해(빈 토큰 제외). */
function tokenSet(s: string): Set<string> {
  const normalized = normalizeTitle(s)
  if (!normalized) return new Set()
  return new Set(normalized.split(' ').filter(Boolean))
}

/**
 * 두 제목의 유사도(0~1). 정규화 토큰의 Jaccard 계수.
 * 둘 다 빈 문자열이면 0(비교 의미 없음).
 */
export function titleSimilarity(a: string, b: string): number {
  const setA = tokenSet(a)
  const setB = tokenSet(b)
  if (setA.size === 0 || setB.size === 0) return 0

  let intersection = 0
  for (const token of Array.from(setA)) {
    if (setB.has(token)) intersection += 1
  }
  const union = setA.size + setB.size - intersection
  return union === 0 ? 0 : intersection / union
}

/** 로그의 비교 대상 텍스트(content 우선, 없으면 original_input). */
function logText(log: DailyLog): string {
  return (log.content || log.original_input || '').trim()
}

/**
 * target 과 유사도 임계 초과인 pool 항목을 score 내림차순으로 반환한다.
 * 자기 자신·같은 origin_group(이미 한 묶음) 항목은 제외한다.
 */
export function findDuplicateCandidates(
  target: DailyLog,
  pool: DailyLog[],
  threshold: number = DUPLICATE_THRESHOLD,
): DuplicateCandidate[] {
  const targetText = logText(target)
  if (!targetText) return []

  const candidates: DuplicateCandidate[] = []
  for (const other of pool) {
    if (other.id === target.id) continue
    // 같은 입력 묶음에 속한 항목은 "중복"이 아니라 의도적 분해이므로 제외
    if (
      target.origin_group_id != null &&
      other.origin_group_id != null &&
      target.origin_group_id === other.origin_group_id
    ) {
      continue
    }
    const score = titleSimilarity(targetText, logText(other))
    if (score >= threshold) {
      candidates.push({ log: other, score })
    }
  }

  return candidates.sort((a, b) => b.score - a.score)
}
