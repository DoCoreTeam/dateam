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

// ------------------------------------------------------------
// 만드는 쪽 — GLOBAL 설정 행은 커밋되면 안 된다 (실측 2026-09-22)
// ------------------------------------------------------------

/*
  위 규칙은 «지우기»를 본다. 그런데 `crm_app_setting` 에는 지우기로 못 막는 구멍이 하나 더 있었다.

  GLOBAL 행은 `workspaceId` 가 null 이다. 워크스페이스 가드는 **지우기에 GLOBAL 을 끼워 주지
  않는다**(`db/workspace-guard.ts` 의 「지우기에는 GLOBAL 을 끼워 넣지 않는다」) —
  한 워크스페이스가 모두의 공용 기본값을 지우면 안 되기 때문이고, 그건 옳은 규칙이다.
  그래서 테스트가 GLOBAL 행을 만들어 놓고 끝에 지우는 구문은 **처음부터 무효였다.**
  `where: { id: { in: [...] } }` 에 전용 워크스페이스가 주입돼 null 행에 안 걸린다.

  남은 행은 모든 워크스페이스의 기본값이다. `st_test_global_0` 이 이틀 남아
  운영의 `ai.model.extract` 가 `global-model` 이 됐고, 견적서 읽기·명함 읽기 같은
  추출 경로가 전부 「설정된 AI(global-model)를 모르겠습니다」로 막혔다.

  그래서 규칙은 «잘 지워라»가 아니라 **«커밋하지 마라»** 다.
  GLOBAL 행을 만드는 자리는 되돌려지는 트랜잭션 안에 있어야 한다.

  이 가드는 이름을 안 본다. `$transaction(...)` 의 **인자 안에 롤백을 던지는 줄이 실제로 있는지**를
  보고, GLOBAL 을 만드는 자리가 그 범위 안에 들어 있는지 대조한다 —
  헬퍼 이름만 맞추고 throw 를 빼면 통과하는 가드는 가드가 아니다.
*/

/** 롤백을 일으키는 표현. 이 중 하나가 트랜잭션 인자 안에 있어야 «되돌려지는» 것으로 본다 */
const ROLLBACK_MARKS = [/throw\s+new\s+Rollback\b/, /throw\s+ROLLBACK\b/]

/**
 * 주석과 문자열 속 글자를 공백으로 덮는다. **길이와 줄바꿈은 그대로 둔다** — 위치로 대조하기 때문이다.
 *
 * 왜 필요한가(실측 2026-09-22): 이 가드를 처음 쓰고 일부러 깨 봤더니,
 * `throw new Rollback()` 을 **주석 처리했는데도 초록**이었다. 정규식이 주석에서 그 글자를 찾은 것이다.
 * 같은 결함이 CSP 가드에서도 있었다 — 지시문을 지우고 주석에 남겨도 통과했다.
 * 가드는 «글자가 있나»가 아니라 «코드가 그렇게 도나»를 봐야 한다.
 */
function codeOnly(src: string): string {
  const out = src.split('')
  let i = 0
  const blank = (from: number, to: number) => {
    for (let k = from; k < to && k < out.length; k += 1) if (out[k] !== '\n') out[k] = ' '
  }
  while (i < src.length) {
    const two = src.slice(i, i + 2)
    if (two === '//') {
      const end = src.indexOf('\n', i)
      blank(i, end === -1 ? src.length : end)
      i = end === -1 ? src.length : end
    } else if (two === '/*') {
      const end = src.indexOf('*/', i + 2)
      const stop = end === -1 ? src.length : end + 2
      blank(i, stop)
      i = stop
    } else if (src[i] === "'" || src[i] === '"' || src[i] === '`') {
      const quote = src[i]
      let j = i + 1
      while (j < src.length && src[j] !== quote) j += src[j] === '\\' ? 2 : 1
      // 따옴표 자체는 남긴다 — `scope: 'GLOBAL'` 같은 값 대조가 이 함수를 안 거치기 때문이다
      i = Math.min(j + 1, src.length)
    } else {
      i += 1
    }
  }
  return out.join('')
}

/** GLOBAL 행을 만드는 인자인가 — 값으로 본다(스코프 문자열 또는 null 소유자) */
function makesGlobalRow(args: string): boolean {
  return /scope\s*:\s*'GLOBAL'/.test(args) || /workspaceId\s*:\s*null/.test(args)
}

/** 이 파일 안에서 «되돌려지는 트랜잭션»의 문자 범위들 */
function rollbackSpans(raw: string): [number, number][] {
  const src = codeOnly(raw)
  const spans: [number, number][] = []
  for (const m of src.matchAll(/\$transaction\(/g)) {
    const open = m.index! + m[0].length - 1
    const args = argsOf(src, open)
    if (ROLLBACK_MARKS.some((re) => re.test(args))) spans.push([open, open + args.length])
  }
  return spans
}

const GLOBAL_CREATES = (() => {
  const found: { rel: string; line: number; index: number; src: string; args: string }[] = []
  for (const file of FILES) {
    const src = readFileSync(file, 'utf8')
    const code = codeOnly(src)
    for (const m of code.matchAll(/\.crmAppSetting\.(create|createMany|upsert)\(/g)) {
      // 괄호 균형도 값 대조도 코드 영역에서만 — 주석에 적힌 예시가 진짜 생성으로 잡히면 안 된다
      const args = argsOf(code, m.index! + m[0].length - 1)
      if (!makesGlobalRow(args)) continue
      found.push({
        rel: file.slice(ROOT.length + 1),
        line: src.slice(0, m.index).split('\n').length,
        index: m.index!,
        src,
        args,
      })
    }
  }
  return found
})()

test('★ 테스트가 GLOBAL 설정 행을 커밋하지 않는다 — 남으면 모든 워크스페이스의 기본값이 된다', () => {
  const bad: string[] = []
  for (const c of GLOBAL_CREATES) {
    const inside = rollbackSpans(c.src).some(([a, b]) => c.index > a && c.index < b)
    if (!inside) bad.push(`${c.rel}:${c.line}  ${c.args.replace(/\s+/g, ' ').trim().slice(0, 90)}`)
  }

  assert.deepEqual(bad, [],
    'GLOBAL 설정 행을 커밋되는 자리에서 만들고 있다.\n' +
    'GLOBAL 은 workspaceId 가 null 이라 워크스페이스 가드가 **지우기에서 안 걸어 준다** — ' +
    '정리 구문을 아무리 잘 써도 안 지워진다.\n' +
    '되돌려지는 트랜잭션 안에서 만들라: $transaction(async (tx) => { ...; throw new Rollback() })\n' +
    bad.map((b) => `  - ${b}`).join('\n'))
})

test('가드가 GLOBAL 을 만드는 자리를 실제로 찾고 있다 — 0건이면 규칙이 아니라 오타다', () => {
  assert.ok(GLOBAL_CREATES.length >= 1,
    'tests/ 에서 GLOBAL 설정 행을 만드는 자리를 한 곳도 못 찾았다 — 정규식이나 경로가 틀렸다')
  assert.ok(GLOBAL_CREATES.some((c) => c.rel.endsWith('tests/crm/services/setting.test.ts')),
    '이 가드를 있게 한 그 파일을 못 찾고 있다')
})

test('가드가 실제로 테스트 파일을 훑고 있다 — 경로가 틀리면 조용히 0건이 된다', () => {
  assert.ok(FILES.length >= 20, `tests/ 에서 찾은 파일이 ${FILES.length}개뿐이다`)
  assert.ok(FILES.some((f) => f.endsWith('tests/crm/services/setting.test.ts')),
    '이 가드를 있게 한 그 파일을 못 찾고 있다')
})
