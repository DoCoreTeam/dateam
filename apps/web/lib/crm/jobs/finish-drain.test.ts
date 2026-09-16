// lib/crm/jobs/finish-drain.test.ts — 끝내기 드레인
//
// 실측 2026-09-14: 한 번의 요청이 정리와 5축을 잇달아 돌리다 300초 상한에 잘렸다.
// 295초에 정리만 저장됐고, 5축은 `crm_ai_run` 에 행 하나 없이 사라졌다.
// 여기서 보는 것: 한 회차가 한 단계씩 저장하는가, 끊겨도 앞 단계가 남는가, 입구가 새지 않는가.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { nextStage, mergeSteps, type FinishStage } from './finish-queue.ts'
import type { FinishStep } from '../services/meeting-finish.ts'

/**
 * 드레인의 단계 진행만 떼어 재현한다.
 *
 * 실제 `drainFinishJobs` 는 Prisma 와 Supabase 를 물고 있어 실브라우저 말고는 밟을 수
 * 없다(정책 E-6). 여기서 재현하는 것은 그 파일이 지켜야 할 **모양**이고,
 * 그 모양을 실제로 지키는지는 아래 정적 가드가 본다.
 */
function simulate(opts: {
  deadlineAfterStages: number
  stageResult: (stage: FinishStage) => FinishStep[]
}): { saves: { stage: FinishStage; steps: FinishStep[] }[]; endedAt: FinishStage } {
  const saves: { stage: FinishStage; steps: FinishStage extends never ? never : FinishStep[] }[] = []
  let stage: FinishStage = 'DIGEST'
  let steps: FinishStep[] = []
  let ran = 0

  while (stage !== 'DONE') {
    if (ran >= opts.deadlineAfterStages) break   // 예산 소진 — 시작하지 않고 임대를 놓는다
    steps = mergeSteps(steps, opts.stageResult(stage))
    stage = nextStage(stage)
    ran += 1
    saves.push({ stage, steps: [...steps] })     // **단계마다 저장한다**
  }
  return { saves, endedAt: stage }
}

const okStep = (key: FinishStep['key']): FinishStep[] => [{ key, status: 'done', detail: `${key} 됨` }]

test('★ 세 단계를 지나면 세 번 저장한다 — 마지막에 한 번 저장하면 끊길 때 통째로 잃는다', () => {
  const { saves, endedAt } = simulate({
    deadlineAfterStages: 99,
    stageResult: (s) => okStep(s === 'DIGEST' ? 'digest' : s === 'NOTE' ? 'note' : 'extract'),
  })
  assert.equal(saves.length, 3)
  assert.deepEqual(saves.map((s) => s.stage), ['NOTE', 'EXTRACT', 'DONE'])
  assert.equal(endedAt, 'DONE')
})

test('★ 예산이 떨어지면 거기까지가 남는다 — 오늘 사고에서는 아무것도 안 남았다', () => {
  const { saves, endedAt } = simulate({
    deadlineAfterStages: 1,                      // 정리까지만 돌 시간이 있었다
    stageResult: () => okStep('digest'),
  })
  assert.equal(saves.length, 1, '한 단계라도 돌았으면 그 결과가 저장돼야 한다')
  assert.equal(saves[0].stage, 'NOTE', '다음 회차는 다음 단계부터 이어간다')
  assert.notEqual(endedAt, 'DONE')
  assert.equal(saves[0].steps.length, 1, '정리 결과는 남는다')
})

test('★ 앞 단계가 넘어져도 다음으로 간다 — 하나가 넘어졌다고 전부를 잃지 않는다', () => {
  const { saves, endedAt } = simulate({
    deadlineAfterStages: 99,
    stageResult: (s) => s === 'DIGEST'
      ? [{ key: 'digest', status: 'failed', detail: '정리하지 못했어요.' }]
      : okStep(s === 'NOTE' ? 'note' : 'extract'),
  })
  assert.equal(endedAt, 'DONE', '정리가 실패해도 5축까지 간다')
  const last = saves[saves.length - 1].steps
  assert.equal(last.find((s) => s.key === 'digest')?.status, 'failed')
  assert.equal(last.find((s) => s.key === 'extract')?.status, 'done')
})

/*
  ── 정적 가드 ────────────────────────────────────────────────────────────────
*/

test('★ 끝내기 POST 는 잡만 만든다 — 여기서 AI 를 돌리면 다시 브라우저를 300초 붙잡는다', () => {
  const route = readFileSync('app/api/crm/meetings/[id]/finish/route.ts', 'utf-8')

  assert.match(route, /enqueueFinish/, '잡을 만들지 않는다')
  assert.doesNotMatch(route, /finishMeeting|runMeetingDigest|extractFiveAxis/,
    '끝내기 라우트가 아직 AI 를 직접 돌린다 — 그게 295초 사고의 모양이다')

  const maxDuration = Number(/maxDuration = (\d+)/.exec(route)?.[1])
  assert.ok(maxDuration > 0 && maxDuration <= 60,
    `잡 한 줄 적는 데 ${maxDuration}초를 잡아 뒀다 — 오래 걸릴 일이 여기 없어야 한다`)
})

test('★ 드레인은 단계마다 저장한다 — 마지막에 한 번 저장하면 끊길 때 통째로 잃는다', () => {
  const drain = readFileSync('lib/crm/jobs/finish-drain.ts', 'utf-8')
  const runOne = drain.slice(drain.indexOf('export async function runOneStage'))

  assert.match(runOne, /saveProgress/, '단계 결과를 저장하지 않는다')
  assert.match(drain, /deps\.deadlineMs/, '예산을 보지 않으면 시작해 놓고 잘린다')
  assert.match(drain, /mergeSteps/, '같은 단계를 다시 돌 때 결과가 두 줄로 뜬다')
})

test('★ 브라우저 입구에 서비스 토큰 이름이 없다 — 적어두면 언젠가 복사된다', () => {
  const route = readFileSync('app/api/crm/meetings/jobs/finish/route.ts', 'utf-8')

  // POST(브라우저)는 세션으로, GET(크론)은 machine-auth SSOT 로 판정한다
  assert.match(route, /withCrmApi/, '브라우저 입구가 세션을 안 본다')
  assert.match(route, /isMachineCall/, '크론 입구가 판정 SSOT 를 안 쓴다')

  // 토큰 이름이 등장해도 되는 곳은 「설정 안 됨」 안내 문구 하나뿐이다
  const codeOnly = route.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const mentions = codeOnly.match(/CRON_SECRET|CI_WORKER_TOKEN/g) ?? []
  assert.ok(mentions.length <= 2,
    `서비스 토큰 이름이 ${mentions.length}번 등장한다 — 브라우저로 내려보내는 길이 열린다`)
  assert.doesNotMatch(codeOnly, /process\.env\.(CRON_SECRET|CI_WORKER_TOKEN)/,
    '입구가 토큰을 직접 읽으면 machine-auth SSOT 가 두 벌이 된다')
})

test('★ 크론 백스톱이 실제로 등록돼 있다 — 만들고 안 부르면 없는 기능이다', () => {
  const vercel = JSON.parse(readFileSync('vercel.json', 'utf-8')) as {
    crons: { path: string; schedule: string }[]
  }
  const cron = vercel.crons.find((c) => c.path === '/api/crm/meetings/jobs/finish')
  assert.ok(cron, '화면을 닫으면 잡을 굴릴 것이 아무도 없다')
  assert.match(cron.schedule, /^\*\/\d+ /, '분 단위로 돌지 않으면 백스톱 구실을 못 한다')
})
