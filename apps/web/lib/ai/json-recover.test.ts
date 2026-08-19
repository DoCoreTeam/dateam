// lib/ai/json-recover.ts — JSON 회수 SSOT 가드
//
// 왜(v0.7.571): 예전 파서는 코드펜스만 벗기고 바로 JSON.parse를 했다. 모델이 JSON 앞뒤에
// 설명 한 줄만 붙여도 통째로 실패했고, 사용자에겐 "다시 시도해 주세요"만 떴다(재시도해도 같은 이유로 실패).
// 여기서 잠그는 계약은 둘이다 — ① 응답 안에 유효한 JSON이 있으면 반드시 건진다
// ② 유효하지 않은 것을 억지로 고쳐서 통과시키지 않는다(틀린 데이터를 맞는 척 넘기는 게 더 나쁘다).

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { JsonRecoverError, asJsonRecord, recoverJson } from './json-recover.ts'

describe('recoverJson — 정상 경로', () => {
  it('그냥 JSON은 그대로 파싱한다', () => {
    assert.deepEqual(recoverJson('{"a":1}'), { a: 1 })
    assert.deepEqual(recoverJson('[1,2,3]'), [1, 2, 3])
  })

  it('마크다운 코드펜스를 벗긴다 — 모델이 가장 자주 하는 짓이다', () => {
    assert.deepEqual(recoverJson('```json\n{"a":1}\n```'), { a: 1 })
    assert.deepEqual(recoverJson('```\n{"a":1}\n```'), { a: 1 })
  })
})

describe('recoverJson — 산문 속에서 건지기', () => {
  it('★ 앞에 설명이 붙어도 건진다 — 이게 회의노트 AI가 죽던 자리다', () => {
    const raw = '알겠습니다. 아래가 요청하신 JSON입니다.\n{"summary":"회의 요약"}'
    assert.deepEqual(recoverJson(raw), { summary: '회의 요약' })
  })

  it('★ 뒤에 사족이 붙어도 건진다', () => {
    assert.deepEqual(recoverJson('{"a":1}\n\n필요하시면 더 자세히 정리해 드릴게요.'), { a: 1 })
  })

  it('★ Gemma식 사고과정 텍스트 뒤에 오는 JSON도 건진다(실측 응답 형태)', () => {
    const raw = [
      '*   Input text: 회의 본문...',
      '*   Task: 요약을 만든다',
      '',
      '결과:',
      '{"summary":"3천만원 → 1.5억","decisions":["GERI 협의"]}',
    ].join('\n')
    assert.deepEqual(recoverJson(raw), {
      summary: '3천만원 → 1.5억',
      decisions: ['GERI 협의'],
    })
  })

  it('중첩 객체·배열의 끝을 정확히 찾는다 — 얕게 끊으면 뒷부분이 통째로 사라진다', () => {
    const raw = 'note\n{"a":{"b":[1,{"c":2}]},"d":3}\ntail'
    assert.deepEqual(recoverJson(raw), { a: { b: [1, { c: 2 }] }, d: 3 })
  })

  it('★ 문자열 안의 중괄호에 속지 않는다 — 괄호만 세면 여기서 잘린다', () => {
    const raw = 'x {"text":"본문에 } 가 들어있다","n":1} y'
    assert.deepEqual(recoverJson(raw), { text: '본문에 } 가 들어있다', n: 1 })
  })

  it('이스케이프된 따옴표도 문자열 끝으로 오인하지 않는다', () => {
    const raw = 'x {"t":"그가 \\"됐다\\" 고 말했다"} y'
    assert.deepEqual(recoverJson(raw), { t: '그가 "됐다" 고 말했다' })
  })

  it('앞의 후보가 깨졌으면 뒤의 온전한 블록을 쓴다 — 첫 후보만 보고 포기하지 않는다', () => {
    const raw = '{망가진 조각\n\n{"ok":true}'
    assert.deepEqual(recoverJson(raw), { ok: true })
  })
})

describe('recoverJson — 실패는 실패라고 말한다', () => {
  it('★ JSON이 아예 없으면 던진다 — 억지로 고쳐 통과시키지 않는다', () => {
    assert.throws(() => recoverJson('요약을 만들 수 없습니다.'), JsonRecoverError)
  })

  it('빈 응답도 던진다', () => {
    assert.throws(() => recoverJson(''), JsonRecoverError)
    assert.throws(() => recoverJson('   \n  '), JsonRecoverError)
  })

  it('짝이 안 맞는 괄호를 억지로 닫지 않는다 — 추측 복구 금지', () => {
    assert.throws(() => recoverJson('{"a":1'), JsonRecoverError)
  })

  it('★ 오류에 원문 앞부분을 담는다 — 없으면 왜 실패했는지 아무도 못 본다', () => {
    try {
      recoverJson('JSON은 없고 설명만 잔뜩 있는 응답')
      assert.fail('던졌어야 한다')
    } catch (e) {
      assert.ok(e instanceof JsonRecoverError)
      assert.ok(e.sample.includes('설명만'))
      assert.ok(e.sample.length <= 200)
    }
  })
})

describe('asJsonRecord', () => {
  it('객체는 그대로, 배열·원시값은 빈 객체 — 호출처가 필드 접근에서 터지지 않게', () => {
    assert.deepEqual(asJsonRecord({ a: 1 }), { a: 1 })
    assert.deepEqual(asJsonRecord([1, 2]), {})
    assert.deepEqual(asJsonRecord('문자열'), {})
    assert.deepEqual(asJsonRecord(null), {})
    assert.deepEqual(asJsonRecord(undefined), {})
  })
})
