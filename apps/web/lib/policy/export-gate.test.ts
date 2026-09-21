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
 * **왜 ratchet 인가**: 이 판(I10)에서 붙인 창구는 `crm/export` 하나다. 나머지 일곱은
 *   각자 다른 서비스의 자리라 한 판에 같이 손대면 리뷰가 불가능하다(I10a 가 맡는다).
 *   그래서 **지금보다 늘면 차단**으로 건다 — 새 창구는 그 자리에서 막히고,
 *   목록은 줄기만 한다. 목록이 0이 되면 이 가드는 전수 차단이 된다.
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
  'reports/export/route.ts':
    '주간보고 취합 CSV. 표면이 /weekly-report 이고 관리자 취합 화면에서만 부른다 — I10a 가 붙인다.',
  'reports/export-preview/route.ts':
    '취합 미리보기. 위와 같은 표면이라 같은 판에서 함께 붙여야 한다 — I10a.',
  'meeting-notes/[id]/export/route.ts':
    '자기 회의노트 하나를 파일로. 소유자만 읽으므로 새는 범위가 자기 것뿐이다 — I10a.',
  'rfp/cases/[id]/export/route.ts':
    'RFP 리포트. 표면이 /rfp 이고 그 셸의 멤버십이 먼저 막는다 — I10a.',
  'admin/ai-chat/export/route.ts':
    'AI 분석 결과. 관리자 전용 창구라 지금도 관리자만 부른다 — I10a.',
  'admin/ai-chat/export-pdf/route.ts':
    'AI 분석 결과 PDF. 위와 같은 자리 — I10a.',
  'admin/ai-chat/analyze-export-pdf/route.ts':
    '목록 심층분석 PDF. 위와 같은 자리 — I10a.',
}

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
