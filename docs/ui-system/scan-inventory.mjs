#!/usr/bin/env node
// UI 부품 인벤토리 실측 — INVENTORY.md의 숫자를 재현한다.
//
//   node docs/ui-system/scan-inventory.mjs            # 사용량 표
//   node docs/ui-system/scan-inventory.mjs --dupes    # 중복(같은 이름 2곳) 만
//   node docs/ui-system/scan-inventory.mjs --dead     # 사용 0건만
//
// ⚠️ 반드시 **export 이름** 기준으로 센다. 파일명으로 세면
//    LoadingSkeleton.tsx(→SkelPage/SkelCard/SkelList, 27건 사용)가 0건으로 오판된다.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, basename, relative, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'apps', 'web')

function walk(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) walk(p, acc)
    else if (/\.tsx?$/.test(entry)) acc.push(p)
  }
  return acc
}

const sources = [...walk(join(WEB, 'app')), ...walk(join(WEB, 'components'))]
const bodies = new Map(sources.map((f) => [f, readFileSync(f, 'utf8')]))

/** 한 파일이 export 하는 컴포넌트 이름들 (PascalCase만) */
function exportedNames(file, src) {
  const names = new Set()
  for (const m of src.matchAll(/^export\s+(?:default\s+)?(?:async\s+)?function\s+([A-Z]\w*)/gm)) names.add(m[1])
  for (const m of src.matchAll(/^export\s+const\s+([A-Z]\w*)/gm)) names.add(m[1])
  if (names.size === 0 || /^export default function\s*\(/m.test(src)) names.add(basename(file, '.tsx'))
  return names
}

const rows = []
for (const file of walk(join(WEB, 'components')).filter((f) => f.endsWith('.tsx'))) {
  for (const name of exportedNames(file, bodies.get(file))) {
    const re = new RegExp(`<${name}(?![A-Za-z0-9_])`, 'g')
    let uses = 0
    const callers = new Set()
    for (const [other, body] of bodies) {
      if (other === file) continue
      const hits = body.match(re)
      if (hits) { uses += hits.length; callers.add(relative(WEB, other)) }
    }
    rows.push({ name, path: relative(WEB, file), uses, callers: callers.size })
  }
}

const byName = new Map()
for (const r of rows) (byName.get(r.name) ?? byName.set(r.name, []).get(r.name)).push(r)

const arg = process.argv[2]

if (arg === '--dupes') {
  console.log('=== 같은 이름을 2곳 이상이 export (중복 구현) ===')
  for (const [name, list] of byName) {
    if (list.length > 1) console.log(' ', name, '→', list.map((r) => `${r.path}(${r.uses})`).join('  |  '))
  }
} else if (arg === '--dead') {
  console.log('=== 사용 0건 ===')
  for (const r of rows.filter((r) => r.uses === 0).sort((a, b) => a.path.localeCompare(b.path))) {
    console.log('  ', r.name.padEnd(28), r.path)
  }
} else {
  console.log('USES  FILES  SYMBOL                        PATH')
  for (const r of rows.sort((a, b) => b.uses - a.uses || a.path.localeCompare(b.path))) {
    console.log(String(r.uses).padStart(4), String(r.callers).padStart(6), ' ', r.name.padEnd(28), r.path)
  }
  const dead = rows.filter((r) => r.uses === 0).length
  console.log(`\n총 export 심볼 ${rows.length} · 미사용 ${dead} · 컴포넌트 파일 ${new Set(rows.map((r) => r.path)).size}`)
}
