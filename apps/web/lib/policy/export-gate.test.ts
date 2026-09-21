/**
 * 값이 파일로 나가는 창구는 **내보내기 판정을 지난다** (LOOP.md 7절 S2 · I10)
 *
 * **왜**: 접근권한이 화면만 여닫으면 반쪽이다. 읽으라고 열어 준 사람이 CSV 단추 하나로
 *   고객 전부를 파일로 만들 수 있으면, 열어 준 것은 화면이 아니라 **데이터 사본**이다.
 *   그리고 파일은 한 번 나가면 회수할 수 없다 — 화면은 닫으면 그만이지만 파일은 아니다.
 *
 * **왜 전수를 손으로 안 적나**: 창구는 늘어난다. 새 내보내기 창구를 만든 사람이
 *   목록을 기억해서 고쳐야 한다면 반드시 빠뜨린다. 그래서 `app/api` 아래에서
 *   **이름이 내보내기인 라우트를 전부 찾아** 판정을 부르는지 본다.
 *
 * **지금은 전수 차단이다**: I10 은 `crm/export` 하나만 붙이고 나머지 일곱을 사유와 함께 유예했고,
 *   I10a 가 그 일곱을 붙여 유예를 0으로 만들었다. 그래서 새 내보내기 창구는 판정을 안 부르면
 *   **그 자리에서** 막힌다. 유예 목록은 비었지만 지우지 않는다 — 다음 사람이 유예를 다시 만들
 *   자리를 못 찾으면 목록 대신 가드를 지우게 된다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const API = join(WEB, 'app', 'api')

/** 판정을 부르는 흔적. 이름이 바뀌면 여기도 바꿔야 하고, 안 바꾸면 전부 «안 부름»으로 잡힌다 */
const GATE = /\bcanExport\b|\bcanDo\(/

/**
 * **아직 판정을 안 붙인 내보내기 창구.** 줄기만 하고 늘지 않는다.
 *
 * 각 줄에 왜 이 판에서 안 붙였는지 적는다. 사유 없는 유예는 잊은 것과 구분되지 않는다.
 */
const NOT_YET: Record<string, string> = {
  // I10a 에서 여덟 창구 전부에 판정을 붙여 목록이 비었다.
  // **비었다고 지우지 않는다** — 목록이 사라지면 다음 사람이 유예를 다시 만들 자리를 못 찾고,
  // 아래 단정이 「0이어야 한다」를 잴 대상도 없어진다.
}

/** 유예는 0이어야 한다. 하나라도 생기면 그 판에서 이유를 적고 다음 판에 붙인다 */
const MAX_NOT_YET = 0

function routeFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) routeFiles(full, out)
    else if (name === 'route.ts') out.push(full)
  }
  return out
}

/** 주소에 export 가 든 라우트 = 값이 파일로 나가는 창구 */
const EXPORT_ROUTES = routeFiles(API)
  .map((f) => relative(API, f))
  .filter((rel) => /(^|\/)[^/]*export[^/]*\//.test(rel))
  .sort()

test('내보내기 창구를 세는 일 자체가 되고 있다', () => {
  // 걷기가 조용히 0건이 되면 아래 단정이 전부 통과해 버린다
  assert.ok(EXPORT_ROUTES.length >= 8, `내보내기 창구를 ${EXPORT_ROUTES.length}개만 찾았다, 걷기가 깨졌다`)
})

test('내보내기 판정을 안 부르는 창구가 지금보다 늘지 않는다', () => {
  const open = EXPORT_ROUTES.filter((rel) => !GATE.test(readFileSync(join(API, rel), 'utf8')))
  const unexpected = open.filter((rel) => !(rel in NOT_YET))
  assert.deepEqual(
    unexpected, [],
    `내보내기 판정을 안 부르는 창구 ${unexpected.length}개\n  ${unexpected.join('\n  ')}\n\n` +
    '둘 중 하나를 한다.\n' +
    '  ① `canExport(표면 주소)` 를 부르고 막히면 403 을 준다 (app/api/crm/export/route.ts 참고)\n' +
    '  ② 이 판에서 못 붙이면 이 파일 NOT_YET 에 **사유와 함께** 적는다',
  )
})

test('유예 목록이 실제 파일을 가리키고 사유가 적혀 있다', () => {
  for (const [rel, why] of Object.entries(NOT_YET)) {
    assert.ok(EXPORT_ROUTES.includes(rel), `NOT_YET 의 ${rel} 이 내보내기 창구 목록에 없다 — 지운 라우트가 남아 있으면 다음에 같은 이름을 만든 사람이 그냥 통과한다`)
    assert.ok(why.length > 20, `${rel} 의 사유가 너무 짧다`)
  }
})

test('★ 유예가 0이다 — 이제 전수 차단이다 (I10a)', () => {
  assert.ok(
    Object.keys(NOT_YET).length <= MAX_NOT_YET,
    `유예가 ${Object.keys(NOT_YET).length}개 남았다. 붙일 수 없으면 사유를 적고 MAX_NOT_YET 를 올리는 대신 ` +
    '그 판의 항목으로 세운다 — 유예는 늘리는 것이 아니라 없애는 것이다.',
  )
})

test('★ 내보내기 창구 전부가 판정을 부른다', () => {
  const open = EXPORT_ROUTES.filter((rel) => !GATE.test(readFileSync(join(API, rel), 'utf8')))
  assert.deepEqual(open, [], `판정을 안 부르는 창구: ${open.join(', ')}`)
})

test('유예 목록이 줄기만 한다 — 이미 붙인 창구가 다시 목록에 오르지 않는다', () => {
  const gated = EXPORT_ROUTES.filter((rel) => GATE.test(readFileSync(join(API, rel), 'utf8')))
  const backslid = gated.filter((rel) => rel in NOT_YET)
  assert.deepEqual(backslid, [], `이미 판정을 부르는데 유예 목록에도 있다: ${backslid.join(', ')}`)
})

test('CRM 내보내기는 판정을 부르고 막히면 403 이다', () => {
  const src = readFileSync(join(API, 'crm/export/route.ts'), 'utf8')
  assert.match(src, /canExport\(/, '판정을 안 부른다')
  assert.match(src, /status:\s*403/, '막혔을 때 403 이 아니다')
})
