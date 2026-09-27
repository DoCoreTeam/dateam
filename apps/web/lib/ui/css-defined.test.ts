// lib/ui/css-defined.test.ts — "클래스는 썼는데 CSS가 없다"를 잡는다
//
// 왜: v0.7.448에서 목록 표준 부품을 만들면서 globals.css에 규칙을 붙이는 명령이
//   앞선 실패로 끊겨 실행되지 않았다. 클래스명만 있고 규칙이 없는 상태였는데
//   tsc·단위테스트·design:check가 **전부 초록**이었다(정적 검사는 CSS 존재를 안 본다).
//   실브라우저를 열고 나서야 도구줄이 세로로 무너진 걸 발견했다.
//
// ── 2026-09-28: 접두어 손목록을 버렸다 ────────────────────────────────────
// 이 가드는 `SYSTEM_PREFIXES` 라는 **손으로 적은 접두어 목록**에 든 이름만 봤다.
// 그래서 `btn`·`btn-sm`·`mono` 는 **한 번도 검사되지 않았고**, AI 트레이딩 화면 열한 곳과
// 2단계 인증·관리자 AI 사용량 화면의 단추 스물세 자리가 꾸밈 없는 맨 버튼으로 렌더됐다
// (사용자 지적 2026-09-28 「디자인이 안되어 있다니깐 모달이랑 버튼 배치랑 글자 크기도
//  저기만 유독 이상하네」). 같은 판에 `badge-green`(이름 착오)·`home-section-header`·
// `oap-branch`·`doc-fitbox` 같은 **아무것도 안 꾸미는 이름** 일곱도 함께 나왔다.
//
// 목록이 현실과 어긋나면 새 이름은 목록 밖에서 태어난다 — 그것이 이 가드가
// 자기가 막으려던 것을 못 막은 이유다. 그래서 **전부 보고, 아는 것만 뺀다**로 뒤집었다.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { walkFiles, read } from './component-scan.ts'

/**
 * **Tailwind 기본 유틸리티.** 우리 CSS 에 규칙이 없는 것이 맞다 — Tailwind 가 만든다.
 *
 * 이 목록에는 **고쳐야 하는데 안 고친 클래스를 넣지 않는다.** 넣는 순간 이 가드는
 * 「나중에 고칠 것」의 보관함이 되고, 그 「나중에」는 안 온다.
 */
const TAILWIND_UTILITIES = new Set(['sr-only', 'min-w-0'])

/** 상태 표시용 훅 — CSS 가 아니라 자바스크립트·속성 선택자가 읽는다 */
const STATE_HOOKS = new Set(['is-active', 'is-clickable'])

/** 규칙을 찾을 곳. globals.css 와 모든 CSS 모듈 */
function allCss(): string {
  const files = [
    'app/globals.css',
    ...walkFiles('app', ['.css']),
    ...walkFiles('components', ['.css']),
  ]
  return [...new Set(files)].map(read).join('\n')
}

/** `.token` 이 선택자로 등장하나 — 뒤따르는 문자가 클래스명 문자가 아니어야 한다 */
function definedIn(css: string, token: string): boolean {
  return new RegExp(`\\.${token.replace(/[-]/g, '\\-')}(?![\\w-])`).test(css)
}

/**
 * 주석을 지운다 — 길이는 그대로 두고 그 자리만 공백으로 바꾼다.
 *
 * 왜: 주석에 적은 `'use client'` 를 코드로 읽어 짝인 `client` 를 없는 클래스로 잡았다.
 * 가드가 주석을 읽으면 사실이 아닌 것을 사실로 보고한다.
 *
 * 문자열 안의 `//` 는 주석이 아니므로 따옴표 안에서는 세지 않는다. 줄이 끝나면 따옴표
 * 상태를 푼다 — 여는 따옴표가 없는 JSX 본문의 홑따옴표가 그 아래를 통째로 삼키지 않게.
 */
function stripComments(src: string): string {
  const out = src.split('')
  let i = 0
  let quote: string | null = null
  while (i < src.length) {
    const c = src[i]
    if (quote) {
      if (c === '\\') { i += 2; continue }
      if (c === quote || (c === '\n' && quote !== '`')) quote = null
      i += 1
      continue
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; i += 1; continue }
    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') { out[i] = ' '; i += 1 }
      continue
    }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2)
      const stop = end === -1 ? src.length : end + 2
      for (; i < stop; i += 1) if (src[i] !== '\n') out[i] = ' '
      continue
    }
    i += 1
  }
  return out.join('')
}

/**
 * 지시문 머리가 끝나는 자리. 앞쪽의 공백·주석·홀로 선 문자열을 지나 **첫 코드**가 나오는 지점이다.
 * 그 앞의 문자열은 `'use client'`·`'use server'` 처럼 언어가 문장으로 읽는 것이라 클래스가 아니다.
 */
function prologueEnd(src: string): number {
  const re = /\s+|\/\/[^\n]*|\/\*[\s\S]*?\*\/|(['"])[^'"\n]*\1\s*;?/y
  let end = 0
  while (re.exec(src)) end = re.lastIndex
  return end
}

/**
 * 화면·부품이 쓰는 클래스 이름을 전부 모은다.
 *
 * 세 꼴을 본다 — `className="a b"`, `className={\`a ${x} b\`}`, 그리고 **따옴표 안의
 * 클래스 목록**. 셋째가 필요한 이유: `nb-danger` 는 `VARIANT_CLASS = { danger:
 * 'btn-primary nb-danger' }` 라는 **상수**에 있어서, className 만 훑던 옛 가드가
 * 통째로 놓쳤다(v0.7.456 실브라우저에서 발견 — 앱 전체 삭제 버튼이 파란색이었다).
 *
 * 셋째 꼴은 `'use client'`·`'noopener noreferrer'` 같은 **클래스가 아닌 두 낱말**도
 * 같이 집어 온다. 그것을 이름 목록으로 거르면 또 손목록이 된다 — 대신 **사실로 가른다**:
 * 진짜 클래스 목록이라면 그 안에 **이미 정의된 이름이 하나라도 있다.**
 * `'noopener noreferrer'` 에는 하나도 없고, `'btn-primary nb-danger'` 에는 `btn-primary` 가 있다.
 *
 * 그 하나로는 `'use client'` 를 못 가른다 — CSS 모듈에 `.use` 가 실제로 있어서
 * 「아는 이름이 하나 있다」가 참이 되고, 짝인 `client` 가 없는 클래스로 잡혔다.
 * 지시문은 이름이 아니라 **자리**로 가른다: 코드가 시작되기 전 머리에 홀로 선 문자열은
 * 언어가 정한 문장이지 클래스 목록이 아니다.
 */
function usedClasses(css: string): Map<string, string[]> {
  const used = new Map<string, string[]>()
  const add = (token: string, file: string) => {
    used.set(token, [...(used.get(token) ?? []), file])
  }
  for (const file of [...walkFiles('components', ['.tsx']), ...walkFiles('app', ['.tsx'])]) {
    const src = stripComments(read(file))
    const codeStart = prologueEnd(src)
    const re = /className=(?:"([^"]*)"|\{`([^`]*)`\})|'([a-z][\w-]*(?: [a-z][\w-]*)+)'/g
    let m: RegExpExecArray | null
    while ((m = re.exec(src))) {
      const isBareString = m[3] !== undefined
      // 머리에 선 문자열은 지시문이다 — `'use client'` 는 클래스 목록이 아니라 문장이다
      if (isBareString && m.index < codeStart) continue
      // 보간(${…})이 붙은 토큰은 조각이라 클래스명이 아니다 — 표식을 남겨 걸러낸다
      const raw = (m[1] ?? m[2] ?? m[3] ?? '').replace(/\$\{[^}]*\}/g, '\u0000')
      const tokens = raw.split(/\s+/).filter((t) => t && !t.includes('\u0000'))
      // 따옴표 문자열은 **아는 클래스가 하나라도 있을 때만** 클래스 목록으로 친다
      if (isBareString && !tokens.some((t) => definedIn(css, t))) continue
      for (const token of tokens) {
        if (STATE_HOOKS.has(token) || TAILWIND_UTILITIES.has(token)) continue
        if (!/^[a-z][a-z0-9-]*$/.test(token)) continue
        add(token, file)
      }
    }
  }
  return used
}

test('★ 화면·부품이 쓰는 클래스는 어딘가에 정의돼 있다', () => {
  const css = allCss()
  const missing: string[] = []
  for (const [token, files] of usedClasses(css)) {
    if (definedIn(css, token)) continue
    missing.push(`${token} → ${[...new Set(files)].slice(0, 3).join(' | ')}`)
  }
  assert.deepEqual(missing, [],
    `클래스를 쓰는데 CSS 규칙이 없다(화면에서 꾸밈 없이 렌더된다):\n  ${missing.join('\n  ')}`)
})

/**
 * **가드가 주석을 읽으면 사실이 아닌 것을 사실로 보고한다.** 실제로 그랬다 — 주석에 적어 둔
 * `'use client'` 때문에 짝인 `client` 가 「없는 클래스」로 잡혔다(2026-09-28).
 *
 * 반대쪽도 같이 잠근다: 주소의 `//` 를 주석으로 읽고 그 줄을 삼키면 같은 줄의 진짜 className 을
 * 놓친다 — 이쪽 고장은 조용해서 더 나쁘다.
 */
test('★ 주석과 지시문은 코드가 아니고, 주소의 // 는 주석이 아니다', () => {
  const src = [
    "'use client'",
    '',
    "// 여기 적은 'use client' 는 주석이다",
    '/* zzz-block-comment */',
    'const a = <a href="https://example.com" className="zzz-live" />',
  ].join('\n')
  const clean = stripComments(src)

  assert.ok(!clean.includes('zzz-block-comment'), '블록 주석이 코드로 남았다')
  assert.ok(!clean.includes('여기 적은'), '줄 주석이 코드로 남았다')
  assert.ok(clean.includes('zzz-live'), '주소의 // 가 같은 줄의 className 을 삼켰다')
  assert.equal(clean.split('\n').length, src.split('\n').length, '주석을 지우며 줄 수가 바뀌었다')

  const codeStart = prologueEnd(clean)
  assert.ok(codeStart >= clean.indexOf("'use client'") + "'use client'".length,
    '머리에 홀로 선 지시문이 지시문으로 안 읽혔다')
  assert.equal(codeStart, clean.indexOf('const a'), '지시문 머리가 첫 코드 자리에서 안 끝났다')
})

/**
 * **면제는 썩는다.** 규칙이 생겼는데 면제 목록에 남아 있으면, 다음 사람은 그 이름을
 * 「우리가 안 보는 것」으로 읽는다. 목록은 실제로 정의가 없는 것만 담는다.
 */
test('★ Tailwind 면제 목록에 우리 규칙이 있는 이름이 없다', () => {
  const css = allCss()
  const stale = [...TAILWIND_UTILITIES].filter((t) => definedIn(css, t))
  assert.deepEqual(stale, [], `우리 CSS 에 규칙이 생긴 이름이 면제로 남아 있다: ${stale.join(', ')}`)
})

/**
 * **면제 목록이 자라지 않는다.** 이 가드가 잡은 것을 고치는 대신 목록에 넣으면
 * 초록은 돌아오지만 화면은 그대로다 — 그 길을 숫자로 막는다.
 */
test('★ 면제 목록이 둘을 안 넘는다 — 고치는 대신 넣는 길을 막는다', () => {
  assert.ok(TAILWIND_UTILITIES.size <= 2,
    `면제가 ${TAILWIND_UTILITIES.size}개다. 새 이름은 면제가 아니라 규칙을 만들 것`)
})
