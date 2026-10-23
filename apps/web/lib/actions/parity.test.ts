/**
 * 웹=CLI: 대응표 모든 줄에서 CLI 명령이 웹과 같은 처리 함수를 가리킨다 (P0158 I13)
 *
 * CLI 명령 → 공개 경로(x-cli, 생성 스펙) → 관문 표 한 줄(MOUNTED) → 화면이 부르는 그 모듈의 그 export
 * 표의 모듈 번호가 엉뚱한 파일을 가리키거나 export 이름이 틀리면 CLI 는 다른 함수를 부르거나 501 이 된다
 * 실DB 로 같은 입력 → 같은 저장 결과를 보는 CRM 8명령 시험은 마이그레이션 318 이 있는 시험 DB 가 있을 때만 (지금 없음)
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MOUNTED } from './generated/table.ts'

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const TABLE = readFileSync(join(WEB, 'lib', 'actions', 'generated', 'table.ts'), 'utf8')
const SPEC = JSON.parse(readFileSync(join(WEB, 'lib', 'actions', 'generated', 'openapi.json'), 'utf8'))
const MODULE_PATHS = [...TABLE.slice(TABLE.indexOf('export const MODULES'), TABLE.indexOf('export const MOUNTED'))
  .matchAll(/import\('@\/([^']+)'\)/g)].map((m) => m[1])

function fileOf(modulePath: string): string | null {
  for (const ext of ['.ts', '.tsx']) {
    const f = join(WEB, modulePath + ext)
    if (existsSync(f)) return f
  }
  return null
}

/** /api/crm/deals/{id} 를 실제 라우트 파일 자리와 맞춘다, 묶음 폴더 (x) 는 주소에 안 나온다 */
function routeDirMatches(modulePath: string, internal: string): boolean {
  const dir = modulePath.replace(/\/route$/, '').split('/').filter((s) => !/^\(.+\)$/.test(s))
    .map((s) => s.replace(/^\[\.\.\.(.+)\]$/, '{$1*}').replace(/^\[(.+)\]$/, '{$1}'))
  return '/' + dir.slice(1).join('/') === internal
}

function exportsName(src: string, name: string): boolean {
  return new RegExp(`export\\s+(?:async\\s+)?(?:function|const)\\s+${name}\\b|export\\s*\\{[^}]*\\b${name}\\b[^}]*\\}`).test(src)
}

test('★ 모든 줄의 처리 함수가 화면이 쓰는 그 파일의 그 export 다', () => {
  assert.ok(MOUNTED.length > 700)
  const wrong: string[] = []
  for (const op of MOUNTED) {
    const modulePath = MODULE_PATHS[op.module]
    const file = modulePath ? fileOf(modulePath) : null
    if (!file) { wrong.push(`${op.name}: 모듈 ${op.module} 파일 없음`); continue }
    if (op.kind === 'route') {
      if (!routeDirMatches(modulePath, op.internal)) wrong.push(`${op.name}: ${modulePath} 는 ${op.internal} 가 아님`)
    } else {
      const [actionFile, fn] = op.internal.split('#')
      if (!file.endsWith(actionFile) || fn !== op.exported) wrong.push(`${op.name}: ${modulePath} 는 ${op.internal} 가 아님`)
    }
    if (!exportsName(readFileSync(file, 'utf8'), op.exported)) wrong.push(`${op.name}: ${op.exported} export 없음`)
  }
  assert.deepEqual(wrong, [])
})

test('★ 모든 CLI 명령이 공개 경로 하나를 가리키고, 그 경로는 관문 표나 손으로 쓴 공개 라우트가 받는다', () => {
  const mounted = new Set(MOUNTED.map((o) => `${o.method} ${o.mount.replace(/\{(\w+)\*\}/g, '{$1}')}`))
  const seen = new Map<string, string>()
  const orphan: string[] = []
  for (const [p, item] of Object.entries(SPEC.paths as Record<string, Record<string, Record<string, unknown>>>)) {
    for (const [m, op] of Object.entries(item)) {
      const cli = op['x-cli'] as string | undefined
      if (!cli) continue
      assert.ok(!seen.has(cli), `같은 CLI 명령이 둘: ${cli}`)
      seen.set(cli, `${m} ${p}`)
      const key = `${m.toUpperCase()} ${p}`
      if (mounted.has(key)) continue
      const dir = join(WEB, 'app', 'api', 'public', 'v1', ...p.split('/').filter(Boolean).map((s) => s.replace(/^\{(\w+)\}$/, '[$1]')))
      const file = join(dir, 'route.ts')
      if (!existsSync(file) || !exportsName(readFileSync(file, 'utf8'), m.toUpperCase())) orphan.push(`${cli} -> ${key}`)
    }
  }
  assert.ok(seen.size >= MOUNTED.length)
  assert.deepEqual(orphan, [])
})
