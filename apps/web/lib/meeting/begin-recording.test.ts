/**
 * 녹음 시작 — 안 닿아도 시작된다 (가드)
 *
 * 사용자 지시 2026-09-30: *"녹음 자체는 온라인 상태가 아니어도 웹페이지가 열려있으면
 * 할 수 있어야 하는거 아닌가"* · *"어떤 상황이든 누락되는게 발생되면 안되는거야"*
 *
 * 갈리는 것은 셋이다 —
 *   ① 서버가 답했다 → 예전 그대로 (회의를 만들고 작업대로 간다)
 *   ② 서버가 답했는데 거절했다 → 그 사유를 그대로 올린다. **로컬로 새지 않는다**
 *   ③ 답이 하나도 안 왔다 → 기기가 id 를 만들고 그 자리에서 녹음을 켠다
 *
 * ③ 에도 조건이 있다. **기기에 담을 수 없으면 시작하지 않는다** —
 * 올리지도 저장하지도 못하는 녹음은 그냥 잃는 녹음이다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { beginRecording, CANNOT_KEEP_MESSAGE } from './begin-recording.ts'
import { ServerUnreachableError } from '../offline/reachable.ts'
import type { PendingMeeting } from '../offline/local-meeting.ts'

const NOW = new Date('2026-09-30T02:00:00Z') // KST 11:00

function deps(over: Partial<Parameters<typeof beginRecording>[1]> = {}) {
  const remembered: PendingMeeting[] = []
  return {
    remembered,
    opts: {
      create: async () => ({ id: 'm_1', noteId: 'n_1' }),
      remember: (m: PendingMeeting) => { remembered.push(m); return true },
      makeId: () => 'local_fixed',
      canKeepAudio: () => true,
      now: NOW,
      ...over,
    },
  }
}

test('★ 서버가 답하면 예전 그대로다 — 회의를 만들고 그 id 를 준다', async () => {
  const d = deps()
  const out = await beginRecording({}, d.opts)
  assert.deepEqual(out, { kind: 'server', id: 'm_1', noteId: 'n_1' })
  assert.equal(d.remembered.length, 0, '서버가 답했는데 기기에도 적었다')
})

test('★ 서버가 거절한 것은 로컬로 새지 않는다 — 권한 문제를 연결 문제로 바꿔 말하면 안 된다', async () => {
  const d = deps({ create: async () => { throw new Error('이 딜에는 미팅을 남길 수 없어요.') } })
  await assert.rejects(
    () => beginRecording({}, d.opts),
    (e: unknown) => e instanceof Error && e.message === '이 딜에는 미팅을 남길 수 없어요.',
  )
  assert.equal(d.remembered.length, 0, '거절당했는데 기기에 회의를 만들었다')
})

test('★ 답이 하나도 안 오면 기기가 id 를 만들고 녹음을 켤 수 있게 한다', async () => {
  const d = deps({ create: async () => { throw new ServerUnreachableError() } })
  const out = await beginRecording({}, d.opts)
  assert.equal(out.kind, 'local')
  if (out.kind !== 'local') return
  assert.equal(out.localId, 'local_fixed')
  assert.equal(out.title, '9/30 미팅', '서버로 보냈을 제목과 달라지면 회의 이름이 시작한 자리에 따라 갈린다')
  assert.equal(out.startedAt, '2026-09-30T11:00:00+09:00', '시작 시각이 녹음을 켠 순간이 아니다')
})

test('★ 대기 회의에 딜·회사가 그대로 실린다 — 연결된 뒤에 다시 고르게 하지 않는다', async () => {
  const d = deps({ create: async () => { throw new ServerUnreachableError() } })
  await beginRecording({ dealId: 'deal_1', companyId: 'co_1' }, d.opts)
  assert.equal(d.remembered.length, 1)
  assert.equal(d.remembered[0].dealId, 'deal_1')
  assert.equal(d.remembered[0].companyId, 'co_1')
  assert.equal(d.remembered[0].localId, 'local_fixed')
  assert.equal(d.remembered[0].savedAt, NOW.getTime())
})

test('★ 소리를 담을 수 없는 브라우저에서는 시작하지 않는다 — 시작하면 그게 잃는 것이다', async () => {
  const d = deps({ create: async () => { throw new ServerUnreachableError() }, canKeepAudio: () => false })
  await assert.rejects(
    () => beginRecording({}, d.opts),
    (e: unknown) => e instanceof Error && e.message === CANNOT_KEEP_MESSAGE,
  )
  assert.equal(d.remembered.length, 0, '못 담는데 대기 회의만 만들었다')
})

test('★ 대기 회의를 못 적으면 시작하지 않는다 — 적힌 데가 없으면 그 녹음은 주인이 없다', async () => {
  const d = deps({ create: async () => { throw new ServerUnreachableError() }, remember: () => false })
  await assert.rejects(
    () => beginRecording({}, d.opts),
    (e: unknown) => e instanceof Error && e.message === CANNOT_KEEP_MESSAGE,
  )
})

test('못 담는다는 말이 무엇을 하면 되는지까지 담는다', () => {
  assert.ok(!/[A-Za-z]{4,}/.test(CANNOT_KEEP_MESSAGE), '영문 원문이 샌다')
  assert.ok(/다시|연결/.test(CANNOT_KEEP_MESSAGE), '무엇을 하면 되는지 안 말한다')
})

/* ── 배선 ───────────────────────────────────────────────
   부품이 맞아도 부르는 자리가 없으면 아무 일도 안 일어난다.
   이 저장소가 여러 번 겪은 실패라 여기서 값으로 센다. */

const BOX = readFileSync(new URL('../../components/crm/MeetingIntakeBox.tsx', import.meta.url), 'utf8')

test('★ 첫 화면의 녹음 입구가 beginRecording 을 실제로 부른다', () => {
  assert.match(BOX, /await beginRecording\(/, 'import 만 하고 안 부른다')
  assert.ok(!/await startMeeting\(/.test(BOX), '예전 경로가 남아 있으면 오프라인 분기를 안 탄다')
})

test('★ 안 닿았을 때 화면을 옮기지 않는다 — 없는 주소로 가면 오프라인에서 화면이 죽는다', () => {
  const body = BOX.slice(BOX.indexOf('const begin = useCallback'), BOX.indexOf('return ('))
  const push = body.indexOf('router.push')
  const serverBranch = body.indexOf("out.kind === 'server'")
  assert.ok(serverBranch >= 0 && push > serverBranch, '이동이 서버 분기 밖에 있다')
  assert.equal(body.split('router.push').length - 1, 1, '이동하는 자리가 둘 이상이다')
})

test('★ 안 닿았으면 그 자리에서 녹음을 켜고, 켰다고 말한다', () => {
  const body = BOX.slice(BOX.indexOf('const begin = useCallback'), BOX.indexOf('return ('))
  assert.match(body, /rec\.start\(\{ noteId: out\.localId/, '로컬 회의로 녹음을 안 켠다')
  assert.match(body, /setNotice\(/, '화면이 안 바뀌는데 아무 말도 안 한다')
})
