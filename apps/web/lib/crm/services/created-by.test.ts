/**
 * 작성자와 담당자가 만들 때 붙고, 고칠 때는 안 바뀐다
 *
 * **왜** (실측 2026-09-22)
 *
 *   담당자 칸은 다섯 표에 다 있는데 **한 줄도 안 차 있었다** (거래처 381건 중 0, 고객 담당자
 *   209건 중 0, 딜 8건 중 0, 견적 4건 중 0, 할일 14건 중 0). 만드는 길이 그 칸을 안 채웠다.
 *   그래서 「오늘」 화면이 담당으로 거를 값이 없어 어느 계정으로 들어와도 같은 목록을 냈다.
 *
 *   반대쪽도 잠근다. **작성자는 고치는 길에 있으면 안 된다.** 바꿀 수 있으면 이력이 아니다.
 *   지금은 `normalizeInput` 이 그 칸을 모르기 때문에 구조적으로 못 바꾸는데,
 *   누군가 편하게 하려고 거기에 한 줄 더하면 조용히 바뀌게 된다. 그 줄을 막는다.
 *
 * 소스를 읽는 가드다. 이 자리들은 DB 없이는 못 돌려 보기 때문에, 대신 **값이 실제로 들어가는
 * 줄이 있는지**를 본다. 주석은 지우고 센다 — 주석이 통과시키면 가드가 아니다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

/** 엔터티 → (파일, 담당자 칸 이름) */
const ENTITIES: ReadonlyArray<readonly [string, string, string]> = [
  ['거래처', 'company.ts', 'ownerId'],
  ['고객 담당자', 'person.ts', 'ownerId'],
  ['딜', 'deal.ts', 'ownerId'],
  ['할일', 'task.ts', 'assigneeId'],
]

function code(file: string): string {
  return readFileSync(join(HERE, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

/** `export async function createX(` 부터 다음 최상위 함수 전까지 */
function createBody(src: string): string {
  const m = /export async function create[A-Za-z]*\(/.exec(src)
  assert.ok(m, '만드는 함수를 못 찾았다')
  const rest = src.slice(m.index)
  const next = /\nexport (async )?function /.exec(rest.slice(1))
  return next ? rest.slice(0, next.index + 1) : rest
}

test('만드는 길이 작성자를 넣는다', () => {
  for (const [label, file] of ENTITIES) {
    const body = createBody(code(file))
    assert.match(body, /\bdata\.createdById\s*=\s*actorId\b/,
      `${label}: 만들 때 작성자가 안 들어간다`)
  }
})

test('만드는 길이 담당자 기본값을 작성자로 둔다', () => {
  for (const [label, file, ownerField] of ENTITIES) {
    const body = createBody(code(file))
    // 「이미 값이 있으면 그 값이 이긴다」가 규칙이므로 무조건 대입이 아니라 빈 값일 때만이다
    const pattern = new RegExp(`if\\s*\\(\\s*data\\.${ownerField}\\s*==\\s*null\\s*\\)\\s*data\\.${ownerField}\\s*=\\s*actorId`)
    assert.match(body, pattern,
      `${label}: 담당자 기본값이 없다. 비워 두면 「나중에 지정하지」가 되고 그게 지금 상태다`)
  }
})

test('고치는 길은 작성자를 건드리지 않는다', () => {
  for (const [label, file] of ENTITIES) {
    const src = code(file)
    // 고치기와 만들기가 함께 쓰는 입력 정규화. 여기 작성자가 들어오면 PATCH 로도 바뀐다
    const m = /function normalizeInput\(/.exec(src)
    assert.ok(m, `${label}: normalizeInput 을 못 찾았다`)
    const rest = src.slice(m.index)
    const end = /\n(export )?(async )?(function|const) /.exec(rest.slice(1))
    const body = end ? rest.slice(0, end.index + 1) : rest
    assert.ok(!/createdById/.test(body),
      `${label}: normalizeInput 이 작성자를 다룬다 — 고치는 길로도 바뀌게 된다`)
  }
})

test('돌려주는 행에 작성자가 실린다', () => {
  for (const [label, file] of ENTITIES) {
    const src = code(file)
    const m = /const SELECT = \{/.exec(src)
    assert.ok(m, `${label}: SELECT 를 못 찾았다`)
    const body = src.slice(m.index, src.indexOf('}', m.index))
    assert.match(body, /createdById:\s*true/,
      `${label}: SELECT 에 작성자가 없으면 화면이 그릴 값을 못 받는다`)
  }
})
