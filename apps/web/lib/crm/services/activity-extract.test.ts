/**
 * 활동 노트 AI 읽기 가드
 *
 * 이 기능이 죽는 방식은 셋이다. 셋 다 정적으로 잡을 수 있다.
 *   ① 만들어 놓고 화면에 안 꽂는다 → 사용자에게는 없는 기능이다
 *   ② 미팅과 두 벌이 된다 → 한쪽만 고치게 되고 그 차이가 제품의 성격이 된다
 *   ③ 근거 검증을 건너뛴다 → 지어낸 값이 인박스를 거쳐 CRM 에 들어간다
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

import { noteToSegments } from './activity-extract.ts'
import { buildMeetingExtractPrompt } from '../ai/prompts/meeting-extract.v1.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const WEB = resolve(HERE, '../../..')
const read = (p: string) => readFileSync(resolve(WEB, p), 'utf8')

const SRC = read('lib/crm/services/activity-extract.ts')
const ROUTE = read('app/api/crm/activities/[id]/extract/route.ts')
const TIMELINE = read('components/ui/crm/Timeline.tsx')

// ── 근거 조각 ────────────────────────────────────────────────────────────────

test('★ 노트는 줄이 근거 단위다 — 줄 번호가 없으면 "어디서 나온 말인지"를 못 댄다', () => {
  const segs = noteToSegments('김 팀장 미팅', '예산 3억 확정\n8월 25일까지 견적')
  assert.deepEqual(segs.map((s) => s.id), ['L1', 'L2', 'L3'])
  assert.equal(segs[0].text, '김 팀장 미팅')
  assert.equal(segs[2].text, '8월 25일까지 견적')
})

test('빈 줄·공백 줄은 근거가 될 수 없다 — 번호만 밀려 근거 대조가 어긋난다', () => {
  const segs = noteToSegments('제목', '\n  \n실제 내용\n\n')
  assert.deepEqual(segs.map((s) => s.text), ['제목', '실제 내용'])
  assert.deepEqual(segs.map((s) => s.id), ['L1', 'L2'])
})

test('본문이 없어도 제목만으로 조각이 된다 — 한 줄 노트가 가장 흔하다', () => {
  const segs = noteToSegments('전화로 예산 3억 확정 들음', null)
  assert.equal(segs.length, 1)
  assert.equal(segs[0].id, 'L1')
})

test('★ 붙여넣기 한 방에 비용이 폭발하지 않게 줄 수에 상한이 있다', () => {
  const body = Array.from({ length: 500 }, (_, i) => `줄 ${i}`).join('\n')
  const segs = noteToSegments('제목', body)
  assert.ok(segs.length <= 200, `상한을 넘었다: ${segs.length}`)
})

test('말한 사람은 비운다 — 노트에는 화자가 없다. 지어내면 AI 가 그걸 사실로 읽는다', () => {
  const segs = noteToSegments('제목', '내용')
  assert.ok(segs.every((s) => s.speaker === null))
})

// ── 프롬프트: 한 벌을 두 말로 ────────────────────────────────────────────────

const SEGS = noteToSegments('테스트', '내용이 충분히 긴 노트 한 줄')

test('★ 미팅 기본 문구는 한 글자도 바뀌지 않는다 — 활동을 붙이며 미팅을 망가뜨리면 안 된다', () => {
  const p = buildMeetingExtractPrompt(SEGS, { meetingDate: '2026-08-16' })
  for (const phrase of [
    '영업 미팅 기록', '전사 구간', '이 회의가 열린 날',
    '날짜는 회의 날짜를 기준으로 읽는다', '회의가 열린 해',
    '회의 날짜는 아래에 있다', '회의 날짜보다 앞선 날짜',
  ]) {
    assert.ok(p.includes(phrase), `미팅 문구가 사라졌다: ${phrase}`)
  }
})

test('sourceKind 를 안 주면 미팅과 완전히 같은 프롬프트다 (하위호환)', () => {
  const a = buildMeetingExtractPrompt(SEGS, { meetingDate: '2026-08-16' })
  const b = buildMeetingExtractPrompt(SEGS, { meetingDate: '2026-08-16', sourceKind: 'meeting' })
  assert.equal(a, b)
})

test('★ 노트에는 "전사"·"회의"라고 말하지 않는다 — 없는 맥락을 상상하게 된다', () => {
  const p = buildMeetingExtractPrompt(SEGS, { meetingDate: '2026-08-16', sourceKind: 'note' })
  assert.ok(p.includes('영업 활동 기록'), '기록이라고 부르지 않는다')
  assert.ok(p.includes('기록 줄'), '근거 단위를 줄이라고 말하지 않는다')
  assert.ok(p.includes('이 기록을 남긴 날'), '날짜 라벨이 회의용 그대로다')
  assert.ok(!p.includes('전사 구간'), '노트인데 "전사 구간"이라 부른다')
  assert.ok(!p.includes('회의가 열린 해'), '노트인데 "회의가 열린 해"라고 말한다')
})

test('노트도 연도 규칙을 그대로 받는다 — 없으면 "8월 25일"이 지난 해로 적힌다', () => {
  const p = buildMeetingExtractPrompt(SEGS, { meetingDate: '2026-08-16', sourceKind: 'note' })
  assert.ok(p.includes('기록을 남긴 해'), '연도 기준이 프롬프트에 없다')
  assert.ok(p.includes('2026-08-16'), '기준 날짜가 프롬프트에 없다')
})

// ── 배선·SSOT ────────────────────────────────────────────────────────────────

test('★ 화면이 실제로 이 API 를 부른다 — 만들고 안 꽂으면 없는 기능이다', () => {
  assert.ok(TIMELINE.includes('/extract'), '타임라인이 추출을 부르지 않는다')
  assert.ok(/api\/crm\/activities\/\$\{[^}]+\}\/extract/.test(TIMELINE),
    '타임라인이 활동 추출 경로를 부르지 않는다')
})

test('★ 결과를 화면이 말한다 — 눌러도 아무 일 없어 보이면 두 번째부터 아무도 안 누른다', () => {
  assert.ok(TIMELINE.includes('인박스'), '어디로 갔는지 말하지 않는다')
  assert.ok(TIMELINE.includes('suggested'), '몇 건인지 말하지 않는다')
})

test('라우트가 서비스를 부른다', () => {
  assert.ok(ROUTE.includes('extractActivityFiveAxis'), '라우트가 서비스를 안 부른다')
  assert.ok(ROUTE.includes("withCrmApi('MEMBER'"), '로그인·멤버십을 확인하지 않는다')
})

test('★ 모델 선택을 두 벌로 만들지 않는다 — 설정을 바꿔도 한쪽만 따라간다', () => {
  const meetingRoute = read('app/api/crm/meetings/[id]/extract/route.ts')
  for (const [name, src] of [['활동', ROUTE], ['미팅', meetingRoute]] as const) {
    assert.ok(src.includes('adapterFromSetting'), `${name} 라우트가 어댑터를 손으로 고른다`)
    assert.ok(!src.includes('hostAdapter('), `${name} 라우트가 어댑터 결정을 다시 구현했다`)
  }
})

test('★ 제안 매핑도 SSOT 를 쓴다 — 직접 만들면 미팅과 다른 제안이 나온다', () => {
  assert.ok(SRC.includes('fiveAxisToSuggestions'), '제안 SSOT 를 안 쓴다')
  assert.ok(!SRC.includes('createSuggestion'), '제안을 직접 만든다')
})

test('★ 근거 검증을 거친다 — 건너뛰면 지어낸 값이 그대로 인박스에 들어간다', () => {
  assert.ok(SRC.includes('dropUngrounded'), '근거 검증이 없다')
  assert.ok(SRC.includes('validIds'), '유효한 근거 목록을 만들지 않는다')
})

test('★ 활동에 붙인다 — 미팅에 붙이면 근거를 눌렀을 때 없는 미팅으로 간다', () => {
  assert.ok(/anchorType:\s*'activity'/.test(SRC), "anchorType 이 'activity' 가 아니다")
})

test('★ 새 AI 종류를 만들지 않는다 — enum 을 늘리면 마이그레이션이 필요해진다', () => {
  assert.ok(/kind:\s*'MEETING_EXTRACT'/.test(SRC), '기존 종류를 쓰지 않는다')
  assert.ok(SRC.includes('activityId'), 'inputRef 로 구분하지 않으면 미팅과 섞인다')
})

test('★ 같은 기록을 두 번 읽지 않는다 — 활동은 고칠 수 없어 다시 읽어도 같은 글이다', () => {
  assert.ok(SRC.includes('crmAiRun.findFirst'), '이전 실행을 확인하지 않는다')
  assert.ok(SRC.includes('이미 AI 가 읽었어요'), '중복 실행을 사람 말로 막지 않는다')
})

test('★ 너무 짧은 기록은 AI 를 부르지 않는다 — "전화함" 세 글자에서 뽑을 것은 없다', () => {
  assert.ok(SRC.includes('MIN_CHARS'), '짧은 기록 게이트가 없다')
  assert.ok(/chars\s*<\s*MIN_CHARS/.test(SRC), '게이트가 실제로 걸리지 않는다')
})

test('★ 인물 노트도 회사를 되찾는다 — 안 하면 WHO 축이 통째로 죽는다', () => {
  assert.ok(SRC.includes('crmPerson.findFirst'), '인물에서 회사를 되찾지 않는다')
})

test('★ 기록을 지우면 그 기록에서 나온 제안도 거둔다 — 지운 글의 값이 CRM 에 들어가면 안 된다', () => {
  const activity = read('lib/crm/services/activity.ts')
  assert.ok(activity.includes("path: ['activityId']"), '지울 때 이 기록의 AI 실행을 안 찾는다')
  assert.ok(/status:\s*'PENDING'/.test(activity), '아직 안 본 제안을 안 거둔다')
  assert.ok(activity.includes("data: { status: 'EXPIRED' }"), '거두는 처리가 없다')
  // 사람이 이미 판단한 것은 사실로 일어난 일이라 건드리지 않는다
  assert.ok(!activity.includes("status: 'ACCEPTED'"), '사람이 수락한 것까지 되돌린다')
})

test('맥락 조회도 SSOT 다 — 우리 직원을 고객으로 등록하는 사고가 한쪽에서만 막히면 안 된다', () => {
  assert.ok(SRC.includes('loadExtractContext'), '맥락 SSOT 를 쓰지 않는다')
  const meeting = read('lib/crm/services/meeting.ts')
  assert.ok(meeting.includes('loadExtractContext'), '미팅이 여전히 자기 사본을 쓴다')
  assert.ok(!/async function loadContext\(/.test(meeting), '미팅에 사본이 남아 있다')
})
