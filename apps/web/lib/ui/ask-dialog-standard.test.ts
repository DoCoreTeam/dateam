// lib/ui/ask-dialog-standard.test.ts — 대화상자 제목 계약 가드
//
// **왜 생겼나**(실측 2026-09-08 프로덕션 `/crm/tasks`):
//   삭제 확인 대화상자가 「할 일 1건을 삭제할까요? 딜과 미팅 기록은 그대로 남아요.는 남습니…」
//   로 **상자를 뚫고 잘려** 나갔다. 사용자 지적: 「이거 디자인 완전 깨졌는데 멘트도 이상하고」.
//
//   원인은 둘이 겹친 것이다:
//     ① `useAskDialog` 의 제목은 `.tape-title` 로 그려지고, 그 클래스는 테이프 라벨이라
//        **`white-space: nowrap`** 이다. 긴 문장은 줄바꿈 없이 상자 밖으로 나간다.
//     ② 호출부가 `confirmDelete()` 의 **완성된 한 줄**을 제목으로 넘겼다.
//        그 함수는 물음 + 결과를 이어 붙이므로 제목 자리에 들어갈 길이가 아니다.
//
//   부품에도 방어선을 뒀지만(`ask-dialog.module.css` 의 `.title`), 그건 **넘치지만 않게**
//   할 뿐 제목이 문단이 되는 것을 막지는 못한다. 자리를 지키는 것은 호출부의 몫이라
//   여기서 잠근다.
//
// 규칙 셋 다 **지금 위반 0**이다. 예외 목록으로 시작하지 않는다 — 0에서 잠근다.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { walkFiles, read, stripComments } from './component-scan.ts'

const SCREEN_ROOTS = ['app', 'components'] as const

/**
 * 제목 한 줄의 상한.
 *
 * `.tape-title` 은 1.375rem 이고 대화상자 폭은 440px 이다 — 한글 기준 20자 남짓이
 * 한 줄에 들어간다. 30자는 **말이 되는 물음은 통과시키되 문단은 막는** 자리다
 * (실측: 통과해야 할 가장 긴 물음 「"파이프라인 이름" 단계를 삭제할까요?」 = 22자,
 *  막아야 할 것 = 위 사고의 45자).
 */
const TITLE_MAX = 30

interface Call { file: string; kind: string; body: string }

/** `ask.confirm({ … })` 한 덩어리를 뽑는다 — 중괄호가 닫히는 데까지 센다 */
function askCalls(): Call[] {
  const out: Call[] = []
  for (const root of SCREEN_ROOTS) {
    for (const file of walkFiles(root, ['.tsx'])) {
      const src = stripComments(read(file))
      const re = /ask\.(confirm|notice|text)\(\{/g
      let m: RegExpExecArray | null
      while ((m = re.exec(src)) !== null) {
        // 여는 중괄호부터 짝이 맞는 닫는 중괄호까지 — 정규식으로는 중첩을 못 센다
        let depth = 1
        let i = m.index + m[0].length
        for (; i < src.length && depth > 0; i += 1) {
          if (src[i] === '{') depth += 1
          else if (src[i] === '}') depth -= 1
        }
        out.push({ file, kind: m[1], body: src.slice(m.index + m[0].length, i - 1) })
      }
    }
  }
  return out
}

/** 객체 리터럴 본문에서 `title:` 의 값 하나를 뽑는다(같은 깊이의 쉼표까지) */
function titleValue(body: string): string | null {
  const at = body.search(/(^|[\s,{])title\s*:/)
  if (at < 0) return null
  const from = body.indexOf(':', at) + 1
  let depth = 0
  let quote: string | null = null
  for (let i = from; i < body.length; i += 1) {
    const c = body[i]
    if (quote) {
      if (c === '\\') { i += 1; continue }
      if (c === quote) quote = null
      continue
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue }
    if ('([{'.includes(c)) depth += 1
    else if (')]}'.includes(c)) depth -= 1
    else if (c === ',' && depth === 0) return body.slice(from, i).trim()
  }
  return body.slice(from).trim()
}

/** 따옴표로 감싼 통짜 리터럴이면 안쪽 글자를 준다. 아니면 null(변수·식이라 못 잰다) */
function literalText(value: string): string | null {
  const m = /^(['"`])([\s\S]*)\1$/.exec(value)
  if (!m) return null
  // 템플릿 안의 `${…}` 는 길이를 알 수 없다 — 잴 수 있는 것만 잰다
  if (m[1] === '`' && m[2].includes('${')) return null
  return m[2]
}

test('대화상자 제목에 confirmDelete() 한 줄을 넘기지 않는다 — parts 로 나눈다', () => {
  // 왜: confirmDelete 는 물음 + 결과를 이어 붙인 한 줄이라 제목 자리에 안 들어간다.
  //   실제로 그 한 줄이 `.tape-title`(nowrap)을 뚫고 프로덕션에서 잘려 나갔다.
  const offenders = askCalls()
    .filter((c) => {
      const v = titleValue(c.body)
      return v !== null && /\bconfirmDelete\s*\(/.test(v)
    })
    .map((c) => `${c.file} (ask.${c.kind})`)
  assert.deepEqual(offenders, [], [
    '제목에 confirmDelete() 를 그대로 넘기는 자리가 생겼다.',
    'confirmDeleteParts() 로 { title, body } 를 받아 나눠 넘길 것:',
    ...offenders.map((o) => `  ${o}`),
  ].join('\n'))
})

test(`대화상자 제목은 ${TITLE_MAX}자 이하다 — 결과 설명은 body 로 간다`, () => {
  // 왜: 제목은 테이프 라벨이라 줄바꿈이 없다. 길면 상자를 넘거나(예전) 문단이 된다(지금).
  const offenders = askCalls()
    .map((c) => {
      const v = titleValue(c.body)
      const lit = v === null ? null : literalText(v)
      return lit !== null && lit.length > TITLE_MAX
        ? `${c.file}: ${lit.length}자 "${lit.slice(0, 24)}…"`
        : null
    })
    .filter((x): x is string => x !== null)
  assert.deepEqual(offenders, [], [
    `대화상자 제목이 ${TITLE_MAX}자를 넘었다. 물음만 제목에 두고 나머지는 body 로 옮길 것:`,
    ...offenders.map((o) => `  ${o}`),
  ].join('\n'))
})

test('대화상자 제목은 문장 하나다 — 물음 뒤에 설명을 이어 붙이지 않는다', () => {
  // 왜: 「…삭제할까요? 되돌릴 수 없습니다.」처럼 둘을 붙이면 그때부터 제목이 문단이 된다.
  //   자리를 나눠 두면 화면마다 어디에 무엇을 넣을지 다시 정하지 않아도 된다.
  const offenders = askCalls()
    .map((c) => {
      const v = titleValue(c.body)
      const lit = v === null ? null : literalText(v)
      // 물음표·마침표 **뒤에 글자가 더 있으면** 두 문장이다
      return lit !== null && /[.?!]\s*\S/.test(lit) ? `${c.file}: "${lit}"` : null
    })
    .filter((x): x is string => x !== null)
  assert.deepEqual(offenders, [], [
    '제목에 문장이 둘 들어갔다. 뒤 문장은 body 로 옮길 것:',
    ...offenders.map((o) => `  ${o}`),
  ].join('\n'))
})
