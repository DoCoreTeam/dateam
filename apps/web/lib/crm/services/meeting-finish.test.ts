/**
 * 「미팅 끝내기」 계약 — **한 번 눌러 끝나되, 넘어져도 멈추지 않는다**
 *
 * 사용자 시나리오(2026-08-27): 회의가 끝나고 차에 타면서 한 번 누른다.
 * 그 한 번이 ① 끝난 시각 ② 정리 ③ 5축 ④ **모르는 것 되묻기**까지 간다.
 *
 * 여기서 잠그는 것 넷 —
 *   ① **부분 실패**: 한 단계가 넘어져도 나머지가 간다. 그리고 그 사실을 말한다
 *   ② **되묻기**: 못 채운 자리를 반드시 사람에게 돌려준다(안 하면 사용자는 다 된 줄 안다)
 *   ③ **저장하지 않는다**: 질문은 상태의 그림자다. 저장하면 답한 뒤에도 남는다
 *   ④ **말**: 축 이름은 한 곳에서만 온다 — 두 화면이 같은 축을 다르게 부르던 것을 막는다
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { listOpenQuestions, MAX_QUESTIONS } from './ask-suggest.ts'
import { AXIS_META, AXIS_ORDER, axisMeta } from '../ui/suggestion-axis.ts'
import { STATUS_COLORS } from '../../tokens/status-colors.ts'

const FINISH = readFileSync(new URL('./meeting-finish.ts', import.meta.url), 'utf8')
/*
  실행은 2026-09-16 에 드레인으로 옮겼다 — 한 요청이 정리와 5축을 잇달아 돌다 300초
  상한에 잘려 5축이 기록 없이 사라진 사고 때문이다(실측 2026-09-14).
  단계 «순서»와 «부분 실패» 계약은 그래서 이제 이 파일에서 본다.
*/
const DRAIN = readFileSync(new URL('../jobs/finish-drain.ts', import.meta.url), 'utf8')
const DEPS = readFileSync(new URL('../jobs/finish-deps.ts', import.meta.url), 'utf8')
const ASK = readFileSync(new URL('./ask-suggest.ts', import.meta.url), 'utf8')
const ROUTE = readFileSync(
  new URL('../../../app/api/crm/meetings/[id]/finish/route.ts', import.meta.url), 'utf8')
const DETAIL = readFileSync(
  new URL('../../../app/(crm)/crm/meetings/[id]/MeetingDetail.tsx', import.meta.url), 'utf8')
const CARD = readFileSync(
  new URL('../../../app/(crm)/crm/inbox/SuggestionCard.tsx', import.meta.url), 'utf8')

/** 최소한의 가짜 db — 질문 규칙은 순수하게 검증할 수 있어야 한다 */
type Row = Record<string, unknown> | null
function fakeDb(opts: { company?: Row; deal?: Row; openTasks?: number }) {
  return {
    crmCompany: { findFirst: async () => opts.company ?? null },
    crmDeal: { findFirst: async () => opts.deal ?? null },
    crmTask: { count: async () => opts.openTasks ?? 0 },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

const COMPANY = { id: 'c1', name: '한빛산업', domain: 'hanbit.co.kr' }
const FULL_DEAL = {
  id: 'd1', name: 'GPU 도입', status: 'OPEN',
  amountMinor: 300000000n, expectedCloseDate: new Date('2026-10-01'),
  ownerId: 'm1', contacts: [{ id: 'dc1' }],
}

/* ── ② 되묻기 ───────────────────────────────────────────── */

test('★ 회사를 모르면 그것부터 묻고 거기서 멈춘다 — 나머지 질문이 전부 무의미하다', async () => {
  const qs = await listOpenQuestions(fakeDb({}), { meetingId: 'm1', companyId: null, dealId: null })
  assert.equal(qs.length, 1)
  assert.equal(qs[0].key, 'meeting.company')
  assert.match(qs[0].href, /\/crm\/meetings\/m1$/, '답할 화면으로 보내지 않는다')
})

test('예정에 없던 미팅 — 회사만 정해졌으면 어떤 건인지 묻는다 (시나리오 B)', async () => {
  const qs = await listOpenQuestions(
    fakeDb({ company: COMPANY }), { meetingId: 'm1', companyId: 'c1', dealId: null })
  assert.ok(qs.some((q) => q.key === 'meeting.deal'), '딜 귀속을 안 묻는다')
  assert.ok(qs.every((q) => !q.key.startsWith('deal.')), '딜을 모르는데 딜 속을 묻는다')
})

test('★ 비어 있는 것마다 왜 물어보는지 말한다 — 이유 없는 물음은 두 번째부터 무시된다', async () => {
  const qs = await listOpenQuestions(
    fakeDb({
      company: { ...COMPANY, domain: null },
      deal: { ...FULL_DEAL, amountMinor: null, expectedCloseDate: null, ownerId: null, contacts: [] },
      openTasks: 0,
    }),
    { meetingId: 'm1', companyId: 'c1', dealId: 'd1' },
  )
  const keys = qs.map((q) => q.key)
  for (const k of ['company.domain', 'deal.amount', 'deal.closeDate', 'deal.owner']) {
    assert.ok(keys.includes(k), `${k} 를 안 묻는다`)
  }
  for (const q of qs) {
    assert.ok(q.why.trim().length > 0, `${q.key}: 이유가 없다`)
    assert.ok(q.ask.endsWith('?'), `${q.key}: 질문이 아니라 진술이다 — "${q.ask}"`)
  }
})

test('★ 다 채워져 있으면 아무것도 안 묻는다 — 매번 뜨면 그때부터 잔소리다', async () => {
  const qs = await listOpenQuestions(
    fakeDb({ company: COMPANY, deal: FULL_DEAL, openTasks: 2 }),
    { meetingId: 'm1', companyId: 'c1', dealId: 'd1' },
  )
  assert.deepEqual(qs, [])
})

test('★ 끝난 딜의 빈칸은 묻지 않는다 — 고칠 이유가 없다', async () => {
  const qs = await listOpenQuestions(
    fakeDb({
      company: COMPANY,
      deal: { ...FULL_DEAL, status: 'WON', amountMinor: null, ownerId: null, contacts: [] },
    }),
    { meetingId: 'm1', companyId: 'c1', dealId: 'd1' },
  )
  assert.ok(qs.every((q) => !q.key.startsWith('deal.')), '끝난 딜을 두고 계속 묻는다')
})

test('다음 할 일이 있으면 그건 묻지 않는다 — 이미 정해진 것을 또 묻지 않는다', async () => {
  const qs = await listOpenQuestions(
    fakeDb({ company: COMPANY, deal: FULL_DEAL, openTasks: 1 }),
    { meetingId: 'm1', companyId: 'c1', dealId: 'd1' },
  )
  assert.ok(!qs.some((q) => q.key === 'deal.nextAction'))
})

test('질문 수에 상한이 있다 — 넘으면 사람이 목록 전체를 닫는다', async () => {
  const qs = await listOpenQuestions(
    fakeDb({
      company: { ...COMPANY, domain: null },
      deal: { ...FULL_DEAL, amountMinor: null, expectedCloseDate: null, ownerId: null, contacts: [] },
    }),
    { meetingId: 'm1', companyId: 'c1', dealId: 'd1' },
  )
  assert.ok(qs.length <= MAX_QUESTIONS, `${qs.length}건 — 상한 ${MAX_QUESTIONS}`)
})

/* ── ③ 저장하지 않는다 ──────────────────────────────────── */

test('★ 질문을 제안으로 저장하지 않는다 — 답한 뒤에도 인박스에 남는다', () => {
  assert.ok(!/crmSuggestion[\s\S]{0,40}create/.test(ASK), '질문을 저장하고 있다')
  assert.ok(!/\.create\(/.test(ASK), '되묻기가 무언가를 쓴다 — 여기는 읽기만 한다')
})

test('되묻기는 AI 를 부르지 않는다 — 빈칸 세기는 규칙이 정확하고 공짜다', () => {
  assert.ok(!/runAi|adapter/.test(ASK), 'AI 를 부른다 — 실패하면 되묻기가 통째로 사라진다')
})

/* ── ① 부분 실패 ───────────────────────────────────────── */

test('★ 정리가 실패해도 5축으로 넘어간다 — 한 단계가 회의 전체를 잃게 두지 않는다', () => {
  const digestAt = DRAIN.indexOf("key: 'digest', status: 'failed'")
  const extractAt = DRAIN.indexOf('extractFiveAxis(')
  assert.ok(digestAt > 0 && extractAt > digestAt, '정리 실패가 5축보다 뒤에 있다 — 멈춘다는 뜻이다')
  assert.ok(!/throw[\s\S]{0,80}digest/.test(DRAIN), '정리 실패를 던진다')
})

test('★ 앞이 다 실패해도 되묻기는 반드시 답한다', () => {
  /*
    되묻기는 이제 조회 라우트가 만든다 — 잡이 끝난 뒤에 물어야 뜻이 있기 때문이다.
    도는 중에 보여 주면 아직 모르는 것을 물어보는 셈이 된다.
  */
  const askAt = ROUTE.indexOf('listOpenQuestions(')
  assert.ok(askAt > 0, '조회 라우트가 되묻기를 안 만든다')
  assert.match(ROUTE.slice(askAt), /catch/, '되묻기 실패가 진행 조회를 실패로 만든다')
})

test('★ 이미 끝난 미팅의 시각을 덮지 않는다 — 두 번 눌렀다고 기록이 거짓이 되면 안 된다', () => {
  assert.match(DRAIN, /if \(!meeting\.endedAt\)[\s\S]{0,600}status: 'skipped', detail: T\.endSkipped/,
    '이미 끝난 미팅에도 새 시각을 쓴다')
})

test('전사가 없는 것은 실패가 아니라 아직 할 게 없는 것이다', () => {
  assert.match(DRAIN, /nothingToRead \? 'skipped' : 'failed'/,
    '"먼저 전사를 넣어 주세요"를 빨간 실패로 보여 준다')
})

/* ── 배선 ──────────────────────────────────────────────── */

test('★ 라우트가 잡을 만들고, 화면이 그 라우트를 부른다 — 만들고 안 꽂으면 없는 기능이다', () => {
  assert.match(ROUTE, /enqueueFinish\(/, '라우트가 잡을 안 만든다')
  assert.match(DETAIL, /meetings\/\$\{meetingId\}\/finish/, '화면이 라우트를 안 부른다')
  /*
    버튼 라벨은 v0.7.702 부터 SSOT 가 정한다(`lib/crm/ui/finish-progress`) — 도는 동안
    단계를 밝혀야 해서 화면이 문자열을 짓지 않는다. 여기서는 **버튼이 있는지**만 본다.
  */
  assert.match(DETAIL, /finishButtonLabel\(finishPhase/, '버튼이 없다')
})

test('★ 녹음을 먼저 멈춘다 — 마지막 몇 분이 정리에서 빠지면 사용자는 그걸 모른다', () => {
  const stopAt = DETAIL.indexOf('await rec.stop()')
  const postAt = DETAIL.indexOf('/finish`, { method:')
  assert.ok(stopAt > 0, '녹음을 멈추지 않는다')
  assert.ok(stopAt < postAt, '정리를 먼저 시작한다')
})

test('결과는 된 것과 안 된 것을 함께 보여 준다 — 「완료」만 띄우면 실패가 묻힌다', () => {
  assert.match(DETAIL, /finishJob\.steps\.map/, '단계 결과를 안 그린다')
  assert.match(DETAIL, /finishJob\.questions\.map/, '되물음을 안 그린다')
  assert.match(DETAIL, /data-status=\{st\.status\}/, '실패와 성공이 같은 모양이다')
  /*
    실측 2026-09-16: 한도 소진으로 정리·5축이 둘 다 실패했는데 잡은 끝났다(설계대로다).
    그때 머리말까지 「미팅을 정리했어요」면 실패가 조용히 묻힌다.
  */
  assert.match(DETAIL, /failedSteps\.length > 0/, '전부 실패해도 성공과 같은 머리말을 단다')
})

test('★ 나갔다 와도 진행이 보인다 — 진행이 화면 안 상태가 아니라 표에 있다', () => {
  assert.match(DETAIL, /loadFinish/, '화면에 들어올 때 잡 상태를 안 읽는다')
  assert.match(DETAIL, /meetings\/jobs\/finish/, '화면이 잡을 굴리지 않는다 — 크론만 기다리면 2분씩 멎어 보인다')
  assert.doesNotMatch(DETAIL, /setBusy\(null\)\s*\n\s*setFinishPhase\(null\)\s*\n\s*setWorkingSince\(null\)\s*\n\s*\}\s*\n\s*\}\s*\n\s*async function extract/,
    'finally 에서 버튼을 풀면 잡이 도는 중에 다시 눌린다')
})

/* ── ④ 말 ──────────────────────────────────────────────── */

test('★ 축 이름을 화면마다 다시 정하지 않는다 — 같은 제안이 두 화면에서 다르게 읽혔다', () => {
  for (const [name, src] of [['미팅 상세', DETAIL], ['인박스 카드', CARD]] as const) {
    assert.match(src, /axisMeta\(/, `${name}: SSOT 를 안 쓴다`)
    assert.ok(!/AXIS_LABEL(:|\s*=)/.test(src), `${name}: 자기 축 라벨 맵을 다시 갖고 있다`)
  }
})

test('축 라벨이 전부 StatusKey 에 매핑된다 — 색을 화면이 안 정한다', () => {
  for (const k of AXIS_ORDER) {
    assert.ok(STATUS_COLORS[AXIS_META[k].status], `${k}: ${AXIS_META[k].status} 는 StatusKey 가 아니다`)
  }
  assert.deepEqual([...AXIS_ORDER].sort(), Object.keys(AXIS_META).sort())
})

test('모르는 축이 와도 화면이 비지 않는다', () => {
  assert.equal(axisMeta('WHO').label, '누가')
  assert.equal(axisMeta('SOMETHING_NEW').label, 'SOMETHING_NEW')
})

/* ── ⑤ 같은 회의는 두 화면에서 같은 상태여야 한다 ──────────────── */

test('★ 미팅을 끝내면 원본 회의노트도 「확정」이 된다 — 두 화면이 다른 말을 하지 않게', () => {
  /*
    사용자 지적(2026-09-01): 「CRM에서 회의 끝내기까지 눌렀는데 작성 중? 설계가 잘못된 거 아냐?」

    회의노트(`meeting_notes`)와 미팅(`crm_meeting`)은 다른 표지만 **사용자에게는 같은 회의 한 건**이다.
    끝내기가 미팅의 `endedAt` 만 남기고 노트를 `draft` 로 두면, 같은 회의를 두 화면이 다르게 말한다.
  */
  // **호출**을 단정한다 — 함수 이름만 보면 정의가 남아 있는 한 통과한다(일부러 깨서 확인했다)
  // 확정 단계는 드레인이 돌리고(NOTE), 실제 쓰기는 deps 가 한다
  assert.match(DRAIN, /await deps\.confirmNote\(meeting\.noteId\)/, '드레인이 회의노트 상태를 올리지 않는다')
  assert.match(DEPS, /status: 'final'/, "노트를 'final' 로 올리는 쓰기가 없다")

  // 이미 확정이면 손대지 않는다 — 두 번 눌러도 사실이 안 바뀐다
  assert.match(DEPS, /row\.status === 'final'/, '이미 확정인 노트를 다시 쓴다')

  // 노트 단계가 실패해도 끝내기는 계속된다(이 서비스의 원칙)
  const noteBlock = DRAIN.slice(DRAIN.indexOf("key: 'note'") - 800, DRAIN.indexOf("key: 'note'") + 400)
  assert.match(noteBlock, /catch/, '노트 실패가 끝내기를 통째로 실패로 만든다')
})

test('노트 단계가 결과에 실린다 — 무엇이 됐는지 화면이 말할 수 있어야 한다', () => {
  assert.match(FINISH, /FinishStepKey = [^\n]*'note'/, "단계 키에 'note' 가 없다")
  // 「올렸어요」와 「이미 확정이에요」는 둘 다 성공이지만 뜻이 다르다 — 구분해 말한다
  assert.match(FINISH, /이미 확정이에요/, '이미 확정인 경우를 구분해 말하지 않는다')
})
