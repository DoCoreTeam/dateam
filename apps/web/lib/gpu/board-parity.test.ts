// 웹=CLI: 화면과 teamda gpu board list 가 같은 창구, 같은 계산을 지난다
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { GPU_DEFS } from '../actions/defs/gpu.ts'

const root = path.resolve(import.meta.dirname, '../..')
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8')

test('정의 한 줄이 창구와 CLI 이름을 잇는다', () => {
  const def = GPU_DEFS.find((d) => d.name === 'gpu.board.list')
  assert.ok(def)
  assert.equal(def.op, 'GET /api/pricing/gpu/board')
  assert.equal(def.cli, 'gpu board list')
  assert.equal(def.scope, 'read')
})

test('창구는 사람 확인 뒤 getGpuBoard 를 부르고, getGpuBoard 는 buildBoard 를 부른다', () => {
  const route = read('app/api/pricing/gpu/board/route.ts')
  assert.match(route, /await requireMemberApi\(\)/)
  assert.match(route, /getGpuBoard\(supabase\)/)
  assert.doesNotMatch(route, /createAdminClient/)
  const data = read('lib/gpu/board-data.ts')
  assert.match(data, /return buildBoard\(\{/)
})
