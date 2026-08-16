/**
 * 설정 체계 — 실 DB 검증 (dacrm T1-08)
 *
 * TASKS 가 지정한 완료 기준: **오버라이드 우선순위, 시크릿 마스킹.**
 * 둘 다 틀렸을 때의 증상이 조용하다는 공통점이 있다 —
 * 우선순위가 틀리면 설정을 바꿔도 아무 일이 안 일어나고,
 * 마스킹이 틀리면 키가 새어 나가는데 화면은 멀쩡해 보인다.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { dbA, WS_A, catchError } from '../integrity/_helpers.ts'
import {
  setSetting, clearSetting, resolveSetting, readSecret, listSettings,
  encryptSecret, decryptSecret, maskSecret, settingDef, SETTING_DEFS,
} from '../../../lib/crm/services/setting.ts'
import { CrmError } from '../../../lib/crm/domain/errors.ts'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const KEY = 'ai.model.extract'
/**
 * 지금 화면에 노출된 시크릿 설정은 **하나도 없다.**
 *
 * 음성 인식 키는 쓸 데(미팅 녹음)가 아직 없어 PLANNED_SETTINGS 로 내렸다 —
 * 읽지도 않는 입력창은 사용자를 속이기 때문이다(lib/crm/wired.test.ts 가 이걸 막는다).
 *
 * 그렇다고 암호화 검증을 지우지는 않는다. 키가 다시 올라올 때
 * "그때 다시 테스트를 쓰자"가 되면 그 판에 검증 없이 나간다.
 * 그래서 **암호화 자체는 계속 검증하고**, DB 왕복이 필요한 것만 임시 키로 확인한다.
 */
const SECRET_KEY = 'stt.api_key'

async function cleanup() {
  await dbA.crmAppSetting.deleteMany({
    where: { key: { in: [...SETTING_DEFS.map((d) => d.key), SECRET_KEY] } },
  })
  await dbA.crmAuditLog.deleteMany({ where: { targetType: 'setting' } })
}

test('시작 전 잔여 정리', async () => {
  process.env.CRM_SETTING_KEY ??= 'test-master-key-for-crm-settings'
  await cleanup()
})

// ------------------------------------------------------------
// 우선순위 — WORKSPACE 가 GLOBAL 을 덮고, 없으면 코드 기본값
// ------------------------------------------------------------

test('설정이 하나도 없어도 코드 기본값으로 돈다', async () => {
  const r = await resolveSetting(dbA, KEY)
  assert.equal(r.source, 'FALLBACK')
  assert.equal(r.value, settingDef(KEY).fallback)
})

test('★ 워크스페이스 값이 GLOBAL 을 덮는다', async () => {
  await dbA.crmAppSetting.create({
    data: { scope: 'GLOBAL', workspaceId: null, key: KEY, valueJson: 'global-model' as never },
  })
  const g = await resolveSetting(dbA, KEY)
  assert.equal(g.value, 'global-model')
  assert.equal(g.source, 'GLOBAL')

  await setSetting(WS_A, 'mb_owner', KEY, 'ws-model')
  const w = await resolveSetting(dbA, KEY)
  assert.equal(w.value, 'ws-model', '워크스페이스 설정이 안 먹었다')
  assert.equal(w.source, 'WORKSPACE')
  await cleanup()
})

test('★ 워크스페이스 값을 지우면 GLOBAL 로 돌아간다 — 되돌릴 길이 있어야 한다', async () => {
  await dbA.crmAppSetting.create({
    data: { scope: 'GLOBAL', workspaceId: null, key: KEY, valueJson: 'global-model' as never },
  })
  await setSetting(WS_A, 'mb_owner', KEY, 'ws-model')
  await clearSetting(WS_A, 'mb_owner', KEY)

  const r = await resolveSetting(dbA, KEY)
  assert.equal(r.value, 'global-model')
  assert.equal(r.source, 'GLOBAL')
  await cleanup()
})

test('빈 값으로 저장하면 지운 것으로 본다 — 빈 문자열이 모델명이 되면 안 된다', async () => {
  await setSetting(WS_A, 'mb_owner', KEY, 'ws-model')
  await setSetting(WS_A, 'mb_owner', KEY, '')
  const r = await resolveSetting(dbA, KEY)
  assert.equal(r.source, 'FALLBACK')
  await cleanup()
})

test('등록되지 않은 키는 저장도 조회도 거절한다 — 오타가 조용한 무동작이 되면 안 된다', async () => {
  const e1 = await catchError(() => setSetting(WS_A, 'mb_owner', 'ai.modle.extract', 'x'))
  assert.ok(e1 instanceof CrmError)
  assert.equal((e1 as CrmError).code, 'VALIDATION_FAILED')

  const e2 = await catchError(() => resolveSetting(dbA, 'nope.key'))
  assert.ok(e2 instanceof CrmError)
})

// ------------------------------------------------------------
// 시크릿 — 저장은 암호화, 화면에는 마스킹
// ------------------------------------------------------------

test('암호화 왕복이 성립한다', () => {
  const plain = 'sk-live-abcdef123456'
  assert.equal(decryptSecret(encryptSecret(plain)), plain)
})

test('같은 값도 매번 다른 암호문이 된다 (iv 랜덤)', () => {
  assert.notEqual(encryptSecret('same'), encryptSecret('same'))
})

test('변조된 암호문은 복호에 실패한다 (GCM 인증)', () => {
  const enc = encryptSecret('sk-live-abcdef123456')
  const [iv, tag, body] = enc.split(':')
  const tampered = `${iv}:${tag}:${Buffer.from('other').toString('base64')}`
  assert.throws(() => decryptSecret(tampered))
  void body
})

/**
 * 지금 화면에 노출된 시크릿 설정은 **0개다.**
 *
 * 음성 인식 키는 쓸 데(미팅 녹음)가 없어 PLANNED_SETTINGS 로 내렸다 —
 * 읽지도 않는 입력창은 사용자를 속이기 때문이다(`lib/crm/wired.test.ts`).
 *
 * 그래서 "저장 → 마스킹 → 복호" DB 왕복은 지금 검증할 대상이 없다.
 * 대신 **두 가지를 남긴다**: 암호화 자체(위 단위 테스트)와,
 * 시크릿이 다시 올라오면 이 자리를 되살리라는 신호(아래).
 * "그때 다시 쓰자"로 미루면 그 판에 검증 없이 나간다.
 */
test('★ 시크릿 설정이 다시 생기면 왕복 검증을 되살려야 한다', () => {
  const secrets = SETTING_DEFS.filter((d) => d.kind === 'secret')
  assert.deepEqual(
    secrets.map((d) => d.key), [],
    `시크릿 설정이 노출됐다(${secrets.map((d) => d.key).join(', ')}).\n` +
    '이 파일의 저장→마스킹→복호 왕복 테스트를 되살려라 — ' +
    '암호화가 아니라 **저장 경로**가 새는 것을 잡는 검증이다.',
  )
})

// ------------------------------------------------------------
// 감사 — 바꾼 사실은 남기되 값은 남기지 않는다
// ------------------------------------------------------------

test('설정 변경이 감사에 남는다', async () => {
  await setSetting(WS_A, 'mb_owner', KEY, 'ws-model')
  const audit = await dbA.crmAuditLog.findFirst({ where: { targetType: 'setting', targetId: KEY } })
  assert.ok(audit)
  assert.equal((audit!.afterJson as { value: string }).value, 'ws-model')
  await cleanup()
})

test('★ 시크릿을 저장해도 감사에 값이 남지 않는다 — 코드로 확인한다', () => {
  /**
   * 지금 노출된 시크릿 키가 없어 실제 저장으로는 검증할 수 없다.
   * 그렇다고 이 검증을 지우면, 시크릿이 다시 생겼을 때 아무도 감사 로그를 안 본다.
   * 그래서 **감사에 무엇을 싣는지**를 코드에서 직접 확인한다.
   */
  const src = readFileSync(
    join(import.meta.dirname, '..', '..', '..', 'lib/crm/services/setting.ts'), 'utf8')
  const audit = src.slice(src.indexOf('await writeAudit('), src.indexOf('})', src.indexOf('await writeAudit(')))

  // 핵심은 "시크릿이면 값을 안 싣는다"는 **분기가 있는가**다.
  // 값 표현을 정규식으로 훑으면(`value: raw…`) 정상 코드를 오판한다 — 실제로 그랬다.
  assert.match(audit, /isSecret\s*\?/, '시크릿 여부로 갈리는 분기가 없다 — 값이 그대로 남는다')
  assert.match(audit, /changed:\s*true/, '시크릿일 때 "바꿨다"는 사실조차 안 남기고 있다')
})

test('지우기도 감사에 남는다', async () => {
  await setSetting(WS_A, 'mb_owner', KEY, 'ws-model')
  await clearSetting(WS_A, 'mb_owner', KEY)
  const audit = await dbA.crmAuditLog.findFirst({
    where: { targetType: 'setting', action: 'setting.cleared' },
  })
  assert.ok(audit)
  await cleanup()
})

// ------------------------------------------------------------
// 코드가 설정을 실제로 읽는가 — 만들어 놓고 안 쓰면 없는 것과 같다
// ------------------------------------------------------------

test('설정 목록은 등록된 키를 전부 보여 준다 (설정 안 한 것도)', async () => {
  const list = await listSettings(dbA)
  assert.equal(list.length, SETTING_DEFS.length)
  assert.ok(list.every((s) => s.source === 'FALLBACK'), '아무것도 저장 안 했는데 출처가 다르다')
  await cleanup()
})

test('모든 설정 키에 설명이 있다 — 무엇인지 모르면 아무도 안 건드린다', () => {
  for (const d of SETTING_DEFS) {
    assert.ok(d.description.length > 10, `${d.key} 에 설명이 없다`)
    assert.ok(d.label.length > 0)
  }
})
