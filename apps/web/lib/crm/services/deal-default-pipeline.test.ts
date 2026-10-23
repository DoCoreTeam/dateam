/**
 * 파이프라인을 안 보내도 딜이 만들어진다
 *
 * **왜** (실측 2026-10-23)
 *
 *   teamda CLI 가 `POST /api/crm/deals` 에 pipelineId 없이 보내자
 *   「그 단계는 선택한 파이프라인에 속하지 않습니다」 400 이 났다.
 *   딜 만들기 창은 기본 파이프라인(defaultPipelineId)과 첫 열린 단계를 미리 채워 보내서 몰랐다.
 *
 * DB 없이 돌리려고 가짜 tx 가 받은 조건을 실제 가드(injectWorkspaceFilter)에 지나게 한 뒤
 * 가짜 행에 대 본다. 그래야 다른 워크스페이스와 삭제된 파이프라인이 걸러지는지도 함께 본다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { resolveDealStart } from './deal-start.ts'
import { injectWorkspaceFilter } from '../db/workspace-guard.ts'

const WS = 'ws-1'
const ROOT = join(import.meta.dirname, '..', '..', '..')

type Stage = { id: string; pipelineId: string; kind: string; position: number }
type Pipeline = {
  id: string; workspaceId: string; name: string; isDefault: boolean; isActive: boolean
  position: number; deletedAt: Date | null
}

const PIPELINES: Pipeline[] = [
  { id: 'p-a', workspaceId: WS, name: 'A', isDefault: false, isActive: true, position: 0, deletedAt: null },
  { id: 'p-b', workspaceId: WS, name: 'B', isDefault: true, isActive: true, position: 1, deletedAt: null },
  // 지운 기본 파이프라인 — 가드가 걸러야 한다
  { id: 'p-gone', workspaceId: WS, name: 'G', isDefault: true, isActive: true, position: -1, deletedAt: new Date() },
  // 남의 워크스페이스 기본 파이프라인
  { id: 'p-x', workspaceId: 'ws-2', name: 'X', isDefault: true, isActive: true, position: -2, deletedAt: null },
]

const STAGES: Stage[] = [
  { id: 'a-won', pipelineId: 'p-a', kind: 'WON', position: 0 },
  { id: 'a1', pipelineId: 'p-a', kind: 'OPEN', position: 1 },
  { id: 'b-won', pipelineId: 'p-b', kind: 'WON', position: 0 },
  { id: 'b2', pipelineId: 'p-b', kind: 'OPEN', position: 2 },
  { id: 'b1', pipelineId: 'p-b', kind: 'OPEN', position: 1 },
  { id: 'g1', pipelineId: 'p-gone', kind: 'OPEN', position: 0 },
  { id: 'x1', pipelineId: 'p-x', kind: 'OPEN', position: 0 },
]

/** 가드를 지난 where 가 파이프라인 행에 걸리는가. 여기서 쓰는 꼴(값 일치, null, stages.some.id)만 안다 */
function matches(where: Record<string, unknown>, row: Pipeline): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (key === 'stages') {
      const id = (cond as { some: { id: string } }).some.id
      return STAGES.some((s) => s.pipelineId === row.id && s.id === id)
    }
    const value = (row as Record<string, unknown>)[key]
    if (cond === null) return value === null
    if (cond && typeof cond === 'object') throw new Error(`이 시험이 모르는 조건: ${key}`)
    return value === cond
  })
}

function withStages(p: Pipeline) {
  return { ...p, stages: STAGES.filter((s) => s.pipelineId === p.id) }
}

function guarded(args: unknown, op: string): Record<string, unknown> {
  const out = injectWorkspaceFilter(args, WS, op, 'CrmPipeline') as { where: Record<string, unknown> }
  return out.where
}

const tx = {
  crmPipeline: {
    findMany: async (args: unknown) => PIPELINES.filter((p) => matches(guarded(args, 'findMany'), p)).map(withStages),
    findFirst: async (args: unknown) => {
      const hit = PIPELINES.find((p) => matches(guarded(args, 'findFirst'), p))
      return hit ? withStages(hit) : null
    },
  },
  crmStage: {
    findFirst: async (args: { where: { id: string } }) => STAGES.find((s) => s.id === args.where.id) ?? null,
  },
}

test('둘 다 비우면 기본 파이프라인의 첫 열린 단계로 들어간다', async () => {
  assert.deepEqual(await resolveDealStart(tx, {}), { pipelineId: 'p-b', stageId: 'b1' })
  assert.deepEqual(await resolveDealStart(tx, { pipelineId: '', stageId: null }), { pipelineId: 'p-b', stageId: 'b1' })
})

test('단계만 주면 그 단계의 파이프라인으로 들어간다', async () => {
  assert.deepEqual(await resolveDealStart(tx, { stageId: 'a1' }), { pipelineId: 'p-a', stageId: 'a1' })
})

test('파이프라인만 주면 그 파이프라인의 첫 열린 단계로 들어간다', async () => {
  assert.deepEqual(await resolveDealStart(tx, { pipelineId: 'p-a' }), { pipelineId: 'p-a', stageId: 'a1' })
})

test('둘이 어긋나면 같은 말로 거절한다', async () => {
  await assert.rejects(resolveDealStart(tx, { pipelineId: 'p-a', stageId: 'b1' }), {
    message: '그 단계는 선택한 파이프라인에 속하지 않습니다.',
  })
  assert.deepEqual(await resolveDealStart(tx, { pipelineId: 'p-b', stageId: 'b2' }), { pipelineId: 'p-b', stageId: 'b2' })
})

test('남의 워크스페이스 단계와 파이프라인은 찾지 않는다', async () => {
  await assert.rejects(resolveDealStart(tx, { stageId: 'x1' }), { message: '단계를 찾을 수 없습니다.' })
  await assert.rejects(resolveDealStart(tx, { pipelineId: 'p-x' }), { message: '파이프라인을 찾을 수 없습니다.' })
  await assert.rejects(resolveDealStart(tx, { stageId: 'g1' }), { message: '단계를 찾을 수 없습니다.' })
})

test('createDeal 은 정한 파이프라인과 단계를 딜과 첫 이력에 쓴다', () => {
  const src = readFileSync(join(ROOT, 'lib/crm/services/deal.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
  const start = src.indexOf('export async function createDeal(')
  assert.ok(start >= 0, 'createDeal 이 없다')
  const body = src.slice(start, src.indexOf('\nexport ', start + 1))
  assert.match(body, /const start = await resolveDealStart\(tx, input\)/, '기본값을 안 채운다')
  assert.match(body, /data:\s*\{\s*\.\.\.data,\s*\.\.\.start\s*\}/, '정한 값을 딜에 안 쓴다')
  assert.match(body, /toStageId:\s*start\.stageId/, '첫 이력이 정한 단계를 안 쓴다')
})
