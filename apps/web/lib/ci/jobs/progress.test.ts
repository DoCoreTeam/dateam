// lib/ci/jobs/progress.test.ts — 큐 진행 상황 가드
//
// 막는 것: **모르는 것을 아는 척하는 것.**
// 남은 시간을 근거 없이 지어내면 한 번 틀린 순간부터 아무도 안 믿는다.

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildQueueProgress, estimateEtaMinutes, formatEta, groupFailures,
  CI_JOB_STAGE_LABEL, CI_JOB_STAGE_NOTE, THROUGHPUT_MIN_SAMPLE,
} from './progress.ts'
import { CI_JOB_STAGES } from '../types.ts'

function input(over: Partial<Parameters<typeof buildQueueProgress>[0]> = {}) {
  return {
    stageCounts: [], dead: 0, recentFailures: [],
    recentDurationsMs: [], recentDoneCount: 0, recentWindowMin: 5,
    ...over,
  }
}

test('모든 단계에 사람 말 이름과 설명이 있다 — 영어 단계명은 사용자가 못 읽는다', () => {
  for (const stage of CI_JOB_STAGES) {
    assert.ok(CI_JOB_STAGE_LABEL[stage], `${stage} 라벨 없음`)
    assert.ok(CI_JOB_STAGE_NOTE[stage], `${stage} 설명 없음`)
    assert.ok(!/[a-z]{4,}/.test(CI_JOB_STAGE_LABEL[stage]), `${stage} 라벨이 영어다`)
  }
})

test('단계는 파이프라인 순서 그대로 — 건수 순으로 바꾸면 열 때마다 순서가 달라진다', () => {
  const p = buildQueueProgress(input({
    stageCounts: [
      { stage: 'project', waiting: 100, running: 0, failed: 0 },
      { stage: 'ingest', waiting: 1, running: 0, failed: 0 },
    ],
  }))
  assert.deepEqual(p.stages.map((s) => s.stage), [...CI_JOB_STAGES])
})

test('비어 있는 단계도 자리를 지킨다 — 사라지면 전체 흐름이 안 보인다', () => {
  const p = buildQueueProgress(input({ stageCounts: [{ stage: 'ingest', waiting: 5, running: 0, failed: 0 }] }))
  assert.equal(p.stages.length, CI_JOB_STAGES.length)
  assert.equal(p.stages.find((s) => s.stage === 'verify')?.waiting, 0)
})

test('남은 일에 실패는 포함하고 포기한 것(dead)은 빼놓는다', () => {
  const p = buildQueueProgress(input({
    stageCounts: [{ stage: 'ingest', waiting: 10, running: 2, failed: 3 }],
    dead: 7,
  }))
  assert.equal(p.pending, 15)
  assert.equal(p.dead, 7)
})

test('★ 표본이 적으면 처리 속도를 말하지 않는다 — 서너 건으로 "분당 N건"은 우연을 파는 것', () => {
  const few = buildQueueProgress(input({
    stageCounts: [{ stage: 'ingest', waiting: 100, running: 0, failed: 0 }],
    recentDurationsMs: Array(THROUGHPUT_MIN_SAMPLE - 1).fill(1000),
    recentDoneCount: 4, recentWindowMin: 5,
  }))
  assert.equal(few.perMinute, null)
  assert.equal(few.etaMinutes, null, '속도를 모르는데 남은 시간을 냈다')
})

test('★ 표본이 충분하면 속도와 남은 시간을 낸다', () => {
  const p = buildQueueProgress(input({
    stageCounts: [{ stage: 'ingest', waiting: 100, running: 0, failed: 0 }],
    recentDurationsMs: Array(10).fill(1000),
    recentDoneCount: 50, recentWindowMin: 5,
  }))
  assert.equal(p.perMinute, 10)
  assert.equal(p.etaMinutes, 10)
})

test('할 일이 없으면 남은 시간은 0이다 — null(모름)과 구분된다', () => {
  assert.equal(estimateEtaMinutes(0, null), 0)
  assert.equal(estimateEtaMinutes(0, 5), 0)
})

test('속도가 0이면 남은 시간을 내지 않는다 — 0으로 나누면 무한이 된다', () => {
  assert.equal(estimateEtaMinutes(100, 0), null)
  assert.equal(estimateEtaMinutes(100, null), null)
})

test('남은 시간을 사람 말로 — 초 단위는 정확해 보이지만 사실이 아니다', () => {
  assert.equal(formatEta(null), null)
  assert.equal(formatEta(0), '곧 끝납니다')
  assert.equal(formatEta(7), '약 7분 남았습니다')
  assert.equal(formatEta(60), '약 1시간 남았습니다')
  assert.equal(formatEta(95), '약 1시간 35분 남았습니다')
})

test('단계 비율은 남은 일 대비다 — 합이 1이 된다', () => {
  const p = buildQueueProgress(input({
    stageCounts: [
      { stage: 'ingest', waiting: 30, running: 0, failed: 0 },
      { stage: 'enrich', waiting: 70, running: 0, failed: 0 },
    ],
  }))
  const sum = p.stages.reduce((a, s) => a + s.share, 0)
  assert.ok(Math.abs(sum - 1) < 1e-9)
  assert.ok(Math.abs((p.stages.find((s) => s.stage === 'enrich')?.share ?? 0) - 0.7) < 1e-9)
})

test('할 일이 없으면 비율은 전부 0이다 — 0으로 나누지 않는다', () => {
  const p = buildQueueProgress(input())
  assert.ok(p.stages.every((s) => s.share === 0))
  assert.equal(p.pending, 0)
  assert.equal(p.etaMinutes, 0)
})

/* ───────── 실패 묶기 ───────── */

test('★ 같은 사유의 실패는 묶는다 — 같은 줄이 스무 번 나오면 다른 문제를 못 본다', () => {
  const rows = [
    ...Array(20).fill({ stage: 'enrich' as const, message: '쿼터 초과', status: 'failed' as const }),
    { stage: 'ingest' as const, message: '채널을 찾을 수 없습니다', status: 'dead' as const },
  ]
  const out = groupFailures(rows)
  assert.equal(out.length, 2)
  assert.equal(out[0].count, 20)
  assert.equal(out[0].stageLabel, '영상 읽기')
  assert.equal(out[1].count, 1)
})

test('사유가 없으면 그렇다고 말한다 — 빈 줄을 보여주지 않는다', () => {
  const out = groupFailures([{ stage: 'ingest', message: null, status: 'failed' }])
  assert.equal(out[0].message, '알 수 없는 오류')
})

test('같은 사유라도 단계나 상태가 다르면 따로 센다 — 되살릴 수 있는 것과 아닌 것은 다르다', () => {
  const out = groupFailures([
    { stage: 'ingest', message: '오류', status: 'failed' },
    { stage: 'ingest', message: '오류', status: 'dead' },
    { stage: 'classify', message: '오류', status: 'failed' },
  ])
  assert.equal(out.length, 3)
})

test('많이 난 것부터, 상한까지만 — 목록이 길면 읽히지 않는다', () => {
  const rows = Array.from({ length: 12 }, (_, i) => ({
    stage: 'ingest' as const, message: `오류${i}`, status: 'failed' as const,
  }))
  assert.equal(groupFailures(rows, 5).length, 5)
})
