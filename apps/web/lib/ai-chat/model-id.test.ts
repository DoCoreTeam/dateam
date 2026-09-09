import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { isValidModelId } from './model-id.ts'

test('★ 만든 곳이 앞에 붙은 아이디를 받는다 — Groq 이 그렇게 이름 짓는다', () => {
  // 실측 v0.7.716: 이걸 막아서 「대화 생성에 실패했습니다」만 뜨고 끝났다
  assert.ok(isValidModelId('openai/gpt-oss-120b'))
  assert.ok(isValidModelId('Qwen/qwen3.6-27b'))
})

test('평범한 아이디도 그대로 받는다', () => {
  for (const id of ['gemini-3.1-pro-preview', 'claude-opus-4-8', 'gpt-5.5', 'o1']) {
    assert.ok(isValidModelId(id), id)
  }
})

test('이상한 값은 막는다 — 이 검사가 있는 이유다', () => {
  assert.equal(isValidModelId(''), false)
  assert.equal(isValidModelId('a b'), false)
  assert.equal(isValidModelId('<script>'), false)
  assert.equal(isValidModelId('x'.repeat(65)), false)
  assert.equal(isValidModelId(null), false)
  assert.equal(isValidModelId(123), false)
})

// ── 배선 가드: 같은 규칙을 두 곳에 적지 않는다 ──

const WEB = join(import.meta.dirname, '..', '..')

test('★ 모델 아이디 정규식을 화면·라우트가 다시 적지 않는다 (둘 다 낡아서 같이 틀렸다)', () => {
  const offenders: string[] = []
  const walk = (rel: string) => {
    for (const e of readdirSync(join(WEB, rel))) {
      if (e === 'node_modules' || e === '.next' || e.startsWith('.next-')) continue
      const child = `${rel}/${e}`
      if (statSync(join(WEB, child)).isDirectory()) walk(child)
      else if (/\.tsx?$/.test(e) && !e.endsWith('.test.ts')) {
        const src = readFileSync(join(WEB, child), 'utf8')
        if (/const MODEL_RE\s*=/.test(src)) offenders.push(child)
      }
    }
  }
  walk('app')
  walk('lib')
  assert.deepEqual(offenders, [], `자기 정규식을 들고 있다: ${offenders.join(' · ')}`)
})
