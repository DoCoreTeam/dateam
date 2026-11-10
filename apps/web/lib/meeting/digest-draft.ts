/**
 * 정리본을 고치던 것을 브라우저에 잠깐 남긴다 — 순수 계산.
 *
 * 사용자 지적(2026-11-10): 고친 것이 저장에 막힌 뒤 새로고침하자 고친 내용이 통째로 사라졌다.
 * 고친 글이 화면 상태에만 있었기 때문이다.
 *
 * 무엇을 고쳤는지(edits)만으로는 못 되살린다 — 자리 번호가 **그때 본 판** 기준이라,
 * 그새 정리가 바뀌면 엉뚱한 줄에 얹힌다. 그래서 본 판(digest·baseSeq)을 같이 남긴다.
 * 저장은 서버가 본 판 기준으로 옮겨 준다(`digest-run.ts` saveEditedDigest).
 */

import { draftKey, parseDraft, serializeDraft, DEFAULT_TTL_MS } from '../forms/draft-core.ts'
import type { DigestResult } from './digest.ts'
import type { DigestEdit } from './digest-edit.ts'

const FORM_ID = 'meeting-digest-edit'

export interface DigestDraft {
  baseSeq: number
  digest: DigestResult
  edits: DigestEdit[]
}

/** 공용 PC 에서 남의 초안이 보이지 않게 사용자 id 로 가른다 */
export function digestDraftKey(userId: string, noteId: string): string {
  return draftKey(userId, FORM_ID, noteId)
}

export function serializeDigestDraft(draft: DigestDraft, now: number): string {
  return serializeDraft(draft, now)
}

/** 만료됐거나 모양이 틀리거나 고친 것이 없으면 null */
export function parseDigestDraft(raw: string | null, now: number): DigestDraft | null {
  const env = parseDraft<DigestDraft>(raw, DEFAULT_TTL_MS, now)
  const v = env?.value
  if (!v || typeof v.baseSeq !== 'number' || !v.digest || !Array.isArray(v.digest.agenda)) return null
  if (!Array.isArray(v.edits) || v.edits.length === 0) return null
  return v
}
