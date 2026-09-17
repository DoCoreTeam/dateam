import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 사람을 고르는 자리는 퇴사자를 빼야 한다 — 정적 가드
 *
 * **왜 손목록이 아니라 훑기인가**: 고르는 자리는 앞으로도 늘어난다. 목록을 손으로 들면
 * 새로 생긴 자리는 아무도 모르게 빠진다(실측: 지금도 여덟 곳인데 처음 셀 땐 넷으로 봤다).
 *
 * **무엇을 고르는 자리로 보나**: `profiles` 를 읽으면서 id 와 name 을 함께 고르고,
 * 한 사람으로 좁히지 않은 질의(`.eq('id')`·`.in('id')`·`.single()` 없음).
 * 좁힌 질의는 **이미 있는 기록의 이름을 찾는 것**이라 퇴사자를 빼면 지난 기록의 이름이 사라진다.
 *
 * 걸린 자리는 둘 중 하나여야 한다.
 *   ① `@/lib/members/resigned-server` 를 쓴다 (거른다)
 *   ② 「이름을 찾는 표시용」이라고 파일에 밝힌다 (안 거른다, 그 이유를 적는다)
 */

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
const SCAN_DIRS = ['app', 'lib']
const SKIP = ['node_modules', '.next', 'e2e']
const OPT_OUT = '이름을 찾는 표시용'
const FILTER = 'resigned-server'

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP.includes(name)) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.tsx?$/.test(name) && !name.endsWith('.test.ts')) out.push(full)
  }
  return out
}

interface Hit { file: string; line: number }

function findPickerQueries(): Hit[] {
  const hits: Hit[] = []
  for (const dir of SCAN_DIRS) {
    for (const file of walk(join(ROOT, dir))) {
      const text = readFileSync(file, 'utf8')
      if (!text.includes("from('profiles')")) continue
      const re = /from\(['"]profiles['"]\)([\s\S]{0,260})/g
      let m: RegExpExecArray | null
      while ((m = re.exec(text)) !== null) {
        const seg = m[1]
        const sel = /\.select\(\s*['"]([^'"]*)['"]/.exec(seg)
        if (!sel) continue
        const cols = sel[1]
        if (!cols.includes('id') || !cols.includes('name')) continue
        const after = seg.slice(sel.index + sel[0].length, sel.index + sel[0].length + 200)
        if (/\.eq\(['"]id['"]|\.in\(['"]id['"]|\.single\(\)|\.maybeSingle\(\)/.test(after)) continue
        hits.push({ file: relative(ROOT, file), line: text.slice(0, m.index).split('\n').length })
      }
    }
  }
  return hits
}

test('profiles 를 통째로 읽는 자리는 퇴사자를 거르거나 표시용이라고 밝힌다', () => {
  const hits = findPickerQueries()
  // 가드가 아무것도 못 찾으면 통과처럼 보인다 — 찾는 것이 있는지부터 단정한다
  assert.ok(hits.length >= 6, `고르는 자리를 ${hits.length}곳밖에 못 찾았다, 훑기가 망가졌는지 본다`)

  const bad: string[] = []
  for (const h of hits) {
    const text = readFileSync(join(ROOT, h.file), 'utf8')
    if (text.includes(FILTER) || text.includes(OPT_OUT)) continue
    bad.push(`${h.file}:${h.line}`)
  }
  assert.deepEqual(bad, [], `퇴사자를 안 거르는 자리: ${bad.join(', ')}`)
})

test('거르개를 쓰는 자리와 표시용이라 밝힌 자리가 둘 다 있다', () => {
  const hits = findPickerQueries()
  const files = [...new Set(hits.map((h) => h.file))]
  const filtered = files.filter((f) => readFileSync(join(ROOT, f), 'utf8').includes(FILTER))
  const declared = files.filter((f) => readFileSync(join(ROOT, f), 'utf8').includes(OPT_OUT))
  // 전부 거르거나 전부 표시용이면 둘 중 한 갈래를 실수로 지운 것이다
  assert.ok(filtered.length >= 5, `거르는 자리가 ${filtered.length}곳뿐`)
  assert.ok(declared.length >= 1, `표시용이라 밝힌 자리가 ${declared.length}곳뿐`)
})
