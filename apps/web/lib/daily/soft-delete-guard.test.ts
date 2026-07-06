import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// 정적 가드 — daily_logs 소프트삭제(deleted_at) 전환 이후, 신규/회귀 조회가 다시
// 삭제분을 노출하지 않도록 막는다.
// (daily_logs.deleted_at 은 146 마이그에서 추가됐고, deleteDailyLog/deleteLogGroup/deleteDeptTask는
//  하드 delete() 대신 deleted_at=now() UPDATE로 전환됐다. RLS가 deleted_at을 자동 필터하지 않으므로
//  from('daily_logs')로 SELECT하는 모든 경로가 .is('deleted_at', null)(또는 동등 필터)를 직접 걸어야
//  한다 — 누락되면 "삭제한 업무가 다시 보임" 회귀가 재발한다.)
//
// 스캔 방식: from('daily_logs') 등장 지점마다 다음 N줄을 윈도우로 보고,
//  - 윈도우 안에 .select(가 있고
//  - 윈도우 안에 .insert(/.update(/.delete(가 전혀 없으면(순수 read 체인)
//  - deleted_at 필터(또는 `// soft-delete-ok` 예외 주석)가 같은 윈도우에 없으면 위반으로 본다.
// insert/update/delete가 섞인 체인(쓰기 후 .select() 반환 등)은 이 가드의 범위 밖이다(별도 리뷰 대상).

const APP_ROOT = fileURLToPath(new URL('../../', import.meta.url)) // apps/web/
const SCAN_DIRS = ['app', 'lib']

const FROM_RE = /from\(\s*['"]daily_logs['"]\s*\)/
const SELECT_RE = /\.\s*select\s*\(/
const MUTATE_RE = /\.\s*(insert|update|delete)\s*\(/
const DELETED_AT_RE = /deleted_at/
const EXCEPTION_RE = /soft-delete-ok/

const WINDOW_LINES = 15 // from() 등장 줄부터 이만큼을 한 "쿼리 체인"으로 간주(오탐 최소화용 상한)

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

test('정적 가드: daily_logs 순수 조회는 deleted_at 필터(또는 soft-delete-ok 예외)를 갖는다', () => {
  const files: string[] = []
  for (const d of SCAN_DIRS) walk(join(APP_ROOT, d), files)
  assert.ok(files.length > 0, '스캔 대상 파일을 찾지 못함 — 경로 확인 필요')

  const violations: string[] = []

  for (const file of files) {
    const src = readFileSync(file, 'utf8')
    if (!FROM_RE.test(src)) continue
    const lines = src.split('\n')

    for (let i = 0; i < lines.length; i++) {
      if (!FROM_RE.test(lines[i])) continue

      const windowLines = lines.slice(i, i + WINDOW_LINES)
      const window = windowLines.join('\n')

      if (!SELECT_RE.test(window)) continue        // select가 없는 순수 write(insert만 등) — 범위 밖
      if (MUTATE_RE.test(window)) continue          // insert/update/delete 동반 체인 — 이 가드 범위 밖
      if (DELETED_AT_RE.test(window)) continue      // 필터 있음 — 통과
      if (EXCEPTION_RE.test(window)) continue        // 의식적 예외 처리 표식

      violations.push(
        `${file.slice(APP_ROOT.length)}:${i + 1} — daily_logs 조회에 deleted_at 필터 없음\n    ${lines[i].trim()}`,
      )
    }
  }

  assert.equal(
    violations.length,
    0,
    `daily_logs 소프트삭제 필터 누락 ${violations.length}건 (삭제분이 화면에 재노출될 수 있음):\n${violations.join('\n')}`,
  )
})
