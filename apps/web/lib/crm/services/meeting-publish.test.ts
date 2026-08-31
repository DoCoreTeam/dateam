/**
 * 회의노트 → CRM 발행의 순수 판정 가드
 *
 * 여기 있는 셋은 **화면으로 밟기 어렵거나, 틀려도 조용한** 것들이다.
 *   · 어긋남 판정 — 틀리면 배지가 영원히 뜨거나 영원히 안 뜬다. 둘 다 사용자는 원인을 모른다
 *   · 전사 원본 고르기 — HTML 이 새면 `<br/>` 가 AI 근거 인용에 글자로 박힌다(실제 사고 이력)
 *   · 요약 합치기 — 이게 비면 목록 배지가 계속 '전사 대기'다(F-1 이 그 상태였다)
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { read, stripComments } from '../../ui/component-scan.ts'
import {
  isNoteNewerThanSnapshot,
  pickTranscriptSource,
  composeSummary,
} from './meeting-publish.ts'

// ------------------------------------------------------------
// 어긋남 판정
// ------------------------------------------------------------

test('원본이 스냅샷보다 새로우면 "다시 가져오기"가 뜬다', () => {
  assert.equal(
    isNoteNewerThanSnapshot('2026-08-22T10:00:00Z', '2026-08-22T09:00:00Z'),
    true,
  )
})

test('★ 발행 직후 같은 시각이면 배지가 뜨지 않는다 — 뜨면 아무도 안 믿는다', () => {
  const t = '2026-08-22T09:00:00Z'
  assert.equal(isNoteNewerThanSnapshot(t, t), false)
})

test('스냅샷이 더 최신이면(시계 역전) 배지를 띄우지 않는다', () => {
  assert.equal(
    isNoteNewerThanSnapshot('2026-08-22T08:00:00Z', '2026-08-22T09:00:00Z'),
    false,
  )
})

test('연결 안 된 미팅(noteSyncedAt 없음)은 배지 대상이 아니다', () => {
  assert.equal(isNoteNewerThanSnapshot('2026-08-22T10:00:00Z', null), false)
  assert.equal(isNoteNewerThanSnapshot(null, '2026-08-22T10:00:00Z'), false)
  assert.equal(isNoteNewerThanSnapshot(undefined, undefined), false)
})

test('읽을 수 없는 시각은 배지를 띄우지 않는다 — 지어내지 않는다', () => {
  assert.equal(isNoteNewerThanSnapshot('아무말', '2026-08-22T09:00:00Z'), false)
  assert.equal(isNoteNewerThanSnapshot('2026-08-22T10:00:00Z', '아무말'), false)
})

test('Date 객체로 줘도 같은 판정이 나온다 — DB 는 Date 로 돌려준다', () => {
  assert.equal(
    isNoteNewerThanSnapshot(new Date('2026-08-22T10:00:00Z'), new Date('2026-08-22T09:00:00Z')),
    true,
  )
})

// ------------------------------------------------------------
// 전사 원본 고르기
// ------------------------------------------------------------

test('전사가 있으면 전사를 쓴다 — 기계가 받아 적은 것이 가장 정확하다', () => {
  const src = pickTranscriptSource({
    transcript: '김대표: 예산은 3억입니다.',
    body_plain: '사람이 쓴 메모',
    body_html: '<p>사람이 쓴 메모</p>',
  })
  assert.equal(src, '김대표: 예산은 3억입니다.')
})

test('전사가 없으면 본문 plain 을 쓴다', () => {
  const src = pickTranscriptSource({
    transcript: null,
    body_plain: '사람이 쓴 메모',
    body_html: '<p>사람이 쓴 메모</p>',
  })
  assert.equal(src, '사람이 쓴 메모')
})

test('★ plain 도 없으면 HTML 을 반드시 plain 으로 바꿔서 쓴다 — <br/>가 글자로 새면 안 된다', () => {
  const src = pickTranscriptSource({
    transcript: null,
    body_plain: null,
    body_html: '<p>첫 줄<br/>둘째 줄</p>',
  })
  assert.ok(!src.includes('<br'), `HTML 태그가 남았다: ${src}`)
  assert.ok(!src.includes('<p>'), `HTML 태그가 남았다: ${src}`)
  assert.ok(src.includes('첫 줄'))
  assert.ok(src.includes('둘째 줄'))
})

test('공백만 있는 전사는 없는 것으로 본다 — 빈 전사로 넘어가면 5축이 헛돈다', () => {
  const src = pickTranscriptSource({
    transcript: '   \n  ',
    body_plain: '진짜 내용',
    body_html: null,
  })
  assert.equal(src, '진짜 내용')
})

test('셋 다 비면 빈 문자열 — 호출부가 전사를 건너뛴다', () => {
  assert.equal(pickTranscriptSource({ transcript: null, body_plain: null, body_html: null }), '')
})

// ------------------------------------------------------------
// 요약 합치기 (F-1 해소의 실체)
// ------------------------------------------------------------

test('요약과 결정사항이 둘 다 있으면 한 덩어리로 합친다', () => {
  const md = composeSummary({ summary: '예산 협의 완료', decisions: '9월 1일 착수' })
  assert.ok(md)
  assert.ok(md.includes('예산 협의 완료'))
  assert.ok(md.includes('## 결정사항'))
  assert.ok(md.includes('9월 1일 착수'))
})

test('요약만 있으면 결정사항 제목을 붙이지 않는다 — 빈 절은 만들지 않는다', () => {
  const md = composeSummary({ summary: '예산 협의 완료', decisions: null })
  assert.equal(md, '예산 협의 완료')
})

test('결정사항만 있어도 값이 나온다', () => {
  const md = composeSummary({ summary: null, decisions: '9월 1일 착수' })
  assert.ok(md)
  assert.ok(md.includes('## 결정사항'))
})

test('★ 둘 다 없으면 null — 빈 문자열을 넣으면 목록 배지가 "정리됨"으로 거짓말한다', () => {
  assert.equal(composeSummary({ summary: null, decisions: null }), null)
  assert.equal(composeSummary({ summary: '  ', decisions: '\n' }), null)
})


/**
 * 스냅샷 시각은 **DB 시계로만** 찍는다.
 *
 * 실측(v0.7.595): `createMeetingWithNote` 만 앱 서버 시계(`new Date()`)를 썼다.
 * 로컬 맥과 Supabase 의 시계가 2초 어긋나 있었고, 그 오차가 그대로
 * "원본 회의노트가 …에 수정됐어요" 배너로 나갔다 — 방금 만든 **빈 미팅에도** 항상.
 * 노트는 한 번도 수정된 적이 없었다(created_at == updated_at, 차이 0).
 *
 * 단위 테스트로는 안 잡힌다("발행 직후 같은 시각이면 배지가 안 뜬다"는 이미 초록이었다).
 * 두 시계를 섞었는지는 **코드를 보는 수밖에** 없다.
 */
test('★ 스냅샷 시각은 DB 시계다 — 앱 시계를 섞으면 시계 오차가 "수정됨"으로 둔갑한다', () => {
  const src = stripComments(read('lib/crm/services/meeting-publish.ts'))
  // **값을 대입하는 자리만** 본다. 함수 파라미터의 타입 선언
  // (`noteSyncedAt: string | Date | null`)까지 세면 타입을 위반으로 잡는다.
  //
  // Prisma `select: { noteSyncedAt: true }` 도 뺀다 — 그건 **읽기**다.
  // 이 규칙이 지키려는 것은 «찍는 시각이 DB 시계인가»이지 «어디서 읽나»가 아니다.
  // (실측 v0.7.664: syncNoteTitle 이 wasStale 판정을 위해 이 값을 읽자 오탐이 났다.
  //  계측이 거칠어 없는 위반을 잡으면, 통과시키려고 진짜 규칙을 무르게 만든다.)
  // 불리언 리터럴을 «쓰기»로 넣는 실수는 Prisma 타입이 이미 막는다(Date | null).
  const writes = [...src.matchAll(/noteSyncedAt:\s*([^,\n}]+)/g)]
    .map((m) => m[1].trim())
    .filter((w) => !w.includes('|') && w !== 'true' && w !== 'false')
  assert.ok(writes.length > 0, 'noteSyncedAt 을 쓰는 곳이 있어야 한다')
  for (const w of writes) {
    if (w === 'null') continue // 연결 해제는 시각을 지운다
    assert.ok(
      w.includes('updated_at'),
      `noteSyncedAt 은 노트의 updated_at(DB 시계)으로 찍어야 한다 — 발견: ${w}`,
    )
    assert.ok(
      !/new Date\(\s*\)/.test(w),
      `앱 서버 시계(new Date())를 쓰면 안 된다 — 발견: ${w}`,
    )
  }
})

test('★ 노트를 만들 때 updated_at 을 함께 받아 온다 — 안 받으면 위 규칙을 지킬 수가 없다', () => {
  const src = stripComments(read('lib/crm/services/meeting-publish.ts'))
  assert.ok(
    src.includes("select('id, updated_at')"),
    '회의노트 insert 는 updated_at 을 함께 select 해야 한다',
  )
})
