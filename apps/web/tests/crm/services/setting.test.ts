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

const KEY = 'ai.model.extract'
const SECRET_KEY = 'stt.api_key'

async function cleanup() {
  await dbA.crmAppSetting.deleteMany({ where: { key: { in: SETTING_DEFS.map((d) => d.key) } } })
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

test('★ 시크릿은 DB 에 평문으로 남지 않는다', async () => {
  await setSetting(WS_A, 'mb_owner', SECRET_KEY, 'sk-live-abcdef123456')
  const row = await dbA.crmAppSetting.findFirst({ where: { key: SECRET_KEY } })
  assert.ok(row)
  assert.equal(row!.isSecret, true)
  assert.notEqual(row!.valueJson, 'sk-live-abcdef123456', '키가 평문으로 저장됐다')
  assert.ok(!String(row!.valueJson).includes('abcdef'), '암호문에 원문 조각이 보인다')
  await cleanup()
})

test('★ 목록에는 마스킹만 나간다 — 화면으로 평문이 새면 브라우저 기록에 남는다', async () => {
  await setSetting(WS_A, 'mb_owner', SECRET_KEY, 'sk-live-abcdef123456')
  const list = await listSettings(dbA)
  const item = list.find((s) => s.key === SECRET_KEY)!

  assert.equal(item.value, null, '시크릿의 value 가 채워져 나갔다')
  assert.equal(item.masked, '••••3456')
  assert.ok(!JSON.stringify(list).includes('abcdef'), '목록 어딘가에 평문이 섞였다')
  await cleanup()
})

test('마스킹은 뒤 4자만 남긴다 — 짧은 값은 전부 가린다', () => {
  assert.equal(maskSecret('sk-live-abcdef123456'), '••••3456')
  assert.equal(maskSecret('ab'), '••••')
})

test('서버는 복호해서 실제 값을 쓴다 — 마스킹은 화면 전용이다', async () => {
  await setSetting(WS_A, 'mb_owner', SECRET_KEY, 'sk-live-abcdef123456')
  assert.equal(await readSecret(dbA, SECRET_KEY), 'sk-live-abcdef123456')
  await cleanup()
})

test('시크릿이 아닌 키를 시크릿으로 읽으려 하면 거절한다', async () => {
  const e = await catchError(() => readSecret(dbA, KEY))
  assert.ok(e instanceof CrmError)
})

test('resolveSetting 은 시크릿 값을 절대 싣지 않는다', async () => {
  await setSetting(WS_A, 'mb_owner', SECRET_KEY, 'sk-live-abcdef123456')
  const r = await resolveSetting(dbA, SECRET_KEY)
  assert.equal(r.isSecret, true)
  assert.equal(r.value, null, '일반 조회 경로로 시크릿이 나갔다')
  await cleanup()
})

test('암호화 키가 없으면 평문으로 떨어지지 않고 거절한다', async () => {
  const saved = process.env.CRM_SETTING_KEY
  delete process.env.CRM_SETTING_KEY
  try {
    const e = await catchError(() => setSetting(WS_A, 'mb_owner', SECRET_KEY, 'sk-live-x'))
    assert.ok(e instanceof CrmError)
    assert.match((e as CrmError).message, /암호화 키/)
  } finally {
    process.env.CRM_SETTING_KEY = saved
  }
  await cleanup()
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

test('★ 시크릿은 감사에도 값을 남기지 않는다 — 감사 로그가 유출 경로가 되면 안 된다', async () => {
  await setSetting(WS_A, 'mb_owner', SECRET_KEY, 'sk-live-abcdef123456')
  const audit = await dbA.crmAuditLog.findFirst({ where: { targetType: 'setting', targetId: SECRET_KEY } })
  assert.ok(audit)
  assert.ok(!JSON.stringify(audit!.afterJson).includes('abcdef'), '감사에 키가 남았다')
  assert.equal((audit!.afterJson as { changed: boolean }).changed, true, '바꿨다는 사실은 남아야 한다')
  await cleanup()
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
