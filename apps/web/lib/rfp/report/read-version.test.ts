/**
 * 저장된 리포트를 읽는 한 자리가 실제로 사다리를 지나는지 본다
 *
 * **왜**: 읽는 곳이 여섯이라 각자 사다리를 부르면 한 곳만 빠지는 날이 온다.
 * 그 화면은 멀쩡해 보이고 값만 조금 다르다 — 아무도 못 알아챈다.
 * 그래서 ①한 함수만 지나는지 ②못 올린 값이 안 사라지는지 둘을 본다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AI_CONTRACT_VERSION } from '@ax/ai-core'
import { readStoredReport, REPORT_VERSION_COLUMNS } from './read-version.ts'

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

const REPORT = { overview: { title: { value: '사업 하나' } } }

test('행이 없으면 null 이다', () => {
  assert.equal(readStoredReport(null), null)
  assert.equal(readStoredReport(undefined), null)
  assert.equal(readStoredReport({ report: null }), null)
})

test('지금 판으로 저장된 것은 그대로 읽힌다', () => {
  const r = readStoredReport({ report: REPORT, contract_version: AI_CONTRACT_VERSION })
  assert.ok(r)
  assert.equal(r.current, true)
  assert.equal(r.note, null)
  assert.equal(r.storedVersion, AI_CONTRACT_VERSION)
})

test('판 번호 없는 옛 행도 값이 그대로 나온다, 사라지지 않는다', () => {
  const r = readStoredReport({ report: REPORT })
  assert.ok(r)
  assert.equal(r.report, REPORT, '원문 그대로여야 한다')
  assert.equal(r.current, false)
  assert.equal(r.storedVersion, null)
  assert.ok(r.note && r.note.length > 0, '왜 이렇게 보이는지 한 줄이 있어야 한다')
})

test('더 새 배포가 쓴 값도 사라지지 않고 다른 말을 붙인다', () => {
  const older = readStoredReport({ report: REPORT })
  const newer = readStoredReport({ report: REPORT, contract_version: AI_CONTRACT_VERSION + 5 })
  assert.ok(older && newer)
  assert.equal(newer.report, REPORT)
  assert.equal(newer.current, false)
  assert.notEqual(newer.note, older.note, '옛 값과 새 값에 같은 말을 붙이면 둘을 구분 못 한다')
})

test('화면에 적는 말을 이 파일이 직접 쓰지 않는다', () => {
  const src = readFileSync(join(WEB, 'lib/rfp/report/read-version.ts'), 'utf8')
  assert.match(src, /terms\/index\.ts|@\/lib\/terms/, '용어집을 안 지난다')
  const korean = src.split('\n')
    .filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//') && !l.trim().startsWith('/*'))
    .filter((l) => /['"`][^'"`]*[가-힣][^'"`]*['"`]/.test(l))
  assert.deepEqual(korean, [], `한글 문자열을 직접 들고 있다:\n${korean.join('\n')}`)
})

test('★ 리포트 원본을 읽는 곳이 전부 이 함수를 지난다', () => {
  const hits: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name === '.next' || name.startsWith('.next-')) continue
      const full = join(dir, name)
      if (statSync(full).isDirectory()) { walk(full); continue }
      if (!name.endsWith('.ts') && !name.endsWith('.tsx')) continue
      if (name.endsWith('.test.ts')) continue
      const src = readFileSync(full, 'utf8')
      if (!src.includes("from('rfp_report_versions')")) continue
      // 최신 판 번호만 찾는 조회는 값을 안 읽으므로 사다리가 필요 없다
      if (!/\breport\b/.test(src.slice(src.indexOf("from('rfp_report_versions')"), src.indexOf("from('rfp_report_versions')") + 260))) continue
      // import 줄만 있고 안 부르는 것을 통과시키면 안 된다. 실제 호출을 센다
      const called = src.split('\n')
        .filter((l) => !l.trim().startsWith('import'))
        .some((l) => l.includes('readStoredReport('))
      if (!called) hits.push(full.slice(WEB.length + 1))
    }
  }
  walk(join(WEB, 'app'))
  walk(join(WEB, 'lib'))
  assert.deepEqual(hits, [], [
    '리포트 원본을 읽으면서 사다리를 안 지나는 곳이 있다.',
    '그 화면만 옛 판을 새 판인 척 읽고, 값이 조금 다를 뿐이라 아무도 못 알아챈다:',
    ...hits.map((h) => `  ${h}`),
  ].join('\n'))
})

test('읽는 곳이 판 번호 칸을 select 에 넣는다', () => {
  assert.match(REPORT_VERSION_COLUMNS, /contract_version/)
})
