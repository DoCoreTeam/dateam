/**
 * 녹음 원본 자동 삭제 가드
 *
 * 여기 있는 것은 **틀려도 화면에 아무 표시가 안 나는** 계산이다.
 * 날짜 경계 부호가 뒤집히면 방금 녹음한 회의를 지운다 — 그리고 지운 뒤에는
 * 아무도 그 사실을 모른다. 그래서 단정으로 고정한다(완료 조건 E-6).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  DEFAULT_RETENTION_DAYS, PURGE_BATCH, readRetentionDays, purgeCutoffIso,
} from './audio-purge.ts'

const NOW = '2026-08-22T00:00:00.000Z'

// ------------------------------------------------------------
// 보관 기간
// ------------------------------------------------------------

test('설정이 없으면 기본 보관 기간을 쓴다', () => {
  assert.equal(readRetentionDays({}), DEFAULT_RETENTION_DAYS)
})

test('어드민이 정한 일수를 존중한다', () => {
  assert.equal(readRetentionDays({ meeting_audio_retention_days: 7 }), 7)
  assert.equal(readRetentionDays({ meeting_audio_retention_days: '90' }), 90)
})

test('★ 0일·음수는 기본값으로 접는다 — 전사 직후 즉시 삭제면 되돌릴 방법이 사라진다', () => {
  assert.equal(readRetentionDays({ meeting_audio_retention_days: 0 }), DEFAULT_RETENTION_DAYS)
  assert.equal(readRetentionDays({ meeting_audio_retention_days: -5 }), DEFAULT_RETENTION_DAYS)
})

test('말이 안 되는 값(문자열·초대형)도 기본값으로 — 예외로 잡을 죽이지 않는다', () => {
  assert.equal(readRetentionDays({ meeting_audio_retention_days: 'nope' }), DEFAULT_RETENTION_DAYS)
  assert.equal(readRetentionDays({ meeting_audio_retention_days: 99_999 }), DEFAULT_RETENTION_DAYS)
})

// ------------------------------------------------------------
// 경계 시각 — 이 부호가 이 기능의 유일한 위험이다
// ------------------------------------------------------------

test('★ 경계는 과거다 — 지금보다 뒤가 나오면 방금 녹음한 회의를 지운다', () => {
  const cutoff = purgeCutoffIso(NOW, 30)
  assert.ok(Date.parse(cutoff) < Date.parse(NOW), cutoff)
})

test('30일 보관이면 정확히 30일 전이다', () => {
  assert.equal(purgeCutoffIso(NOW, 30), '2026-07-23T00:00:00.000Z')
})

test('보관 기간을 늘리면 경계가 더 과거로 간다 — 지우는 대상이 줄어든다', () => {
  const short = Date.parse(purgeCutoffIso(NOW, 7))
  const long = Date.parse(purgeCutoffIso(NOW, 90))
  assert.ok(long < short)
})

test('읽을 수 없는 시각은 조용히 통과시키지 않는다 — 잘못된 경계로 지우느니 던진다', () => {
  assert.throws(() => purgeCutoffIso('어제', 30))
})

// ------------------------------------------------------------
// 배선 — 만들어 놓고 안 부르면 없는 기능이다
// ------------------------------------------------------------

test('★ 삭제 잡이 크론에 올라 있다 — 라우트만 만들면 아무도 안 부른다', () => {
  const cron = readFileSync(new URL('../../vercel.json', import.meta.url), 'utf-8')
  assert.ok(cron.includes('/api/meeting-notes/jobs/audio-purge'), '크론에 audio-purge 가 없다')
})

test('★ 잡 입구가 machine-auth SSOT 를 쓴다 — 인증을 새로 짜면 한쪽만 잠근다', () => {
  const route = readFileSync(new URL('../../app/api/meeting-notes/jobs/audio-purge/route.ts', import.meta.url), 'utf-8')
  assert.ok(route.includes('isMachineCall'), 'machine-auth 를 쓰지 않는다')
  assert.ok(route.includes('purgeExpiredAudio'), 'SSOT 를 부르지 않는다')
})

test('★ 전사 완료된 것만, 아직 안 지운 것만 고른다 — 조건이 빠지면 미전사 구간이 사라진다', () => {
  const src = readFileSync(new URL('./audio-purge.ts', import.meta.url), 'utf-8')
  assert.ok(src.includes("'TRANSCRIBED'"), '전사 완료 조건이 없다')
  assert.ok(src.includes("is('audio_deleted_at', null)"), '이미 지운 것을 다시 고른다')
  assert.ok(src.includes("lt('created_at'"), '보관 기간 조건이 없다')
})

test('★ drive_file_id 를 지우지 않는다 — 지우면 "녹음이 없었던 것"과 구분이 사라진다', () => {
  const src = readFileSync(new URL('./audio-purge.ts', import.meta.url), 'utf-8')
  assert.ok(!/drive_file_id:\s*null/.test(src), 'drive_file_id 를 null 로 만들고 있다')
})

test('한 번에 지우는 수에 상한이 있다 — 드라이브 API 를 몰아치지 않는다', () => {
  assert.ok(PURGE_BATCH > 0 && PURGE_BATCH <= 100, String(PURGE_BATCH))
})
