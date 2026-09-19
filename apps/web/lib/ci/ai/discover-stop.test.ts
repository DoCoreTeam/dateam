/**
 * 발견 루프가 한도에서 실제로 멈추는가 (P0030 I02)
 *
 * ## 왜 소스를 읽는가
 *
 * discover-server.ts 는 Supabase 와 Gemini 를 끌어와 여기서 못 부른다. 그런데
 * 잠가야 할 것은 계산 결과가 아니라 **무엇을 보고 멈추기로 하는가**라서,
 * 판정의 근거가 글자인지 값인지만 확인하면 충분하다.
 *
 * ## 무엇을 막는가
 *
 * 멈춤 판정이 `/quota|한도|429/` 로 오류 **메시지**를 뒤지고 있었다. 호출기가
 * 한도 실패를 「AI 연결 실패 · 서버 응답 없음」이라는 문장으로 올리자 그 정규식이
 * 안 걸렸고, 멈춤 장치는 한 번도 작동하지 않았다. 한 주제에서 한도를 만나도
 * 남은 대조쌍 스물아홉 건을 끝까지 두드렸다.
 *
 * 실측 2026-09-20: 그 문장으로 올라온 한도 실패 23,096건, ci-discover 사흘 49,064회.
 *
 * 글자는 사람이 읽으라고 있는 것이지 코드가 판단하라고 있는 것이 아니다.
 * 문장은 언제든 다듬어지고, 다듬는 사람은 그 문장을 정규식이 읽고 있다는 것을 모른다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const src = readFileSync(join(process.cwd(), 'lib/ci/ai/discover-server.ts'), 'utf8')
/** 주석 안의 예시 글자를 규칙으로 오인하지 않게, 판정 근거는 코드에서만 찾는다 */
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

test('멈춤 판정이 오류의 이유 값을 본다', () => {
  assert.match(
    code,
    /instanceof\s+GeminiCallError/,
    '오류의 종류를 확인하지 않는다. 이유 값을 읽으려면 먼저 그 오류인지 알아야 한다',
  )
  assert.match(
    code,
    /\.reason\s*===\s*'quota'/,
    '한도 판정이 reason 값을 안 본다. 값으로 보지 않으면 문구가 바뀔 때마다 조용히 풀린다',
  )
})

test('멈춤 판정이 오류 메시지를 정규식으로 뒤지지 않는다', () => {
  const badPatterns = [
    /\/[^/\n]*\bquota\b[^/\n]*\/[a-z]*\.test\s*\(/i,
    /\/[^/\n]*한도[^/\n]*\/[a-z]*\.test\s*\(/,
    /\/[^/\n]*429[^/\n]*\/[a-z]*\.test\s*\(/,
    /\/[^/\n]*RESOURCE_EXHAUSTED[^/\n]*\/[a-z]*\.test\s*\(/i,
  ]
  for (const re of badPatterns) {
    assert.ok(
      !re.test(code),
      `메시지를 ${re} 로 뒤지고 있다. `
      + '호출기가 한도를 「AI 연결 실패」라고 말하면 이 정규식은 안 걸리고, '
      + '멈춤 장치는 있는 채로 작동하지 않는다 (실측 23,096건이 그 자리였다)',
    )
  }
})

test('한도를 만나면 남은 대조쌍을 더 부르지 않는다', () => {
  // 판정 뒤에 break 가 없으면 이유를 옳게 읽어도 계속 두드린다.
  const at = code.indexOf("=== 'quota'")
  assert.notEqual(at, -1, '한도 판정을 찾지 못했다')
  assert.match(
    code.slice(at, at + 400),
    /\bbreak\b/,
    '한도를 확인하고도 반복문을 안 빠져나온다. '
    + '다음 건도 100% 같은 이유로 실패하므로 남은 하루치를 재시도로 태우게 된다',
  )
})
