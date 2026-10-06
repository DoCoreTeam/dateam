/**
 * CRM 고침 계약 가드 — 「만들 때 고르게 한 칸은 만든 뒤에도 고칠 수 있어야 한다」
 *
 * **왜 있나**(사용자 지적 2026-10-06): *"할일도 일정 수정할 수 있어야지
 * 내용이랑 삭제만 있네 CRUD 정책 지켜"*
 *
 * 할 일 목록은 만들 때 제목·시작일·마감일·딜을 **고르게 해 놓고**, 만든 뒤에 화면이
 * 서버로 보내는 것은 `status`(완료 토글)와 `dealId`(딜 잇기) 둘뿐이었다.
 * 서버는 `title`·`startAt`·`dueAt` 를 처음부터 받고 있었다 — **화면이 안 불렀을 뿐이다.**
 * 그래서 마감을 하루 미루려면 지우고 다시 만드는 수밖에 없었고, 그러면 딜 연결과
 * 만든 날이 함께 사라진다.
 *
 * `lib/ui/crm-delete-standard.test.ts` 가 **지우는 쪽**에서 같은 부류(§2-5 (3)
 * 「서버액션이 이미 있는데 UI 가 안 부른다」)를 이미 한 번 잡았다.
 * 그때 고친 것은 D 였고 U 는 규칙 밖에 남아 있었다 — 그래서 같은 결함이 다시 왔다.
 *
 * **왜 만들기를 기준으로 재나**: 「서버가 받는 칸」을 기준으로 하면 화면이 영영 안 쓰는
 * 내부 칸까지 고치라고 요구하게 된다. 반대로 **사람이 만들 때 고른 칸**은 정의상
 * 사람이 정하는 값이고, 정한 값은 틀릴 수 있다 — 고칠 길이 없으면 그 자리에 갇힌다.
 *
 * **왜 정적 검사인가**: `tsc`·`lint` 는 이 부류를 절대 못 본다. 안 부르는 것은
 * 문법 오류가 아니라 **빠진 코드**다. 사람이 화면을 열어 보기 전엔 아무도 모른다.
 *
 * 이 가드는 만든 뒤 **일부러 깨서** 실패를 확인했다 — TasksClient 쪽 수정 모달의
 * PATCH 본문에서 `dueAt` 를 빼자 `tasks — dueAt` 로 걸렸다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { walkFiles, stripComments } from './component-scan.ts'

const WEB = join(import.meta.dirname, '..', '..')

/** CRM 자원을 다루는 화면이 사는 두 곳 — 목록·상세 화면과 상세 안의 패널 부품 */
const ROOTS = ['app/(crm)/crm', 'components/ui/crm']

/**
 * 규칙 밖에 두는 칸. **면제가 아니라 사유가 있는 제외**다 —
 * 사유를 코드에 안 적으면 다음 사람이 그냥 하나 더 적어 넣는다.
 */
const EXEMPT: Record<string, string> = {
  // 서버가 주인이다. 완료 토글이 상태를 정하고 완료 시각은 서버가 찍는다(services/task.ts)
  status: '상태는 전용 단추(완료 토글·단계 이동)가 바꾼다',
  completedAt: '서버가 찍는다 — 클라이언트 시계를 믿으면 순서가 뒤집힌다',
  // 만들 때만 뜻이 있는 칸
  sourceMeetingId: '어느 회의에서 나왔나는 출처다 — 나중에 바꾸면 그 할 일의 내력이 거짓이 된다',
  // 어느 레코드에 딸린 것인가는 그 레코드 화면이 정한다(패널이 `...scope` 로 넣는다)
  companyId: '레코드 상세 패널이 자기 자리를 넣는 값이지 사람이 고르는 값이 아니다',
  personId: '같은 이유 — 패널이 선 자리가 정한다',
  // 파일에서 읽어 만든 견적의 **출처**. sourceMeetingId 와 같은 성격이다
  sourceFileName: '어느 파일에서 읽었나는 출처다 — 고치면 원본 대조가 거짓이 된다',
  sourcePageStart: '같은 이유 — 몇 쪽에서 왔나는 사람이 정하는 값이 아니다',
  sourcePageEnd: '같은 이유',
  /*
    대조 결과는 **그 순간의 측정값**이지 견적의 칸이 아니다.
    고칠 수 있으면 「안 맞은 건」을 맞은 것으로 바꿔 자기 지표를 올릴 수 있고,
    그러면 그 숫자는 아무 말도 안 한다. DB 에도 UPDATE·DELETE 정책을 안 뒀다(마이그 306).
  */
  importCheck: '그 순간의 측정값이다 — 고칠 수 있는 지표는 지표가 아니다. DB 도 더하기만 받는다',
}

/** `fetch(` 의 괄호를 세어 인자 전체를 잘라 온다 — 정규식은 화살표 함수의 `)` 에 걸린다 */
function sliceBalanced(src: string, open: number, o = '(', c = ')'): string {
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === o) depth++
    else if (src[i] === c) {
      depth--
      if (depth === 0) return src.slice(open, i + 1)
    }
  }
  return ''
}

/**
 * 객체 글자에서 **맨 바깥 칸 이름**만 꺼낸다.
 *
 * 「칸 이름이 올 자리」를 따로 센다 — 안 그러면 `dealId: x ?? null,` 의 `null` 까지
 * 칸으로 읽는다(처음 판이 그랬고, 없는 위반 서른 건이 나왔다).
 * 조건부 펼침(`...(cond ? {} : { a })`) 안은 깊이가 2라 안 센다 —
 * 만들기와 고치기가 같은 글을 쓰면 양쪽에서 똑같이 빠지므로 판정이 어긋나지 않는다.
 */
function objectKeys(body: string): string[] {
  const keys: string[] = []
  let depth = 0
  let expectKey = false
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    if (ch === '{' || ch === '[' || ch === '(') {
      depth++
      if (depth === 1) expectKey = true
      continue
    }
    if (ch === '}' || ch === ']' || ch === ')') { depth--; continue }
    if (depth !== 1) continue
    if (ch === ',') { expectKey = true; continue }
    if (/\s/.test(ch)) continue
    if (!expectKey) continue
    expectKey = false
    const rest = body.slice(i)

    /*
      **조건부 펼침 안도 본다.** 미팅 수정은 시작 시각을 `...(date && time ? { startedAt } : {})`
      안에 넣는다 — 안 보면 「미팅은 시작 시각을 못 고친다」는 **없는 위반**이 생긴다
      (실제로 그렇게 잡혔다. 미팅은 처음부터 고칠 수 있었다).
      `...someVar` 처럼 어디서 왔는지 모르는 펼침은 건너뛴다.
    */
    if (rest.startsWith('...')) {
      const open = i + 3 + (/^\.\.\.\s*/.exec(rest)?.[0].length ?? 3) - 3
      if (body[open] === '(') {
        const group = sliceBalanced(body, open)
        for (let j = 0; j < group.length; j++) {
          if (group[j] !== '{') continue
          const nested = sliceBalanced(group, j, '{', '}')
          keys.push(...objectKeys(nested))
          j += nested.length - 1
        }
      }
      continue
    }

    const m = /^['"]?([A-Za-z_$][\w$]*)['"]?\s*[:,}]/.exec(rest)
    if (m) keys.push(m[1])
  }
  return keys
}

/** `JSON.stringify(...)` 가 실어 보내는 칸 — 변수로 넘기면 그 변수의 선언을 찾아 읽는다 */
function bodyKeys(args: string, file: string): string[] {
  const at = args.indexOf('JSON.stringify(')
  if (at < 0) return []
  const call = sliceBalanced(args, at + 'JSON.stringify'.length)
  const inner = call.slice(1, -1).trim()

  if (inner.startsWith('{')) return objectKeys(sliceBalanced(inner, 0, '{', '}'))

  /*
    **변수로 넘기는 자리를 못 읽으면 가드가 거짓말을 한다.**
    품목 수정 모달과 견적 편집 모달은 `const body = {...}` 를 만들어 만들기와 고치기에
    **같은 글을 쓴다** — 못 읽으면 고치기 쪽만 0칸이 되어 「고칠 길이 없다」로 잡힌다
    (처음 판이 그랬다). 같은 파일에서 선언을 찾아 읽는다.
  */
  const ident = /^[A-Za-z_$][\w$]*$/.test(inner) ? inner : null
  if (!ident) return []
  const decl = new RegExp(`\\b(?:const|let|var)\\s+${ident}\\s*(?::[^=]+)?=\\s*\\{`).exec(file)
  if (!decl) return []
  const brace = file.indexOf('{', decl.index)
  return objectKeys(sliceBalanced(file, brace, '{', '}'))
}

/** PATCH 창구를 가진 CRM 자원만 규칙 대상이다 — 창구가 없으면 화면이 부를 것도 없다 */
function entitiesWithPatchApi(): Set<string> {
  const out = new Set<string>()
  for (const name of readdirSync(join(WEB, 'app/api/crm')).sort()) {
    // 뿌리가 넓어지는 날을 대비해 거른다 — lib/policy/tree-scan-filter.test.ts 가 보는 줄이다
    if (name === 'node_modules' || name.startsWith('.')) continue
    const route = join(WEB, 'app/api/crm', name, '[id]', 'route.ts')
    if (!existsSync(route)) continue
    if (readFileSync(route, 'utf8').includes('export async function PATCH')) out.add(name)
  }
  return out
}

/** 화면이 CRM 창구로 보내는 본문을 자원별로 모은다 */
function collect(): Map<string, { create: Set<string>; patch: Set<string> }> {
  const out = new Map<string, { create: Set<string>; patch: Set<string> }>()
  const targets = entitiesWithPatchApi()
  const files = ROOTS.flatMap((r) => walkFiles(join(WEB, r), ['.tsx']))

  for (const file of files) {
    const src = stripComments(readFileSync(file, 'utf8'))
    for (const m of src.matchAll(/fetch\(/g)) {
      const args = sliceBalanced(src, m.index + 'fetch'.length)
      if (!args) continue
      const method = /method:\s*([^,\n]+)/.exec(args)?.[1] ?? ''
      const keys = bodyKeys(args, src)
      if (keys.length === 0) continue

      for (const entity of targets) {
        /*
          한 `fetch` 가 **만들기와 고치기를 함께** 맡는 자리가 있다
          (`isEdit ? \`/api/crm/quotes/${'$'}{id}\` : '/api/crm/quotes'`).
          주소와 method 를 각각 보고 둘 다 세야 그 자리가 규칙 밖으로 안 빠진다.
        */
        const bare = new RegExp(`['"\`]/api/crm/${entity}(?:[?'"\`])`).test(args)
        const byId = new RegExp(`['"\`]/api/crm/${entity}/\\$\\{`).test(args)
        const creates = bare && /POST/.test(method)
        const patches = byId && /PATCH|PUT/.test(method)
        if (!creates && !patches) continue

        const slot = out.get(entity) ?? { create: new Set<string>(), patch: new Set<string>() }
        if (creates) for (const k of keys) slot.create.add(k)
        if (patches) for (const k of keys) slot.patch.add(k)
        out.set(entity, slot)
      }
    }
  }
  return out
}

test('만들 때 고른 칸은 만든 뒤에도 고칠 수 있어야 한다', () => {
  const found = collect()
  const bad: string[] = []

  for (const [entity, { create, patch }] of [...found].sort()) {
    for (const key of [...create].sort()) {
      if (key in EXEMPT) continue
      if (!patch.has(key)) bad.push(`${entity} — ${key}`)
    }
  }

  assert.deepEqual(bad, [], [
    '만들 때는 고르게 해 놓고 만든 뒤에 고칠 길이 없다:',
    ...bad.map((b) => `  · ${b} — 그 칸을 PATCH 본문에 실어 보내는 화면을 만든다`),
    '(정말 못 고치는 칸이면 lib/ui/crm-update-standard.test.ts 의 EXEMPT 에 사유와 함께 적는다)',
  ].join('\n'))
})

test('규칙이 도는 대상이 실제로 있다', () => {
  // 경로가 바뀌어 대상이 0개가 되면 위 시험은 «통과»로 보인다 — 가장 위험한 실패다
  const found = collect()
  const withCreate = [...found.values()].filter((v) => v.create.size > 0)
  assert.ok(
    withCreate.length >= 4,
    `만들기 본문을 보내는 CRM 자원이 ${withCreate.length}개뿐이다 — ROOTS 경로가 바뀌었는지 확인한다`,
  )
})

test('할 일은 제목과 시작·마감을 만든 뒤에도 고친다', () => {
  /*
    위 두 시험은 «만들 때 고른 것»을 기준으로 삼는다. 그래서 추가 줄에서 어떤 칸을
    통째로 빼면 규칙도 함께 사라진다 — 사용자가 지적한 바로 그 칸이 조용히 규칙 밖으로 나간다.
    그 셋만은 이름으로 못 박는다.
  */
  const tasks = collect().get('tasks')
  assert.ok(tasks, 'CRM 할 일 창구를 부르는 화면이 하나도 없다 — 경로를 확인한다')
  for (const key of ['title', 'startAt', 'dueAt']) {
    assert.ok(tasks.patch.has(key), `할 일의 ${key} 를 고치는 화면이 없다`)
  }
})
