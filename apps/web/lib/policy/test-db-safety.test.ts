/**
 * 테스트가 운영 데이터를 지우지 못하게 한다 (실측 2026-09-20)
 *
 * ## 왜 생겼나
 *
 * `tests/crm/services/setting.test.ts` 의 정리 구문이 이랬다:
 *
 *     dbA.crmAppSetting.deleteMany({ where: { key: { in: SETTING_DEFS.map((d) => d.key) } } })
 *     dbA.crmAuditLog.deleteMany({ where: { targetType: 'setting' } })
 *
 * `dbA` 는 **운영 워크스페이스**(`ws_dataalliance`)에 묶인 손잡이다.
 * 조건이 «내가 만든 것»이 아니라 «종류»였다. 그래서 사용자가 넣은 견적서 공급자 정보
 * 여덟 줄이 통째로 사라졌고, 되돌릴 근거인 감사 로그까지 같이 지워졌다.
 * 사용자 지적: *"기존에 있던 데이터를 테스트 데이터로 생각하고 지우는 행위는 심각한 정책위반"*
 *
 * **같은 사고가 2026-08-16 에 이미 보고됐다.** 그때 DI-12 만 전용 워크스페이스로 옮기고
 * 나머지는 사람이 조심하기로 했다. 한 달 뒤 똑같이 터졌다 —
 * 사람이 조심하는 것은 가드가 아니다.
 *
 * ## 규칙
 *
 * 운영 워크스페이스에 묶인 손잡이로 지우려면 **조건이 신원이어야 한다.**
 * `id` · `targetId` · `<부모>Id` 처럼 «이 행» 또는 «내가 만든 이 행들»을 가리키는 열쇠 말이다.
 * `key` · `action` · `targetType` · `month` 같은 **종류**로 지우면 남의 것이 함께 걸린다.
 *
 * 전용 워크스페이스(이름에 test 가 든 것)에 묶인 손잡이는 이 규칙 밖이다 —
 * 워크스페이스 가드가 `where` 에 그 워크스페이스를 주입하므로 남의 행에 닿지 않는다.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..', '..')
const TESTS = join(ROOT, 'tests')

/** 이 저장소의 운영 워크스페이스. 여기 묶인 손잡이가 위험한 손잡이다 */
const PROD_WS = 'ws_dataalliance'

/** 되돌릴 수 없는 연산 */
const DESTRUCTIVE = ['deleteMany', 'delete']

/**
 * 종류로 지워도 되는 예외 — **사유를 적어야 들어온다.**
 *
 * 목록을 손으로 늘리는 것이 이 가드를 무력화하는 가장 쉬운 길이므로,
 * 줄마다 «왜 남의 것이 안 걸리는가»가 적혀 있어야 한다.
 */
const ALLOWED: { file: string; where: string; why: string }[] = [
  {
    file: 'tests/crm/integrity/DI-14.test.ts',
    where: "month: MONTH",
    why: "MONTH='2099-11' 로 실사용 월과 겹치지 않는 미래 달만 쓴다 (파일 상단에 그 이유가 적혀 있다)",
  },
]

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (name.endsWith('.ts')) out.push(p)
  }
  return out
}

/** 여는 괄호부터 짝이 맞는 닫는 괄호까지 — 인자를 정규식으로 자르면 중첩에서 틀린다 */
function argsOf(src: string, openParen: number): string {
  let depth = 0
  for (let i = openParen; i < src.length; i += 1) {
    if (src[i] === '(') depth += 1
    else if (src[i] === ')') {
      depth -= 1
      if (depth === 0) return src.slice(openParen + 1, i)
    }
  }
  return src.slice(openParen)
}

/**
 * 이 파일 안에서 **운영 워크스페이스에 묶인** 손잡이 이름들.
 *
 * 두 갈래로 들어온다: `_helpers.ts` 의 `dbA` 를 그대로 import 하거나,
 * `getCrmDb('ws_dataalliance')` 로 직접 만들거나.
 */
function prodHandles(src: string): Set<string> {
  const handles = new Set<string>()
  if (/import\s*\{[^}]*\bdbA\b[^}]*\}\s*from\s*'[^']*_helpers\.ts'/.test(src)) handles.add('dbA')
  for (const m of src.matchAll(/const\s+(\w+)\s*=\s*getCrmDb\(\s*'([^']+)'\s*\)/g)) {
    if (m[2] === PROD_WS) handles.add(m[1])
  }
  return handles
}

/** 신원으로 좁혔나 — id · targetId · companyId 처럼 «어느 행인지»를 가리키는 열쇠 */
function isIdentityScoped(where: string): boolean {
  return /(^|[{\s,])(id|\w+Id)\s*:/.test(where)
}

const FILES = walk(TESTS)

test('★ 테스트가 운영 워크스페이스의 행을 종류로 지우지 않는다 — 남의 실데이터가 함께 걸린다', () => {
  const bad: string[] = []

  for (const file of FILES) {
    const src = readFileSync(file, 'utf8')
    const rel = file.slice(ROOT.length + 1)
    const handles = prodHandles(src)
    if (handles.size === 0) continue

    for (const handle of handles) {
      for (const op of DESTRUCTIVE) {
        const needle = new RegExp(`\\b${handle}\\.(\\w+)\\.${op}\\(`, 'g')
        for (const m of src.matchAll(needle)) {
          const args = argsOf(src, m.index! + m[0].length - 1)
          const line = src.slice(0, m.index).split('\n').length
          if (ALLOWED.some((a) => rel.endsWith(a.file.replace('apps/web/', '')) && args.includes(a.where))) continue
          if (!isIdentityScoped(args)) {
            bad.push(`${rel}:${line}  ${handle}.${m[1]}.${op}(${args.replace(/\s+/g, ' ').trim().slice(0, 90)})`)
          }
        }
      }
    }
  }

  assert.deepEqual(bad, [],
    '운영 워크스페이스에 묶인 손잡이로 «종류»를 지우고 있다.\n' +
    '내가 만든 행의 id 로 좁히거나, 전용 워크스페이스(getCrmDb(\'ws_..._test\'))를 쓰라.\n' +
    '정말 안전하다면 이 파일의 ALLOWED 에 **사유와 함께** 적는다.\n' +
    bad.map((b) => `  - ${b}`).join('\n'))
})

test('★ 운영 워크스페이스를 원시 SQL 로 지울 때도 조건이 있어야 한다', () => {
  const bad: string[] = []
  for (const file of FILES) {
    const src = readFileSync(file, 'utf8')
    const rel = file.slice(ROOT.length + 1)
    for (const m of src.matchAll(/DELETE\s+FROM\s+["\w.]+((?:[^`'"]|\\.)*)/gi)) {
      const tail = m[1].slice(0, 200)
      if (!/WHERE/i.test(tail)) {
        const line = src.slice(0, m.index).split('\n').length
        bad.push(`${rel}:${line}  ${m[0].replace(/\s+/g, ' ').slice(0, 80)}`)
      }
    }
  }
  assert.deepEqual(bad, [], '조건 없는 DELETE 가 있다 — 표를 통째로 비운다:\n' + bad.join('\n'))
})

test('★ 예외 목록의 줄마다 사유가 적혀 있다 — 사유 없는 예외는 구멍이다', () => {
  for (const a of ALLOWED) {
    assert.ok(a.why.length > 20, `${a.file} 의 예외에 사유가 없다`)
    assert.ok(FILES.some((f) => f.endsWith(a.file.replace('apps/web/', ''))),
      `예외 목록이 없는 파일을 가리킨다: ${a.file} — 고친 뒤 목록에서 빼야 한다`)
  }
})

test('가드가 실제로 테스트 파일을 훑고 있다 — 경로가 틀리면 조용히 0건이 된다', () => {
  assert.ok(FILES.length >= 20, `tests/ 에서 찾은 파일이 ${FILES.length}개뿐이다`)
  assert.ok(FILES.some((f) => f.endsWith('tests/crm/services/setting.test.ts')),
    '이 가드를 있게 한 그 파일을 못 찾고 있다')
})
