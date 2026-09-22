/**
 * 고르는 설정은 목록 밖의 값을 못 받는다 (실측 2026-09-20)
 *
 * ## 왜 생겼나
 *
 * `crm_app_setting` 의 `ai.model.extract` 에 `global-model` 이 들어앉아 있었다.
 * 읽는 쪽(`resolveProvider`)은 그 이름을 몰라 거절했고, 그래서 시스템 설정에 등록된
 * **AI 키 넷을 한 번도 안 부른 채** 견적서 읽기·명함 읽기가 전부 막혔다.
 * 사용자는 「AI 키를 이렇게 넣었는데 못 읽는다」를 보았다 — 맞는 말이다.
 *
 * 화면은 드롭다운이라 안전해 보인다. 그러나 창구는 화면만 부르는 게 아니고,
 * 이번 값은 아예 화면을 거치지 않고 들어왔다. 막을 자리는 저장하는 쪽이다.
 *
 * ## 이 파일이 DB 를 안 건드리는 이유
 *
 * 거절은 DB 왕복 **앞에서** 일어나야 한다. 뒤에서 일어나면 잘못된 값이 한 번 쓰였다가
 * 지워지는 것이고, 그 사이 다른 요청이 그것을 읽는다.
 * 여기서는 `DATABASE_URL` 없이 돌린다 — 구현이 DB 를 먼저 건드리도록 바뀌면
 * 연결 오류로 **이 파일이 실패한다.** 순서를 지키는지까지 검사하는 셈이다.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  SETTING_DEFS, allowedValuesOf, setSetting, settingDef,
} from './setting.ts'
import { AI_PROVIDER_IDS, isAiProviderId } from '../../ai/provider-catalog.ts'
import { CrmError } from '../domain/errors.ts'

const CHOICE_DEFS = SETTING_DEFS.filter((d) => d.kind === 'choice')

test('고르는 설정이 하나라도 있다 — 0개면 아래 검사가 전부 헛돈다', () => {
  assert.ok(CHOICE_DEFS.length >= 1, 'kind:choice 설정을 하나도 못 찾았다')
})

test('★ 고르는 설정마다 허용 집합이 비어 있지 않다 — 비면 검증이 조용히 안 돈다', () => {
  for (const d of CHOICE_DEFS) {
    assert.ok(allowedValuesOf(d).length > 0,
      `${d.key} 의 허용 집합이 비었다 — setSetting 이 아무 값이나 받는다`)
  }
})

test('★ 추출 AI 의 허용 집합은 읽는 쪽이 이해하는 집합과 같다', () => {
  const allowed = allowedValuesOf(settingDef('ai.model.extract'))

  // 읽는 쪽이 아는 공급자는 전부 저장할 수 있어야 한다 — 키를 등록하기 전에 미리 골라 둘 수 있다
  for (const id of AI_PROVIDER_IDS) {
    assert.ok(allowed.includes(id), `${id} 를 저장할 수 없다 — 공급자를 늘려도 CRM 만 모른다`)
  }
  // 반대로, 공급자도 아니고 특수값도 아닌 것이 섞여 있으면 읽는 쪽이 또 거절한다
  for (const v of allowed) {
    if (v === 'auto' || v === 'mock') continue
    assert.ok(isAiProviderId(v), `${v} 는 읽는 쪽이 모르는 값이다`)
  }
})

test('★ 목록 밖의 값은 저장이 거절된다 — 이 사고를 낸 그 값으로 확인한다', async () => {
  await assert.rejects(
    () => setSetting('ws_never_used', 'mb_test', 'ai.model.extract', 'global-model'),
    (e: unknown) => e instanceof CrmError && e.code === 'VALIDATION_FAILED',
    'global-model 이 저장을 통과했다 — 같은 사고가 다시 난다',
  )
})

test('★ 고르는 설정 전부가 거절한다 — AI 설정 하나만 막으면 다음은 다른 키로 난다', async () => {
  for (const d of CHOICE_DEFS) {
    await assert.rejects(
      () => setSetting('ws_never_used', 'mb_test', d.key, '_없는값_'),
      (e: unknown) => e instanceof CrmError && e.code === 'VALIDATION_FAILED',
      `${d.key} 가 목록 밖의 값을 받았다`,
    )
  }
})
