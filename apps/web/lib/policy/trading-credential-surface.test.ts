/**
 * 증권사 자격증명 — **넣는 길만 있고 보는 길은 없다**
 *
 * **왜** (실측 2026-09-27): `saveTradingCredentials` 는 만들어져 있었는데 **부르는 자리가
 *   0곳**이었다. 저장·암호화·가린 계좌번호까지 다 있는데 넣을 화면이 없어서, 실제로 넣으려면
 *   사람이 DB 를 직접 만져야 했다. 만들어 놓고 안 이은 기능은 없는 기능이다.
 *
 * 길을 내면서 같이 지켜야 하는 것이 있다. **비밀은 들어가기만 한다.**
 * 「확인용으로 한 번만 보여 주자」가 생기는 순간 그 길이 곧 유출 경로가 된다.
 *
 * 이 가드가 보는 것은 넷이다.
 *
 * 1. 저장 창구가 서버 액션이고 소유자 확인을 지난다
 * 2. 비밀이 **화면으로 돌아오지 않는다** — 돌려주는 것은 성공 여부뿐
 * 3. 비밀을 직접 다루지 않는다 — 봉인은 `credentials.ts` 가 하고 화면은 글자만 넘긴다
 * 4. 모의와 실전이 갈려 저장된다 — 한쪽을 넣어도 다른 쪽이 안 덮인다
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { TRADING_APP_DIR } from './app-dirs.ts'

const WEB = join(import.meta.dirname, '..', '..')
const read = (rel: string): string => readFileSync(join(WEB, rel), 'utf8')

const ACTIONS = `${TRADING_APP_DIR}/settings/actions.ts`
const PANEL = `${TRADING_APP_DIR}/settings/CredentialPanel.tsx`
const PAGE = `${TRADING_APP_DIR}/settings/page.tsx`

/** 액션 파일에서 자격증명 함수 하나만 떼어 본다 — 설정 저장 쪽과 섞어 보면 아무것도 못 가린다 */
function credentialAction(src: string): string {
  const at = src.indexOf('export async function saveTradingCredentialsAction')
  assert.ok(at > -1, '자격증명 저장 창구가 없다')
  return src.slice(at)
}

test('자격증명 저장 창구는 서버 액션이고 소유자 확인을 지난다', () => {
  const src = read(ACTIONS)
  assert.ok(src.startsWith("'use server'"), '서버 액션 파일이 아니다')

  const fn = credentialAction(src)
  const gate = fn.indexOf('await tradingAccess()')
  const write = fn.indexOf('saveTradingCredentials({')
  assert.ok(gate > -1, '소유자 확인을 안 부른다')
  assert.ok(write > -1, '저장기를 안 부른다')
  assert.ok(gate < write, '소유자 확인이 저장보다 뒤에 있다 — 그 확인은 아무것도 막지 않는다')

  let open = false
  try { readFileSync(join(WEB, 'app/api/trading/credentials/route.ts'), 'utf8'); open = true } catch { /* 없으면 정상 */ }
  assert.equal(open, false, '자격증명용 API 라우트가 생겼다 — 이 모듈은 서버 액션으로만 쓴다')
})

test('비밀이 화면으로 돌아오지 않는다', () => {
  const fn = credentialAction(read(ACTIONS))

  /**
   * 돌려주는 값에 비밀이 실릴 수 있는 자리를 본다. 결과 형은 `ok` 와 `userMessage` 둘뿐이고,
   * 반환문에 앱키·시크릿·계좌번호가 나오면 안 된다.
   */
  for (const ret of fn.match(/return \{[^}]*\}/g) ?? []) {
    assert.doesNotMatch(ret, /appKey|appSecret|accountNo/, `돌려주는 값에 비밀이 실렸다: ${ret}`)
  }
  assert.doesNotMatch(fn, /console\.(log|error|warn)\(/, '비밀을 다루는 자리에서 로그를 찍는다')

  // 상태 조회도 비밀을 안 읽는다 — 화면이 쓰는 것은 「넣었나·가린 번호·언제」뿐이다
  const page = read(PAGE)
  assert.match(page, /getTradingCredentialStatus/, '상태를 안 읽는다')
  assert.doesNotMatch(page, /loadAppCredential|openTradingSecret/, '화면이 비밀을 복호화한다')
})

test('화면은 글자만 넘긴다 — 봉인을 화면이 흉내 내지 않는다', () => {
  const panel = read(PANEL)
  assert.doesNotMatch(panel, /sealTradingSecret|openTradingSecret|crypto/, '화면이 암호화를 직접 한다')
  assert.match(panel, /type="password"/, '비밀 입력칸이 그대로 보인다')

  /** 저장 뒤 입력칸을 비운다 — 화면에 남겨 두면 그 자체가 새는 자리다 */
  assert.match(panel, /setAppKey\(''\); setAppSecret\(''\)/, '저장 뒤 입력칸을 안 비운다')
})

test('모의와 실전이 갈려 저장된다', () => {
  const fn = credentialAction(read(ACTIONS))
  assert.match(fn, /env !== 'real' && env !== 'paper'/, '모르는 환경을 그대로 받는다')
  assert.match(fn, /env: env as KisEnv/, '환경을 저장기에 안 넘긴다 — 한쪽이 다른 쪽을 덮는다')

  const panel = read(PANEL)
  assert.match(panel, /rows\.map\(\(row\) => <EnvForm/, '환경마다 칸을 안 그린다')
  const page = read(PAGE)
  assert.match(page, /env: 'paper' as const/, '모의 환경 상태를 안 읽는다')
  assert.match(page, /env: 'real' as const/, '실전 환경 상태를 안 읽는다')
})

test('등록 여부를 화면이 말한다 — 빈 칸만 보여 주지 않는다', () => {
  const panel = read(PANEL)
  assert.match(panel, /configured \? '등록됨' : '아직 없음'/, '넣었는지 안 넣었는지를 안 말한다')
  assert.match(panel, /accountMask/, '어느 계좌인지를 안 말한다')
})
