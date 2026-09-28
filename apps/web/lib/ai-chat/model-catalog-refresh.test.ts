/**
 * 모델 목록 받아 오기 — **일과 관문을 갈랐는가**
 *
 * 이 일은 관리자 전용 창구 안에 있었다. 그래서 AI 트레이딩 소유자는 자기 판단 모델 목록을
 * 받아 올 길이 없었고, `ai_model_catalog` 의 jev 모델이 **0개**인 채로 남았다 —
 * 화면은 「다른 모델을 고르세요」라고 말하는데 고를 것이 하나도 없었다 (실측 2026-09-28).
 *
 * 모듈 자체는 `server-only` 라 여기서 못 연다. 그래서 **글로 센다** — 관문이 어느 쪽에
 * 남아 있는지, 밖에서 온 값을 어디서 거르는지는 글로도 셀 수 있다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { JUDGE_PROVIDERS } from '../trading/settings/registry.ts'
import { TRADING_APP_DIR } from '../policy/app-dirs.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const WEB = join(HERE, '..', '..')
const CORE = readFileSync(join(HERE, 'model-catalog-refresh.ts'), 'utf8')
const ADMIN = readFileSync(join(WEB, 'app', '(ai)', 'ai', 'actions.ts'), 'utf8')
const TRADING = readFileSync(join(WEB, TRADING_APP_DIR, 'settings', 'actions.ts'), 'utf8')

/** 함수 하나의 몸통을 잘라 낸다 — 이름이 파일 아무 데나 있는 것과 그 안에 있는 것은 다르다 */
function bodyOf(src: string, name: string): string {
  const at = src.indexOf(`export async function ${name}`)
  assert.ok(at > 0, `${name} 창구가 없다`)
  const end = src.indexOf('\n}\n', at)
  return src.slice(at, end === -1 ? undefined : end)
}

/* ── 일은 한 곳, 관문은 부르는 쪽 ─────────────────────── */

test('★ 목록을 받아 채우는 일이 한 곳에 있고 창구 둘이 그것을 부른다', () => {
  assert.match(CORE, /export async function refreshCatalogFor\(/, '공통 자리가 없다')
  assert.match(bodyOf(ADMIN, 'refreshModelCatalog'), /refreshCatalogFor\(/, '관리자 창구가 안 부른다')
  assert.match(bodyOf(TRADING, 'refreshJudgeModels'), /refreshCatalogFor\(/, '트레이딩 창구가 안 부른다')
  // 같은 일을 두 벌 안 적는다 — 창구 쪽에 표 쓰기가 남아 있으면 갈린다
  for (const [name, src] of [['관리자', ADMIN], ['트레이딩', TRADING]] as const) {
    const body = bodyOf(src, name === '관리자' ? 'refreshModelCatalog' : 'refreshJudgeModels')
    assert.equal(/ai_model_catalog/.test(body), false, `${name} 창구가 카탈로그를 직접 쓴다`)
  }
})

test('★ 일하는 자리는 아무 확인도 안 한다 — 확인은 창구가 한다 (S2)', () => {
  assert.equal(/tradingAccess|getCtx\(|관리자 권한이 필요/.test(CORE), false,
    '일하는 자리가 관문을 들고 있다 — 그러면 창구마다 다른 문을 못 건다')
  // 그래서 서버 액션에서만 부를 수 있어야 한다
  assert.match(CORE, /^import 'server-only'$/m, '확인 없는 자리가 화면으로 끌려갈 수 있다')
})

/* ── 트레이딩 창구 (S2 · S3) ──────────────────────────── */

test('★ 트레이딩 창구는 첫 줄이 소유자 확인이다 (S2)', () => {
  const body = bodyOf(TRADING, 'refreshJudgeModels')
  assert.match(body, /tradingAccess\(\)/, '소유자 확인을 안 한다')
  assert.ok(body.indexOf('tradingAccess()') < body.indexOf('refreshCatalogFor('),
    '확인보다 먼저 일한다')
  assert.ok(body.indexOf('tradingAccess()') < body.indexOf('createAdminClient('),
    '확인보다 먼저 서비스롤을 연다 — RLS 를 통째로 지나간다')
  // 관리자 전용 창구를 그대로 부르면 소유자가 관리자가 아닌 날 통째로 막힌다
  assert.equal(/refreshModelCatalog\(/.test(TRADING), false, '관리자 창구를 직접 부른다')
})

test('★ 밖에서 온 공급자 이름은 등재된 목록으로만 거른다', () => {
  const body = bodyOf(TRADING, 'refreshJudgeModels')
  assert.match(body, /JUDGE_PROVIDERS\.includes\(provider\)/, '아무 공급자나 받는다')
  assert.ok(body.indexOf('JUDGE_PROVIDERS.includes') < body.indexOf('refreshCatalogFor('),
    '거르기보다 먼저 일한다')
  assert.ok(JUDGE_PROVIDERS.length > 0, '판단에 쓸 공급자가 하나도 없다')
})

test('★ 키가 응답에 안 실린다 (S3)', () => {
  const body = bodyOf(TRADING, 'refreshJudgeModels')
  assert.equal(/apiKey/.test(body), false, '키를 응답에 담는다')
  // 돌려주는 것은 개수와 사람 말뿐이다
  assert.match(body, /count: r\.count/, '받은 개수를 안 말한다')
  assert.match(body, /userMessage/, '사람 말을 안 돌려준다')
  // 값으로 돌려준다 — 이탈하면 화면이 undefined 를 받고 진행 표시가 안 꺼진다 (B-3)
  assert.equal(/redirect\(/.test(body), false, '서버 액션이 이탈한다')
  assert.match(body, /catch \(error\)/, '실패를 값으로 안 돌려준다 (B-4)')
})

/* ── 관문 뒤 391개를 전부 찌르지 않는다 ───────────────── */

test('★ 고르기용으로 받을 때는 모델마다 찔러 보지 않는다', () => {
  assert.match(CORE, /const wantProbe = options\?\.probe !== false/, '찌를지를 못 고른다')
  assert.match(CORE, /wantProbe\s*\n?\s*\?\s*await probeModelIdsAcrossKeys/, '고르는 값을 안 쓴다')
  assert.match(bodyOf(TRADING, 'refreshJudgeModels'), /probe: false/,
    '관문 뒤 391개를 전부 부른다 — 목록 한 번에 391번이다')
})

/**
 * **목록과 판단이 같은 키를 봐야 한다.**
 *
 * 여기서 META 를 직접 읽으면 그 길은 판(운영·개발)을 안 본다. 그러면 개발 판에서
 * 「목록은 받아지는데 판단은 안 도는」 상태가 만들어지고, 화면은 한 가지 말을 못 한다.
 */
test('★ 키를 고르는 자리 하나에서 받는다 — 목록과 판단이 같은 답을 본다', () => {
  assert.match(CORE, /resolveProviderKey\(/, '키를 딴 데서 집는다')
  assert.equal(/getProviderConfig\s*\(|gemini_api_key/.test(CORE), false,
    'META 를 직접 읽는다 — 판을 안 보는 길이다')
  // 못 쓰는 이유는 그 자리의 말로 돌려준다 — 「키가 없다」와 「이 판에서는 안 쓴다」가 다르다
  assert.match(CORE, /messageFor\(choice\)/, '못 쓰는 이유를 안 말한다')
})

test('★ 관리자 창구의 지금 동작은 안 바뀐다 — 찔러 보기가 기본이다', () => {
  const body = bodyOf(ADMIN, 'refreshModelCatalog')
  assert.equal(/probe:/.test(body), false, '관리자 쪽이 찔러 보기를 껐다')
  assert.match(body, /getCtx\(\)/, '관리자 확인이 사라졌다')
  assert.match(body, /revalidatePath\('\/ai'\)/, '화면 갱신이 사라졌다')
})
