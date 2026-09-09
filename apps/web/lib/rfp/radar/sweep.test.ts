/**
 * 자동 레이더 가드 (설계서 F8)
 *
 * 여기서 잠그는 것 셋
 * - 규칙이 DB 에서 오는가
 * - 같은 공고를 두 번 안 담는가
 * - 자동이 「찾기」까지이고 케이스 만들기는 사람이 하는가
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { toRadarRule, validateRule, type RadarRule } from './rules.ts'
import {
  matchRule, sweep, excludeSeen, canCreateCase, SCORE, FRESH_DAYS,
  type NoticeCandidate,
} from './sweep.ts'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const 지금 = () => Date.parse('2026-09-09T00:00:00Z')

const 규칙 = (over: Partial<RadarRule> = {}): RadarRule => ({
  id: 'r1', name: 'AI 사업', keywords: ['인공지능', 'AI'], classifications: [],
  budgetMin: 500_000_000, budgetMax: 5_000_000_000, agencies: [], enabled: true, lastSweptAt: null, ...over,
})

const 공고 = (over: Partial<NoticeCandidate> & { sourceId: string }): NoticeCandidate => ({
  noticeNo: 'n1', title: '인공지능 플랫폼 구축', agency: '한국전력공사',
  budgetAmount: 2_000_000_000, classification: null, noticeDate: '2026-09-08', ...over,
})

// 규칙이 DB 에서

test('DB 행을 규칙으로 옮긴다', () => {
  const r = toRadarRule({
    id: 'x', name: 'AI', keywords: ['AI'], classifications: ['정보화'],
    budget_min: 100, budget_max: 200, agencies: ['한전'], enabled: true, last_swept_at: '2026-09-01',
  })
  assert.equal(r.id, 'x')
  assert.deepEqual(r.keywords, ['AI'])
  assert.equal(r.budgetMin, 100)
  assert.equal(r.lastSweptAt, '2026-09-01')
})

test('빠진 칸은 안전한 기본값이 된다', () => {
  const r = toRadarRule({ id: 'x' })
  assert.deepEqual(r.keywords, [])
  assert.equal(r.budgetMin, null)
  assert.equal(r.enabled, true)
})

test('조건이 하나도 없는 규칙을 막는다', () => {
  // 조건이 없으면 모든 공고를 담는다. 그러면 레이더가 아니라 소음이다
  assert.ok(validateRule({ name: '전부' }).includes('no_condition'))
  assert.deepEqual(validateRule({ name: 'AI', keywords: ['AI'] }), [])
})

test('이름 없는 규칙과 뒤집힌 예산 범위를 막는다', () => {
  assert.ok(validateRule({ keywords: ['x'] }).includes('no_name'))
  assert.ok(validateRule({ name: 'x', budgetMin: 100, budgetMax: 10 }).includes('bad_budget_range'))
})

test('라우트가 규칙을 DB 에서 읽는다', () => {
  const route = readFileSync(path.join(HERE, '../../../app/api/rfp/radar/route.ts'), 'utf8')
  // 코드에 박으면 영업 담당자가 못 고치고, 못 고치면 레이더가 낡은 키워드만 훑는다
  assert.match(route, /from\('rfp_radar_rules'\)/)
})

// 점수

test('맞는 조건마다 점수가 쌓인다', () => {
  const hits = matchRule(규칙({ agencies: ['한국전력'] }), [공고({ sourceId: 's1' })], 지금)
  assert.equal(hits.length, 1)
  assert.equal(hits[0].score, SCORE.keyword + SCORE.agency + SCORE.budget + SCORE.fresh)
  assert.match(hits[0].reason, /키워드 「인공지능」/)
  assert.match(hits[0].reason, /예산 범위 안/)
})

test('아무 조건도 안 맞으면 안 담는다', () => {
  const hits = matchRule(규칙(), [공고({ sourceId: 's1', title: '청사 방수 공사', budgetAmount: 10_000 })], 지금)
  // 규칙에 조건이 있는데 아무것도 안 맞았으면 그 규칙이 찾던 것이 아니다
  assert.deepEqual(hits, [])
})

test('예산 범위 밖이면 그 점수를 안 준다', () => {
  const hits = matchRule(규칙(), [공고({ sourceId: 's1', budgetAmount: 100_000_000 })], 지금)
  assert.equal(hits[0].score, SCORE.keyword + SCORE.fresh)
})

test('오래된 공고는 신선도 점수가 없다', () => {
  const hits = matchRule(규칙(), [공고({ sourceId: 's1', noticeDate: '2026-01-01' })], 지금)
  assert.equal(hits[0].score, SCORE.keyword + SCORE.budget)
  assert.ok(FRESH_DAYS > 0)
})

test('꺼진 규칙은 안 돈다', () => {
  assert.deepEqual(matchRule(규칙({ enabled: false }), [공고({ sourceId: 's1' })], 지금), [])
})

test('점수 높은 것부터 정렬한다', () => {
  const hits = matchRule(규칙({ agencies: ['한국전력'] }), [
    공고({ sourceId: 's1', agency: '다른기관' }),
    공고({ sourceId: 's2' }),
  ], 지금)
  // 사용자는 위에서 몇 개만 본다
  assert.deepEqual(hits.map((h) => h.sourceId), ['s2', 's1'])
})

// 두 번 안 담기

test('이미 담은 것을 뺀다', () => {
  const hits = matchRule(규칙(), [공고({ sourceId: 's1' }), 공고({ sourceId: 's2' })], 지금)
  const fresh = excludeSeen(hits, [{ ruleId: 'r1', sourceId: 's1' }])
  // 담을 때마다 행이 늘면 목록이 같은 공고로 채워지고 사용자는 레이더를 끈다
  assert.deepEqual(fresh.map((h) => h.sourceId), ['s2'])
})

test('다른 규칙이 담은 것은 제외 대상이 아니다', () => {
  const hits = matchRule(규칙(), [공고({ sourceId: 's1' })], 지금)
  assert.equal(excludeSeen(hits, [{ ruleId: 'r9', sourceId: 's1' }]).length, 1)
})

test('같은 공고가 여러 규칙에 걸리면 한 줄이다', () => {
  const rules = [규칙({ id: 'r1' }), 규칙({ id: 'r2', agencies: ['한국전력'] })]
  const hits = sweep(rules, [공고({ sourceId: 's1' })], [], 지금)
  // 목록에 두 줄이 뜨면 사용자가 같은 공고를 두 번 검토한다
  assert.equal(hits.length, 1)
  assert.equal(hits[0].ruleId, 'r2', '점수 높은 규칙이 남아야 한다')
})

test('훑기가 이미 담은 것을 다시 안 담는다', () => {
  const hits = sweep([규칙()], [공고({ sourceId: 's1' })], [{ ruleId: 'r1', sourceId: 's1' }], 지금)
  assert.deepEqual(hits, [])
})

test('DB 유니크가 최종 방어다', () => {
  const sql = readFileSync(path.join(HERE, '../../../../../supabase/migrations/248_rfp_growth.sql'), 'utf8')
  // 크론 둘이 동시에 돌면 애플리케이션 판단만으로는 못 막는다
  assert.match(sql, /create table if not exists rfp_radar_hits[\s\S]*?unique \(rule_id, source_id\)/)
})

// 자동은 찾기까지

test('케이스는 사람이 연 뒤에만 만들 수 있다', () => {
  // 자동으로 만들면 분석 비용이 자동으로 나가고 아무도 안 볼 리포트가 쌓인다
  assert.equal(canCreateCase('new'), false)
  assert.equal(canCreateCase('opened'), true)
  assert.equal(canCreateCase('dismissed'), false)
})

test('훑기 라우트가 케이스를 만들지 않는다', () => {
  const route = readFileSync(path.join(HERE, '../../../app/api/rfp/radar/route.ts'), 'utf8')
  assert.equal(/from\('rfp_cases'\)\s*\n?\s*\.insert/.test(route), false, '레이더가 케이스를 만든다')
  assert.match(route, /status: 'new'/)
})
