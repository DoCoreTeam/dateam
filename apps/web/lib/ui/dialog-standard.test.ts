/**
 * **브라우저 기본 대화상자를 쓰지 않는다** — 정적 가드
 *
 * 왜: `window.prompt` · `window.confirm` · `window.alert` 은
 *   ① 우리 디자인 밖이라 테마·글꼴·버튼 배치가 제품과 따로 논다
 *   ② **페이지의 다른 동작을 통째로 막는다**(다른 탭·자동화 포함)
 *   ③ 같은 일(묻기)을 하는 자리인데 우리 모달과 말투도 배치도 다르다(§2-5)
 *
 * 대신 `useAskDialog()` 를 쓴다. 그런데 그 훅은 **`{dialog}` 를 렌더해야 뜬다** —
 * 안 그리면 물어도 아무것도 안 나오고 답을 기다리는 쪽이 **영영 멈춘다**.
 * 그래서 이 가드는 두 가지를 함께 본다: 기본 대화상자 사용, 그리고 렌더 누락.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'
import { walkFiles, stripComments } from './component-scan.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const WEB = join(HERE, '..', '..')

function screens(): string[] {
  return [
    ...walkFiles(join(WEB, 'app'), ['.tsx']),
    ...walkFiles(join(WEB, 'components'), ['.tsx']),
  ]
}

test('★ 브라우저 기본 대화상자(prompt·confirm·alert)를 쓰지 않는다', () => {
  const files = screens()
  assert.ok(files.length > 100, `스캔 대상이 너무 적다(${files.length}) — 경로를 확인하라`)

  const bad: string[] = []
  for (const file of files) {
    // 주석 안의 «쓰지 않는다» 설명까지 위반으로 세면 안 된다
    const src = stripComments(readFileSync(file, 'utf8'))
    for (const m of src.matchAll(/window\.(prompt|confirm|alert)\s*\(/g)) {
      bad.push(`${relative(WEB, file)} — window.${m[1]}()`)
    }
  }

  assert.deepEqual(bad, [],
    `브라우저 기본 대화상자 대신 useAskDialog() 를 쓰세요:\n${bad.join('\n')}`)
})

test('★ useAskDialog 을 쓰면 {dialog} 를 반드시 렌더한다', () => {
  const bad: string[] = []
  for (const file of screens()) {
    const src = stripComments(readFileSync(file, 'utf8'))
    if (!src.includes('useAskDialog(')) continue
    // 부품 자신은 예외 — 훅을 «정의»하는 곳이다
    if (file.endsWith('useAskDialog.tsx')) continue
    if (!/\{\s*dialog\s*\}/.test(src)) {
      bad.push(relative(WEB, file))
    }
  }

  assert.deepEqual(bad, [],
    `useAskDialog() 을 부르고 {dialog} 를 안 그렸습니다 — 물어도 안 뜨고 그대로 멈춥니다:\n${bad.join('\n')}`)
})
