import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// 정적 가드 — datetime 정합성 우회 패턴을 소스에서 차단한다.
// (lib/datetime/kst.ts SSOT를 거치지 않고 naive datetime을 DB에 쓰거나, 서버에서 "오늘"을
//  toISOString().slice 로 산출하는 코드가 재유입되면 이 테스트가 실패한다.)
//
// 예외가 정말 필요하면 같은 줄에 `// kst-ok` 주석을 달면 통과한다(의식적 허용 표식).

// fileURLToPath로 디코딩 — .pathname은 비ASCII 경로(한글 등)를 퍼센트 인코딩으로 남겨
// readdirSync가 디렉터리를 못 찾아 스캔이 조용히 비게 된다.
const APP_ROOT = fileURLToPath(new URL('../../', import.meta.url)) // apps/web/

// datetime을 직접 만져 DB에 저장하는 표면들만 좁게 스캔(오탐 최소화).
const SCAN_DIRS = [
  'app/(member)/calendar',
  'app/(member)/dept-tasks',
  'app/(member)/meeting-notes',
  'app/api/calendar',
  'lib/calendar',
  'lib/meeting',
]

const FORBIDDEN: { re: RegExp; why: string }[] = [
  { re: /T\$\{[^`\n]+\}:00`/, why: 'naive datetime 템플릿(`...T${time}:00`) — kstWallToIso() 사용' },
  { re: /T00:00:00`/, why: 'naive 자정 datetime(`...T00:00:00`) — kstDateOnlyToIso() 사용' },
  { re: /toISOString\(\)\s*\.\s*slice\(\s*0\s*,\s*10\s*\)/, why: 'UTC "오늘" 산출 — kstTodayKey() 사용' },
]

function walk(dir: string, acc: string[]) {
  let entries: string[]
  try { entries = readdirSync(dir) } catch { return }
  for (const name of entries) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) { walk(full, acc); continue }
    if (!/\.(ts|tsx)$/.test(name)) continue
    if (name.endsWith('.test.ts') || name.endsWith('.test.tsx')) continue
    acc.push(full)
  }
}

test('정적 가드: 스캔 대상 파일에 naive datetime 우회 패턴이 없다', () => {
  const files: string[] = []
  for (const d of SCAN_DIRS) walk(join(APP_ROOT, d), files)
  assert.ok(files.length > 0, '스캔 대상 파일을 찾지 못함 — 경로 확인 필요')

  const violations: string[] = []
  for (const file of files) {
    const lines = readFileSync(file, 'utf8').split('\n')
    lines.forEach((line, i) => {
      if (line.includes('// kst-ok')) return
      for (const { re, why } of FORBIDDEN) {
        if (re.test(line)) {
          violations.push(`${file.replace(APP_ROOT, '')}:${i + 1} — ${why}\n    ${line.trim()}`)
        }
      }
    })
  }

  assert.equal(
    violations.length,
    0,
    `datetime 정합성 위반 ${violations.length}건:\n${violations.join('\n')}`,
  )
})
