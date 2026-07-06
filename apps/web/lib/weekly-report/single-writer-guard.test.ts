import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// 정적 가드 — 주간보고 확정본(weekly_reports) "단일 Writer" 원칙을 소스에서 강제한다.
// (마이그144/유실0: 확정본에 쓰는 유일 경로 = weekly-report/actions.ts. draft/route.ts 등이
//  replace_weekly_report RPC나 파괴적 write를 다시 호출하면 과거 유실 경로(이도현 06-29)가
//  재유입되므로 이 테스트가 실패한다. 정당한 예외는 화이트리스트에 추가.)

const APP_ROOT = fileURLToPath(new URL('../../', import.meta.url)) // apps/web/

// 확정본 writer로 허용된 파일(경로 접미사 매칭).
const ALLOWED_WRITERS = ['app/(member)/weekly-report/actions.ts']

const SCAN_DIRS = ['app', 'lib']

// 확정본을 변경하는 신호: replace_weekly_report RPC 호출 + weekly_reports 파괴적 write.
const WRITE_SIGNALS: { re: RegExp; why: string }[] = [
  { re: /rpc\(\s*['"]replace_weekly_report['"]/, why: "rpc('replace_weekly_report') 호출" },
]
// weekly_reports 테이블에 대한 파괴적 write는 from('weekly_reports') 와 .delete/.insert/.upsert/.update가
// 서로 다른 줄에 걸쳐 나올 수 있어 파일 단위로 동시 등장 여부를 본다.
const TABLE_RE = /from\(\s*['"]weekly_reports['"]\s*\)/
const DESTRUCTIVE_RE = /\.\s*(delete|insert|upsert|update)\s*\(/

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

function isAllowed(file: string): boolean {
  const rel = file.slice(APP_ROOT.length)
  return ALLOWED_WRITERS.some((w) => rel === w || rel.endsWith(w))
}

test('단일 Writer 가드: 화이트리스트 외 파일이 확정본(weekly_reports)에 쓰지 않는다', () => {
  const files: string[] = []
  for (const d of SCAN_DIRS) walk(join(APP_ROOT, d), files)
  assert.ok(files.length > 0, '스캔 파일이 0개 — 경로 인코딩 확인')

  const violations: string[] = []
  for (const file of files) {
    if (isAllowed(file)) continue
    const src = readFileSync(file, 'utf8')

    for (const { re, why } of WRITE_SIGNALS) {
      if (re.test(src)) violations.push(`${file.slice(APP_ROOT.length)} — ${why}`)
    }
    // 파괴적 write: 테이블 참조 + 파괴 동사가 같은 파일에 공존할 때만 위반으로 본다(읽기 전용은 통과).
    if (TABLE_RE.test(src)) {
      const lines = src.split('\n')
      for (let i = 0; i < lines.length; i++) {
        if (!TABLE_RE.test(lines[i])) continue
        // from('weekly_reports') 줄 또는 바로 다음 2줄 안에 파괴 동사가 오면 write로 간주.
        const window = [lines[i], lines[i + 1] ?? '', lines[i + 2] ?? ''].join('\n')
        if (DESTRUCTIVE_RE.test(window)) {
          violations.push(`${file.slice(APP_ROOT.length)}:${i + 1} — weekly_reports 파괴적 write`)
        }
      }
    }
  }

  assert.deepEqual(
    violations,
    [],
    `확정본 writer는 ${ALLOWED_WRITERS.join(', ')} 하나여야 함. 위반:\n${violations.join('\n')}`
  )
})
