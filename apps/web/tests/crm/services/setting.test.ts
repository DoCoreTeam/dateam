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
// loadEnv 부작용 때문에 _helpers 를 먼저 읽는다 — DATABASE_URL 이 여기서 채워진다
import { catchError } from '../integrity/_helpers.ts'
import { getCrmDb, type CrmDb } from '../../../lib/crm/db/client.ts'
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

/**
 * 이 파일 **전용** 워크스페이스.
 *
 * ## 왜 운영 워크스페이스를 쓰면 안 되나 (실측 2026-09-20)
 *
 * 예전 이 파일은 `ws_dataalliance`(운영)에 대고 돌았고, 정리 구문이 이랬다:
 *
 *     deleteMany({ where: { key: { in: SETTING_DEFS.map((d) => d.key) } } })
 *     crmAuditLog.deleteMany({ where: { targetType: 'setting' } })
 *
 * 워크스페이스도 범위도 조건에 없다. 그래서 **사용자가 넣은 견적서 공급자 정보
 * 여덟 줄이 통째로 사라졌고**, 되돌릴 근거인 감사 로그까지 같이 지워졌다.
 * 화면은 「공급자 정보가 아직 없어요」라고 말했고 사용자는 분명히 채웠는데도 그랬다.
 * 같은 사고가 2026-08-16 에 이미 보고됐고 `DI-12` 는 그때 전용 워크스페이스로 옮겼는데,
 * 이 파일만 안 옮겨서 한 달 뒤에 똑같이 터졌다.
 *
 * **아래 「목록은 등록된 키를 전부 보여 준다」 테스트가 `source === 'FALLBACK'` 을 요구한다** —
 * 즉 이 파일은 «설정이 하나도 없는 워크스페이스»를 전제로 쓰였다.
 * 운영 워크스페이스에는 설정이 있는 것이 정상이므로, 그 전제를 만족시키는 길은
 * 전부 지우는 것뿐이었다. 전용 워크스페이스로 옮겨야 그 모순이 풀린다.
 *
 * 외래키가 없어(`crm_app_setting` 제약은 PK 하나) 워크스페이스 행을 따로 만들 필요는 없다.
 */
const WS = 'ws_setting_test'
const dbT = getCrmDb(WS)

/**
 * 이 파일이 만드는 GLOBAL 행의 id 앞머리. 옛 판이 남긴 행을 찾아 지울 때 쓴다.
 */
const GLOBAL_ID_PREFIX = 'st_test_global'

/**
 * GLOBAL 행은 **커밋하지 않는다** — 롤백되는 트랜잭션 안에서만 존재한다.
 *
 * ## 왜 정리 구문으로는 안 되나 (실측 2026-09-22)
 *
 * 예전 판은 만든 id 를 들고 있다가 끝에 지웠다:
 *
 *     dbT.crmAppSetting.deleteMany({ where: { id: { in: MADE_GLOBAL } } })
 *
 * **이 구문은 한 번도 GLOBAL 행을 지운 적이 없다.** 워크스페이스 가드는 지우기에
 * GLOBAL 을 끼워 주지 않는다(`db/workspace-guard.ts` 의 「지우기에는 GLOBAL 을 끼워 넣지 않는다」) —
 * 한 워크스페이스가 모두의 공용 기본값을 지우면 안 되기 때문이고, 그건 옳은 규칙이다.
 * 그래서 위 조건은 `workspaceId: 'ws_setting_test'` 가 붙은 채로 나가고,
 * `workspaceId` 가 null 인 GLOBAL 행에는 영영 안 걸린다.
 *
 * 남은 행은 **모든 워크스페이스의 기본값**이다. 실제로 `st_test_global_0` 이 이틀 남아
 * 운영의 `ai.model.extract` 가 `global-model` 이 됐고, 견적서 읽기·명함 읽기 같은
 * 추출 경로가 전부 「설정된 AI(global-model)를 모르겠습니다」로 막혔다.
 *
 * 고칠 방향은 «더 잘 지우기»가 아니다. 지울 수 없는 것은 **만들지 않는 것**이다 —
 * 커밋되지 않으면 트랜잭션 밖에서는 존재한 적이 없다. 단정이 실패해도, 프로세스가 죽어도
 * 되돌리는 쪽은 우리가 아니라 Postgres 다.
 */
class Rollback extends Error {}

async function withGlobal<T>(
  key: string,
  value: string,
  body: (tx: CrmDb) => Promise<T>,
): Promise<T> {
  let out: T | undefined
  let ran = false
  try {
    await dbT.$transaction(async (tx) => {
      await tx.crmAppSetting.create({
        data: { id: `${GLOBAL_ID_PREFIX}_0`, scope: 'GLOBAL', workspaceId: null, key, valueJson: value as never },
      })
      out = await body(tx as unknown as CrmDb)
      ran = true
      throw new Rollback()
    }, { timeout: 30_000 })
  } catch (e) {
    if (!(e instanceof Rollback)) throw e
  }
  assert.ok(ran, '롤백 트랜잭션이 본문까지 못 갔다 — 통과처럼 보이는 미실행이다')
  return out as T
}

/**
 * 이 테스트가 만든 것만 지운다.
 *
 * 워크스페이스 행은 전용 워크스페이스 조건으로 좁힌다.
 * 감사 로그도 마찬가지다 — `targetType` 만으로 지우면 남의 설정 변경 이력이 날아간다.
 * GLOBAL 행은 여기서 안 지운다. 지울 것이 없다(위 `withGlobal` 참조).
 */
async function cleanup() {
  await dbT.crmAppSetting.deleteMany({ where: { scope: 'WORKSPACE', workspaceId: WS } })
  await dbT.crmAuditLog.deleteMany({ where: { workspaceId: WS, targetType: 'setting' } })
}

test('시작 전 잔여 정리', async () => {
  process.env.CRM_SETTING_KEY ??= 'test-master-key-for-crm-settings'
  await cleanup()
  /*
    옛 판이 남긴 GLOBAL 행을 치운다. `workspaceId: null` 을 **명시해야** 가드가
    그 조건을 존중한다 — 안 적으면 전용 워크스페이스가 주입돼 또 안 걸린다.
  */
  await dbT.crmAppSetting.deleteMany({
    where: { workspaceId: null, id: { startsWith: GLOBAL_ID_PREFIX } },
  })
})

test('★ GLOBAL 행은 커밋되지 않는다 — 남으면 모든 워크스페이스의 기본값이 된다', async () => {
  await withGlobal(KEY, 'global-model', async (tx) => {
    assert.equal((await resolveSetting(tx, KEY)).source, 'GLOBAL')
  })
  const after = await resolveSetting(dbT, KEY)
  assert.equal(after.source, 'FALLBACK',
    'GLOBAL 행이 커밋돼 남았다 — 이 한 줄이 운영 전체의 AI 설정을 덮는다')
})

test('★ 롤백 트랜잭션 안에서도 워크스페이스 가드가 살아 있다', async () => {
  await withGlobal(KEY, 'global-model', async (tx) => {
    await assert.rejects(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => (tx as any).crmAppSetting.findMany({ where: { workspaceId: 'ws_somebody_else' } }),
      (e: unknown) => e instanceof CrmError && e.code === 'WORKSPACE_MISMATCH',
      '트랜잭션 안에서 확장이 빠졌다 — 그러면 이 파일의 읽기가 남의 행까지 본다',
    )
  })
})

// ------------------------------------------------------------
// 우선순위 — WORKSPACE 가 GLOBAL 을 덮고, 없으면 코드 기본값
// ------------------------------------------------------------

test('설정이 하나도 없어도 코드 기본값으로 돈다', async () => {
  const r = await resolveSetting(dbT, KEY)
  assert.equal(r.source, 'FALLBACK')
  assert.equal(r.value, settingDef(KEY).fallback)
})

/*
  `setSetting`·`clearSetting` 은 **자기 트랜잭션을 연다**(`withCrmTx`).
  롤백 트랜잭션 안에서 부르면 이 연결 풀에 남는 연결이 없어
  「Unable to start a transaction in the given time」으로 죽는다(실측).
  그래서 쓰기는 밖에서 먼저 커밋하고, 롤백 트랜잭션은 GLOBAL 을 얹어 **읽기만** 한다.
*/
test('★ 워크스페이스 값이 GLOBAL 을 덮는다', async () => {
  await setSetting(WS, 'mb_owner', KEY, 'ws-model')
  await withGlobal(KEY, 'global-model', async (tx) => {
    const w = await resolveSetting(tx, KEY)
    assert.equal(w.value, 'ws-model', '워크스페이스 설정이 안 먹었다')
    assert.equal(w.source, 'WORKSPACE')
  })
  await cleanup()
})

test('★ 워크스페이스 값을 지우면 GLOBAL 로 돌아간다 — 되돌릴 길이 있어야 한다', async () => {
  await setSetting(WS, 'mb_owner', KEY, 'ws-model')
  await clearSetting(WS, 'mb_owner', KEY)

  await withGlobal(KEY, 'global-model', async (tx) => {
    const r = await resolveSetting(tx, KEY)
    assert.equal(r.value, 'global-model')
    assert.equal(r.source, 'GLOBAL')
  })
  await cleanup()
})

test('빈 값으로 저장하면 지운 것으로 본다 — 빈 문자열이 모델명이 되면 안 된다', async () => {
  await setSetting(WS, 'mb_owner', KEY, 'ws-model')
  await setSetting(WS, 'mb_owner', KEY, '')
  const r = await resolveSetting(dbT, KEY)
  assert.equal(r.source, 'FALLBACK')
  await cleanup()
})

test('등록되지 않은 키는 저장도 조회도 거절한다 — 오타가 조용한 무동작이 되면 안 된다', async () => {
  const e1 = await catchError(() => setSetting(WS, 'mb_owner', 'ai.modle.extract', 'x'))
  assert.ok(e1 instanceof CrmError)
  assert.equal((e1 as CrmError).code, 'VALIDATION_FAILED')

  const e2 = await catchError(() => resolveSetting(dbT, 'nope.key'))
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
  await setSetting(WS, 'mb_owner', KEY, 'ws-model')
  const audit = await dbT.crmAuditLog.findFirst({ where: { targetType: 'setting', targetId: KEY } })
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
  await setSetting(WS, 'mb_owner', KEY, 'ws-model')
  await clearSetting(WS, 'mb_owner', KEY)
  const audit = await dbT.crmAuditLog.findFirst({
    where: { targetType: 'setting', action: 'setting.cleared' },
  })
  assert.ok(audit)
  await cleanup()
})

// ------------------------------------------------------------
// 코드가 설정을 실제로 읽는가 — 만들어 놓고 안 쓰면 없는 것과 같다
// ------------------------------------------------------------

test('설정 목록은 등록된 키를 전부 보여 준다 (설정 안 한 것도)', async () => {
  const list = await listSettings(dbT)
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
