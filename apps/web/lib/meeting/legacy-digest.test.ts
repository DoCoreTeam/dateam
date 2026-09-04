/**
 * 옛 경로 정리본 폴백 가드.
 *
 * **무엇을 지키나**: 실측 16건 — `meeting_notes.summary` 에만 정리가 든 회의가
 * 정리 패널에서 「아직 정리하지 않았어요」라고 말하던 것. 이 함수가 틀리면
 * ① 있는 정리가 안 보이거나 ② 없는 정리가 보이거나 ③ 같은 글이 두 번 보인다.
 * 셋 다 화면을 열어야만 보이는 결함이라 여기서 잡는다(완료 조건 E-6).
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  legacyDigestVersion, withLegacyFallback, isLegacyDigest, LEGACY_DIGEST_SEQ,
  type LegacyDigestVersion,
} from './legacy-digest.ts'

const AT = '2026-08-31T06:02:00.000Z'

function real(seq: number): LegacyDigestVersion {
  return {
    seq, createdAt: AT, model: 'gemini-x',
    sources: { memoChars: 218, transcriptSegments: 0, partIdxs: [], mode: 'single' },
    digest: { outcome: '', nextStep: '', agenda: [], decisions: [], conflicts: [] },
  }
}

/* ── 실측 16건의 모양 ─────────────────────────────────── */

test('요약만 있는 옛 회의를 정리본 한 판으로 보여 준다', () => {
  const v = legacyDigestVersion({ summary: '예산 3억 품의 완료', decisions: '', updatedAt: AT })
  assert.ok(v, '16건이 이 경로로 살아난다 — null 이면 「아직 정리하지 않았어요」로 되돌아간다')
  assert.equal(v.digest.agenda.length, 1)
  assert.equal(v.digest.agenda[0].facts[0].text, '예산 3억 품의 완료')
  assert.equal(v.digest.agenda[0].facts[0].origin, 'memo')
  assert.equal(v.createdAt, AT)
})

test('결정사항은 줄 단위로 쪼개고 목록 기호를 벗긴다', () => {
  const v = legacyDigestVersion({
    summary: '', decisions: '- 다음 달 착수 보류\n• 보안 검토 먼저\n\n   \n', updatedAt: AT,
  })
  assert.deepEqual(v?.digest.decisions.map((d) => d.text), ['다음 달 착수 보류', '보안 검토 먼저'])
})

test('둘 다 비면 null — 없는 정리를 있다고 하지 않는다', () => {
  assert.equal(legacyDigestVersion({ summary: '', decisions: '', updatedAt: AT }), null)
  assert.equal(legacyDigestVersion({ summary: '   \n ', decisions: null, updatedAt: AT }), null)
  assert.equal(legacyDigestVersion({ summary: null, decisions: undefined, updatedAt: null }), null)
})

/* ── 지어내지 않는다 ──────────────────────────────────── */

test('outcome·nextStep 을 지어내지 않는다', () => {
  const v = legacyDigestVersion({ summary: '예산 3억 품의 완료. 보안 검토가 남았다.', decisions: '', updatedAt: AT })
  assert.equal(v?.digest.outcome, '', '요약 첫 문장을 결론인 척 넣으면 지어낸 것이다')
  assert.equal(v?.digest.nextStep, '')
})

test('모델과 sources 는 null — 모르는 것을 아는 척하지 않는다', () => {
  const v = legacyDigestVersion({ summary: '내용', decisions: '', updatedAt: AT, memoChars: 218 })
  assert.equal(v?.model, null, '옛 경로는 모델을 안 남겼다')
  assert.equal(
    v?.sources, null,
    'sources 에 지금 재료 크기를 넣으면 「내용이 바뀜」 판정이 영원히 «안 바뀜»이 되어 낡은 정리를 최신인 척 보여 준다',
  )
})

/* ── 순번 ─────────────────────────────────────────────── */

test('옛 정리본의 순번은 0 — 진짜 1번과 겹치지 않는다', () => {
  const v = legacyDigestVersion({ summary: '내용', decisions: '', updatedAt: AT })
  assert.equal(v?.seq, LEGACY_DIGEST_SEQ)
  assert.equal(LEGACY_DIGEST_SEQ, 0, '표의 seq 는 1부터다. 1을 주면 같은 번호가 둘이 된다')
  assert.equal(isLegacyDigest(v!), true)
  assert.equal(isLegacyDigest(real(1)), false)
})

/* ── 메우기 규칙 ──────────────────────────────────────── */

test('표에 정리본이 있으면 옛 것을 넣지 않는다 — 같은 글이 두 번 보이면 안 된다', () => {
  const made = withLegacyFallback([real(2), real(1)], () =>
    legacyDigestVersion({ summary: '옛 요약', decisions: '', updatedAt: AT }))
  assert.equal(made.length, 2)
  assert.equal(made.some(isLegacyDigest), false)
})

test('표가 비었을 때만 옛 것으로 메운다', () => {
  const made = withLegacyFallback([], () =>
    legacyDigestVersion({ summary: '옛 요약', decisions: '', updatedAt: AT }))
  assert.equal(made.length, 1)
  assert.equal(isLegacyDigest(made[0]), true)
})

test('표도 비고 옛 것도 없으면 빈 목록 — 진짜 「아직 정리하지 않았어요」', () => {
  const made = withLegacyFallback([], () =>
    legacyDigestVersion({ summary: '', decisions: '', updatedAt: null }))
  assert.deepEqual(made, [])
})
