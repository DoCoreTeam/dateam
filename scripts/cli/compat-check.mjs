#!/usr/bin/env node
// 공개 API 하위 호환 검사 (P0158 I12)
// 기준 커밋의 생성 스펙에 있던 경로와 메서드, 그 CLI 명령이 지금 스펙에서 빠지면 실패한다
// 기준은 BASE_REF (기본 origin/main), 기준에 생성 스펙이 없으면 처음 들어오는 것이라 통과
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const SPEC = 'apps/web/lib/actions/generated/openapi.json'

export function operationsOf(spec) {
  const out = new Map()
  for (const [p, item] of Object.entries(spec?.paths ?? {})) {
    for (const [m, op] of Object.entries(item ?? {})) out.set(`${m.toUpperCase()} ${p}`, op?.['x-cli'] ?? null)
  }
  return out
}

/** 기준에 있던 동작 중 빠졌거나 CLI 명령 이름이 바뀐 것 */
export function breaking(base, cur) {
  const a = operationsOf(base)
  const b = operationsOf(cur)
  const out = []
  for (const [k, cli] of a) {
    if (!b.has(k)) out.push(`빠짐: ${k}`)
    else if (cli && b.get(k) !== cli) out.push(`명령 바뀜: ${k} ${cli} -> ${b.get(k)}`)
  }
  return out
}

function baseSpec(ref) {
  try {
    return JSON.parse(execFileSync('git', ['show', `${ref}:${SPEC}`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }))
  } catch {
    return null
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const ref = process.env.BASE_REF || 'origin/main'
  const base = baseSpec(ref)
  if (!base) {
    process.stderr.write(`[cli-compat] ${ref} 에 생성 스펙이 없음, 처음 들어오는 것이라 통과\n`)
    process.exit(0)
  }
  const cur = JSON.parse(fs.readFileSync(path.join(ROOT, SPEC), 'utf8'))
  const bad = breaking(base, cur)
  if (bad.length) {
    process.stderr.write(`[cli-compat] 하위 호환 깨짐 ${bad.length}건 (기준 ${ref})\n${bad.slice(0, 50).map((l) => `  - ${l}`).join('\n')}\n`)
    process.exit(1)
  }
  process.stderr.write(`[cli-compat] 통과, 기준 ${ref} 의 동작 ${operationsOf(base).size}개가 모두 남아 있음\n`)
}
