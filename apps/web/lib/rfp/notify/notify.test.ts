/**
 * 알림 가드 (설계서 F8)
 *
 * 여기서 잠그는 것 셋
 * - 세 가지 알림(분석 완료·레이더 적중·비용 상한)이 나가는가
 * - 사용자별로 끄고 켤 수 있는가
 * - 알림 실패가 본 작업을 안 막는가
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  notify, planNotifications, isEnabled, analysisDone, analysisFailed, radarHit,
  budgetWarning, deadlineSoon, NOTIFY_KINDS, DEFAULT_ENABLED, ALWAYS_ON,
  BUDGET_WARN_RATIO, DEADLINE_WARN_DAYS, type NotifyPrefs, type Notification,
} from './notify.ts'

const 지금 = () => Date.parse('2026-09-09T00:00:00Z')

const 설정 = (kinds: NotifyPrefs['kinds']): NotifyPrefs => ({ userId: 'u1', kinds })

// 종류

test('알림 종류가 여섯이고 기본값이 다 있다', () => {
  assert.equal(NOTIFY_KINDS.length, 6)
  for (const k of NOTIFY_KINDS) {
    assert.equal(typeof DEFAULT_ENABLED[k], 'boolean', `${k} 에 기본값이 없다`)
  }
})

test('세 가지 알림이 만들어진다', () => {
  assert.equal(analysisDone('o1', '○○사업', 'c1').kind, 'analysis_done')
  assert.equal(radarHit('o1', 3).kind, 'radar_hit')
  assert.equal(budgetWarning('o1', 900_000, 1_000_000)?.kind, 'budget_warning')
})

test('알림에 갈 곳이 붙는다', () => {
  // 링크가 없으면 사용자가 알림을 보고도 못 찾아간다
  assert.equal(analysisDone('o1', 'ㄱ', 'c1').link, '/rfp/cases/c1')
  assert.equal(radarHit('o1', 1).link, '/rfp/radar')
})

test('비용이 한도의 80% 를 넘어야 경고한다', () => {
  assert.equal(budgetWarning('o1', 700_000, 1_000_000), null)
  assert.ok(budgetWarning('o1', 800_000, 1_000_000))
  assert.equal(BUDGET_WARN_RATIO, 0.8)
  // 한도가 없으면 경고할 것도 없다
  assert.equal(budgetWarning('o1', 900_000, 0), null)
})

test('마감이 사흘 안일 때만 알린다', () => {
  assert.ok(deadlineSoon('o1', 'ㄱ', 'c1', '2026-09-11', 지금))
  assert.equal(deadlineSoon('o1', 'ㄱ', 'c1', '2026-10-11', 지금), null)
  // 이미 지난 마감은 알릴 것이 아니다
  assert.equal(deadlineSoon('o1', 'ㄱ', 'c1', '2026-09-01', 지금), null)
  assert.equal(DEADLINE_WARN_DAYS, 3)
})

// 켜고 끄기

test('사용자가 끈 종류는 안 보낸다', () => {
  const prefs = new Map([['u1', 설정({ radar_hit: false })]])
  const rows = planNotifications({ ...radarHit('o1', 2), userIds: ['u1', 'u2'], prefsByUser: prefs })
  // 종류별로 못 끄면 사용자는 채널 자체를 끊고 정말 중요한 알림도 안 간다
  assert.deepEqual(rows.map((r) => r.userId), ['u2'])
})

test('실패 알림은 꺼도 나간다', () => {
  const prefs = new Map([['u1', 설정({ analysis_failed: false })]])
  const rows = planNotifications({
    ...analysisFailed('o1', 'ㄱ', 'c1', '배포용 문서'), userIds: ['u1'], prefsByUser: prefs,
  })
  // 안 보내면 사용자가 손해를 본다
  assert.equal(rows.length, 1)
  assert.deepEqual([...ALWAYS_ON], ['analysis_failed'])
})

test('설정이 없으면 기본값을 쓴다', () => {
  assert.equal(isEnabled('radar_hit', null), DEFAULT_ENABLED.radar_hit)
  assert.equal(isEnabled('radar_hit', 설정({})), DEFAULT_ENABLED.radar_hit)
  assert.equal(isEnabled('radar_hit', 설정({ radar_hit: false })), false)
})

test('받을 사람을 안 정하면 조직 전체다', () => {
  const rows = planNotifications(radarHit('o1', 1))
  assert.equal(rows.length, 1)
  assert.equal(rows[0].userId, null)
})

test('꺼 둔 사람만 있으면 아무것도 안 보낸다', () => {
  const prefs = new Map([['u1', 설정({ radar_hit: false })]])
  assert.deepEqual(planNotifications({ ...radarHit('o1', 1), userIds: ['u1'], prefsByUser: prefs }), [])
})

// 실패해도 안 막는다

test('알림이 실패해도 던지지 않는다', async () => {
  const r = await notify(radarHit('o1', 1), async () => { throw new Error('DB 연결 끊김') })
  // 알림 실패가 분석을 실패로 만들면 사용자는 다시 돌리고 비용을 또 낸다
  assert.equal(r.sent, 0)
  assert.match(r.error ?? '', /DB 연결 끊김/)
})

test('삼킨 오류를 남긴다', async () => {
  const r = await notify(radarHit('o1', 1), async () => { throw new Error('429') })
  // 조용히 사라지면 알림이 안 오는 이유를 못 찾는다
  assert.ok(r.error)
})

test('성공하면 보낸 수를 돌려준다', async () => {
  let 받은: readonly Notification[] = []
  const r = await notify({ ...radarHit('o1', 1), userIds: ['u1', 'u2'] }, async (rows) => { 받은 = rows })
  assert.equal(r.sent, 2)
  assert.equal(r.error, null)
  assert.equal(받은.length, 2)
})

test('보낼 것이 없으면 창구를 안 부른다', async () => {
  let 불림 = 0
  const prefs = new Map([['u1', 설정({ radar_hit: false })]])
  const r = await notify({ ...radarHit('o1', 1), userIds: ['u1'], prefsByUser: prefs }, async () => { 불림++ })
  assert.equal(r.sent, 0)
  assert.equal(불림, 0)
})
