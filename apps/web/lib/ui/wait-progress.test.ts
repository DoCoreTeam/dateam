/**
 * 일반형 대기 문구 — 45초·120초 분기는 브라우저로 밟기 어려워 여기서 재현한다
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { waitProgress } from './wait-progress.ts'
import { WAIT, WAIT_START, WAIT_LONG, WAIT_VERY_LONG } from '../terms/wait.ts'

test('첫 몇 초는 시작했다고만 한다', () => {
  const v = waitProgress(800, WAIT.mailSync)
  assert.equal(v.message, WAIT_START)
  assert.equal(v.elapsedLabel, null)
})

test('★ 그 뒤로는 무엇을 하는 중인지와 얼마나 지났는지를 함께 말한다', () => {
  const v = waitProgress(9_000, WAIT.mailSync)
  assert.equal(v.message, WAIT.mailSync)
  assert.equal(v.elapsedLabel, '9초')
  assert.equal(v.reassure, null)
})

test('★ 45초를 넘으면 오래 걸린다고 밝히고, 120초를 넘으면 곧 끝난다고 말한다', () => {
  assert.equal(waitProgress(44_000, WAIT.mailSync).reassure, null)
  assert.equal(waitProgress(45_000, WAIT.mailSync).reassure, WAIT_LONG)
  assert.equal(waitProgress(120_000, WAIT.mailSync).reassure, WAIT_VERY_LONG)
})

test('★ 문턱과 경과 표기를 새로 정하지 않는다 — 회의노트 모듈에 위임한다', () => {
  const src = readFileSync(new URL('./wait-progress.ts', import.meta.url), 'utf8')
  assert.match(src, /from '\.\.\/meeting\/digest-progress\.ts'/)
  assert.ok(!/45_?000|120_?000/.test(src.replace(/\/\*[\s\S]*?\*\//g, '')),
    '문턱 숫자를 이 파일이 또 적고 있다')
})

test('★ 하는 일 문장은 무엇을 하는지 말한다 — 「처리 중」 같은 말은 안 쓴다', () => {
  const vague = ['처리', '진행', '작업', '로딩']
  for (const [key, line] of Object.entries(WAIT)) {
    assert.ok(line.length > 6, `${key} 가 너무 짧다: ${line}`)
    for (const v of vague) {
      assert.ok(!line.includes(v), `${key} 가 아무것도 안 알려 주는 말을 쓴다: ${line}`)
    }
  }
})
