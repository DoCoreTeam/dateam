/**
 * 러너가 **실제로 답한 것**을 기록하는지 잠근다
 *
 * ## 왜 이것이 중요한가 (실측 2026-09-19)
 *
 * 어댑터가 공급자를 넘게 되면서, 고른 모델과 답한 모델이 달라질 수 있게 됐다.
 * 그때 기록이 고른 모델을 적으면 **사용량 집계가 쓰지도 않은 모델에 쌓인다** —
 * 나중에 「왜 이 모델 비용이 이렇게 나오지」를 아무도 설명하지 못한다.
 *
 * AI 채팅 쪽에는 같은 취지의 가드가 이미 있다
 * (「★ 실제로 답한 공급자·모델을 기록한다 — 사용량 집계가 거짓이 되면 안 된다」).
 * CRM 만 없었다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { formatFallbackNotice } from '../../ai-chat/model-chain.ts'

const SRC = readFileSync(new URL('./runner.ts', import.meta.url), 'utf-8')

test('★ 기록에 실제로 답한 모델이 들어간다 — 고른 모델이 아니라', () => {
  assert.match(SRC, /let usedModel: string = adapter\.model/, '기본값이 고른 모델이어야 한다')
  assert.match(SRC, /if \(r\.usedModel\) \{ usedModel = r\.usedModel/)
  // 성공·실패 두 기록과 시스템 로그 힌트가 전부 그 값을 쓴다
  const uses = SRC.match(/model: usedModel/g) ?? []
  assert.equal(uses.length, 2, `기록 두 곳 중 ${uses.length}곳만 실제 모델을 쓴다`)
  assert.match(SRC, /hint: usedModel/)
  assert.ok(!/model: adapter\.model, promptVersion/.test(SRC), '고른 모델을 적는 길이 남아 있다')
})

test('★ 안 알려 주는 어댑터는 예전처럼 동작한다 — mock 과 옛 구현이 안 깨진다', () => {
  // usedModel 의 기본값이 adapter.model 이라 res 가 비어도 기록이 빈칸이 되지 않는다
  assert.match(SRC, /let usedModel: string = adapter\.model/)
  assert.match(SRC, /usedProvider\?: string/, '계약이 선택이어야 한다')
  assert.match(SRC, /usedModel\?: string/)
})

test('★ 갈아탔으면 결과에 한 줄이 실린다 — 조용히 바꾸지 않는다', () => {
  assert.match(SRC, /switchedNote\?: string/)
  assert.match(SRC, /switchedNote: switchedNote\(\)/)
  assert.match(SRC, /if \(usedModel === adapter\.model\) return undefined/,
    '안 갈아탔는데 알림이 뜨면 사용자가 매번 «뭔가 잘못됐나» 를 겪는다')
})

test('★ 알림 문장을 새로 만들지 않는다 — 같은 사실을 화면마다 다르게 적지 않는다', () => {
  assert.match(SRC, /formatFallbackNotice\(/)
  assert.match(SRC, /from '\.\.\/\.\.\/ai-chat\/model-chain\.ts'/)
  // 문장 SSOT 가 실제로 갈아탄 사실을 말하는지
  const line = formatFallbackNotice({
    fromLabel: '설정 모델', fromModel: 'gemini-3-flash-preview',
    toLabel: 'openai', toModel: 'gpt-5.5',
  })
  assert.match(line, /gemini-3-flash-preview/)
  assert.match(line, /gpt-5\.5/)
})

test('실패 기록도 실제로 시도한 모델을 남긴다 — 어디서 막혔는지가 사유의 절반이다', () => {
  const fail = SRC.slice(SRC.indexOf('const recordFailure'), SRC.indexOf('// 실제 비용으로 정산'))
  assert.match(fail, /model: usedModel/)
})

// ── 한 겹 (가림 · 원장) ──────────────────────────────

/*
  CRM AI 열둘이 이 러너를 지난다. 등재부에 없던 동안 그 열둘이 **가림도 기록도 없이** 나갔다
  (실측 2026-09-19: `pii-gateway-guard` 의 길 목록 열 줄에 CRM 러너가 없었다).
*/

test('★ 벤더에 닿기 전에 한 겹을 지난다 — 여기 빠지면 열두 기능이 맨몸으로 나간다', () => {
  assert.match(SRC, /guardedText\(built, ctx, ledger, send\)/)
  assert.match(SRC, /guardedMedia\(adapter\.media\.bytes, ctx as MediaContext, ledger, \(\) => send\(built\)\)/)
  // 어댑터를 직접 부르는 길이 한 겹 밖에 남아 있으면 그 길로 안 가려진 채 나간다
  const outside = SRC.split('\n').filter((l) => /adapter\.complete\(/.test(l))
  assert.equal(outside.length, 1, `어댑터를 부르는 곳이 ${outside.length}곳이다`)
  assert.match(outside[0], /const r = await adapter\.complete\(masked\)/, '가린 글이 아닌 것을 보낸다')
})

test('★ 그림은 매체 갈래로 간다 — 가린 척하지 않는다', () => {
  assert.match(SRC, /media: adapter\.media\?\.kind/)
  assert.match(SRC, /const res = adapter\.media/, '매체 여부로 갈래를 고른다')
})

test('★ 맥락을 복사하지 않고 넘긴다 — 복사하면 원장에 「고른 모델」이 남는다', () => {
  assert.match(SRC, /ctx\.modelName = r\.usedModel/)
  assert.match(SRC, /ctx\.providerId = r\.usedProvider/)
  // 스프레드로 넘기면 호출 뒤 갱신이 원장에 안 닿는다
  assert.ok(!/guarded\w+\(\{ \.\.\.ctx/.test(SRC), '맥락을 복사해 넘긴다')
})

test('★ 원장을 안 주면 진짜로 적는 기본값이 붙는다 — 아무것도 안 하는 창구를 만들지 않는다', () => {
  assert.match(SRC, /opts\.ledger \?\? serverAiLedger\(\)/)
})

test('★ 가림 뒤에도 남은 개인정보는 다시 묻지 않는다 — 같은 자리에서 또 막힌다', () => {
  assert.match(SRC, /e instanceof PiiNotMaskedError/)
  assert.match(SRC, /개인정보가 들어 있어 AI 에 보내지 않았습니다/)
  // 재시도로 흘려보내면 끝에 「AI 가 내용을 이해하지 못했습니다」가 뜬다 — 원인과 정반대다
  const idx = SRC.indexOf('e instanceof PiiNotMaskedError')
  assert.ok(idx > 0 && SRC.slice(idx, idx + 500).includes('throw new CrmError'))
})

/* ── 왕복이 원문을 잃지 않는다 ───────────────────── */

/*
  **추출 기능이 이 계약 위에 있다.** 명함에서 이메일을 뽑는 일은 「가린 자리표를 모델이
  그대로 돌려주고 우리가 되돌린다」로 성립한다. 되돌리기가 깨지면 이메일 칸에
  자리표가 저장되고, 그건 실패가 아니라 **틀린 값이 조용히 들어가는 것**이다.
*/

test('★ 이메일·전화가 왕복을 견딘다 — 모델이 자리표를 그대로 돌려준다는 전제', async () => {
  const { guardedText } = await import('../../ai/guarded-call.ts')
  const rows: string[] = []
  const ledger = {
    recordCall: async () => { rows.push('call') },
    recordTransfer: async () => { rows.push('transfer') },
  }
  const 원문 = '김대리 kim@example.com 010-1234-5678 로 연락 주세요'
  let 보낸것 = ''

  const out = await guardedText(원문, { surface: 'crm/test', purpose: 'TEST' }, ledger, async (masked) => {
    보낸것 = masked
    // 모델이 자리표를 그대로 실어 답한 셈
    const token = masked.match(/⟦PII_\d+⟧/g)?.[0] ?? ''
    return { text: `{"email":"${token}"}`, inputTokens: 1, outputTokens: 1 }
  })

  assert.ok(!보낸것.includes('kim@example.com'), '이메일이 가려지지 않고 나갔다')
  assert.ok(!보낸것.includes('010-1234-5678'), '전화가 가려지지 않고 나갔다')
  assert.match(out.text, /kim@example\.com/, '되돌리기가 깨지면 자리표가 그대로 저장된다')
  assert.deepEqual(rows.sort(), ['call', 'transfer'], '호출·전송 두 원장에 남아야 한다')
})
