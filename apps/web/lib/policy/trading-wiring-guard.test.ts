/**
 * **만들었는데 아무도 안 부르는 자리**를 센다
 *
 * ## 왜 생겼나 (실측 2026-09-26)
 *
 * 1-A 를 「끝냈다」고 보고한 직후 사용자가 «전체 다 구현 했다고?» 라고 물었고,
 * 세어 보니 다섯 자리가 **만들어만 놓고 아무도 안 부르는** 상태였다.
 *
 *   · `seedRegularSessions` — 세션 캘린더를 채우는 유일한 함수. 소비처 0
 *     → 캘린더가 영원히 비어 크론이 매분 `no_session_row` 로 끝났다. **봉이 한 줄도 안 쌓인다**
 *   · `aggregateBars` — 5분 봉을 만드는 함수. 단정 15개로 검증해 놓고 소비처 0
 *   · `KisClient.price` — 미결제약정을 받는 유일한 길. 소비처 0
 *
 * 단위 시험은 전부 초록이었다. **함수가 맞게 계산하는가**만 물었지
 * **그 함수가 불리기는 하는가**는 아무도 안 물었기 때문이다.
 * 더 나쁜 것은 크론을 실제로 쳐서 `no_session_row` 를 받고도 그것을 「캘린더가 비었으니 맞는 답」으로 읽은 것이다 —
 * 「비어 있는 것이 정상」이 아니라 「채우는 코드가 없다」는 신호였다.
 *
 * ## 무엇을 세나
 *
 * `lib/trading/**` 의 **값 export**(함수·상수)를 전부 모아, 그 이름이 자기 파일 밖
 * 어디에서도 안 나타나면 「안 불리는 자리」로 센다. 형(type)과 인터페이스는 안 센다 —
 * 그것은 부르는 것이 아니라 적는 것이다.
 *
 * 세는 것이 완벽할 수는 없다(이름이 같은 다른 것을 셀 수 있다). 그래도
 * **0을 0으로 두는 것보다 훨씬 낫다** — 이번 다섯은 전부 이 규칙으로 잡힌다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const TRADING = join(WEB, 'lib', 'trading')

/**
 * 안 불려도 되는 것. 적을 때는 **왜** 안 불려도 되는지 함께 적는다.
 *
 * 「아직 안 이었다」는 사유가 아니다 — 그것은 이 가드가 잡으라고 있는 상태다.
 */
const NOT_CALLED_ON_PURPOSE: Record<string, string> = {
  // 화면과 창구가 아직 안 쓰지만 설정을 바꾸는 유일한 길이다.
  // 설정 화면(1-A 골격 다음 판)이 이것을 부른다 — 그때 이 줄을 지운다
  // 신호를 내는 규칙이다. 1-C 에서 안전 게이트·신호 규칙이 붙을 때 이어진다 —
  // 1-B 는 「이 전략이 남는가」를 재는 단계라 신호를 내지 않는다(M3)
  'meetsMinimumEv': 'SR-01 신호 규칙. 1-C 에서 신호를 낼 때 이어진다',
  'checkSignalAllowed': 'SR-07 신호 규칙. 1-C 에서 신호를 낼 때 이어진다',
  'saveTradingSetting': '설정 저장의 유일한 길. 설정 편집 화면이 붙을 때 이어진다',
  'saveTradingCredentials': 'KIS 앱키 등록. 설정 화면이 붙을 때 이어진다',
  'getTradingCredentialStatus': '자격증명 등록 여부 표시. 설정 화면이 붙을 때 이어진다',
  'canSealTradingSecret': '저장 전에 암호화 가능 여부를 묻는 자리. 설정 화면이 붙을 때 이어진다',
  'isTradingOwner': '소유자만 묻고 싶을 때. 지금은 레이아웃이 tradingAccess 를 통째로 쓴다',
  'countBarsBetween': '화면이 loadTradingOverview 안에서 직접 세고 있다. 둘 중 하나로 합칠 것',
  'TICK_JOB_NAME': '실행 기록 이름. runTick 안에서만 쓰여 밖으로 안 나간다',
  'JevNotConfiguredError': 'Jev 배선 실패를 부르는 쪽이 구분할 수 있게 내보낸다',
  'TradingSecretKeyUnavailableError': '암호화 키 없음을 부르는 쪽이 구분할 수 있게 내보낸다',
  'unzipSingleEntry': '종목정보 압축 풀기. syncContracts 안에서만 쓰지만 형식이 바뀌면 여기부터 본다',
  'REGULAR_TIMES': '기본 시각표. buildRegularSession 이 쓰고 시험이 명세와 대조한다',
  'EXPIRY_TIMES': '만기일 시각표. 같은 이유',
  'MONTH_CLASS': '마스터의 월물구분코드 값. contractsOf 가 쓰고 시험이 대조한다',
  'expiryMonthsOf': '정규 분기물·미니 매월물. 백필(1-B)이 쓴다',
  'nextContractOf': '차근월물. 교체 판정(shouldRollover)에 넘길 값이라 1-B 에서 이어진다',
  'shouldRollover': '교체 규칙. 거래량 비교가 붙는 1-B 에서 이어진다',
  'isAuctionWindow': '단일가 구간 판정. 수집은 하고 판단은 안 하는 자리를 화면이 밝힐 때 쓴다',
  'isNewEntryBlocked': '개장 직후·마감 전 금지. 신호를 내는 1-C 에서 이어진다',
  'isHoldDominant': '기권 판정. 보정이 붙는 1-B 에서 이어진다',
  'RULE_SPEC': 'rule 판단기 판 번호. createRuleJudge 가 쓴다',
  'JEV_RESPONSE_SHAPE': '답 꼴. buildJevPrompt 가 쓰고 시험이 대조한다',
  'relativeCloses': '상대 종가. buildJevPrompt 가 쓰고 시험이 직접 확인한다',
  'STALE_CLAIM_MS': '이어받기 문턱. takeOverStaleClaim 이 쓴다',
  'atr': 'computeIndicators 가 쓴다. 시험이 경계를 직접 확인한다',
  'sma': 'computeIndicators 와 evaluateTriggers 가 쓴다',
  'recentRange': 'computeIndicators 가 쓴다',
  'strengthOf': 'createRuleJudge 가 쓴다. 시험이 정규화를 직접 확인한다',
  'scoreFrom': 'createRuleJudge 가 쓴다',
  'pickEffective': 'loadTradingSettings 와 access.ts 가 쓴다',
  'validateSettingSet': '설정 짝 검사. 설정 저장 화면이 붙을 때 이어진다',
  'validateSetting': 'saveTradingSetting 이 쓴다',
  'defaultSettings': 'loadTradingSettings 가 쓴다',
  'tradingSetting': 'loadTradingSettings 와 validateSetting 이 쓴다',
  'formatTradingSettingValue': '화면이 쓴다',
  'leaningLabel': '화면이 쓴다',
  'missingCount': '화면이 쓴다',
  'isDayComplete': '화면이 쓴다',
  'decideTradingAccess': 'tradingAccess 가 쓴다. 시험이 네 조합을 직접 확인한다',
  'kisHost': 'buildUrl 이 쓴다',
  'seoulDateTimeParts': 'minuteBarParams 가 쓴다',
  'seoulStampToDate': 'parseMinuteBars 가 쓴다',
  'symbolParams': 'kis-client 가 쓴다',
  'minuteBarParams': 'kis-client 가 쓴다',
  'buildUrl': 'kis-client 가 쓴다',
  'buildHeaders': 'kis-client 가 쓴다',
  'parseMinuteBars': 'kis-client 가 쓴다',
  'nextMinuteCursor': 'kis-client 가 쓴다',
  'readEnvelope': 'kis-client 가 쓴다',
  'createRateQueue': 'createKisClient 가 쓴다',
  'expiryMonthOf': 'contractsOf 가 쓴다',
  'parseIndexFutureMaster': 'syncContracts 가 쓴다',
  'contractsOf': 'syncContracts 가 쓴다',
  'frontContractOf': 'syncContracts 가 쓴다',
  'secondThursday': 'lastTradingDay 가 쓴다',
  'lastTradingDay': 'syncContracts 가 쓴다',
  'decideTokenAction': 'getAccessToken 이 쓴다',
  'COOLDOWN_HOLDER': 'token.ts 가 쓴다',
  'COOLDOWN_MS': 'token.ts 가 쓴다',
  'REISSUE_LOCK_MS': 'token.ts 가 쓴다',
  'decideBarConfirmation': 'tick 이 쓴다',
  'targetMinuteFor': 'tick 이 쓴다',
  'TIMEFRAME_MINUTES': 'aggregateBars 가 쓴다',
  'computeIndicators': 'tick 이 쓴다',
  'evaluateTriggers': 'tick 이 쓴다',
  'requiredBarCount': 'tick 이 쓴다',
  'createRuleJudge': 'tick 이 쓴다',
  'createJevJudge': 'jev.ts 가 쓴다',
  'JevBudgetDeniedError': 'jev.ts 가 쓴다',
  'buildJevPrompt': 'jev-core 가 쓴다',
  'parseJevResponse': 'jev-core 가 쓴다',
  'JEV_PROMPT_VERSION': 'jev-core 가 쓴다',
  'createServerJevJudge': 'tick 이 쓴다',
  'scheduledMinuteOf': 'runTick 이 쓴다',
  'runJudges': 'tick 이 쓴다',
  'RUN_BUDGET_MS': 'runJudges 가 쓴다',
  'claimJudgment': 'tick 이 쓴다',
  'takeOverStaleClaim': 'tick 이 쓴다',
  'finishJudgment': 'tick 이 쓴다',
  'startJobRun': 'runTick 이 쓴다',
  'finishJobRun': 'runTick 이 쓴다',
  'runTick': '크론 라우트가 쓴다',
  'loadTradingSettings': 'tick 과 화면이 쓴다',
  'loadSessionWindow': 'tick 과 overview 가 쓴다',
  'isContinuousTrading': 'tick 이 쓴다',
  'syncContracts': 'tick 이 쓴다',
  'getAccessToken': 'tick 이 쓴다',
  'loadAppCredential': 'tick 과 token 이 쓴다',
  'createKisClient': 'tick 이 쓴다',
  'saveBars': 'tick 이 쓴다',
  'loadBarsAsOf': 'tick 이 쓴다',
  'tradingAccess': '레이아웃이 쓴다',
  'loadTradingOverview': '화면이 쓴다',
  'TRADING_SETTINGS': '화면과 시험이 쓴다',
  'TRADING_GROUP_LABEL': '화면이 쓴다',
  'TRADING_USED_FROM_LABEL': '화면이 쓴다',
  'JUDGE_LABEL': '화면이 쓴다',
  'JUDGMENT_STATUS_LABEL': '화면이 쓴다',
  'sealTradingSecret': 'token 과 credentials 가 쓴다',
  'openTradingSecret': 'token 과 credentials 가 쓴다',
  'maskAccountNo': 'credentials 가 쓴다',
  'KIS_QUOTATIONS': 'kis-request 와 시험이 쓴다',
  'KIS_HOST_REAL': 'kisHost 와 시험이 쓴다',
  'KIS_HOST_PAPER': 'kisHost 와 시험이 쓴다',
  'KIS_TOKEN_PATH': 'token 이 쓴다',
  'KIS_TOKEN_RATE_LIMIT_CODE': 'token 이 쓴다',
  'KIS_INDEX_FUTURE_MASTER_URL': 'sync 가 쓴다',
  'FID_MARKET_INDEX_FUTURES': 'kis-request 가 쓴다',
  'FID_HOUR_1M': 'kis-request 가 쓴다',
}

function walk(dir: string): string[] {
  let out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) { out = out.concat(walk(full)); continue }
    if (full.endsWith('.ts') || full.endsWith('.tsx')) out.push(full)
  }
  return out
}

/** 값으로 내보낸 이름들. 형만 내보낸 것은 부르는 것이 아니라 적는 것이라 안 센다 */
function valueExports(src: string): string[] {
  const names: string[] = []
  for (const m of src.matchAll(/^export\s+(?:async\s+)?(?:function|const|class)\s+(\w+)/gm)) {
    names.push(m[1])
  }
  return names
}

/**
 * 주석을 지운다.
 *
 * **적어 둔 것은 쓴 것이 아니다.** 실측 2026-09-26: 배선을 떼고 가드를 돌렸는데 통과했다 —
 * 다른 파일 주석에 그 이름이 적혀 있었기 때문이다(「aggregateBars 는 … 만들고」).
 * 이름을 찾는 가드는 반드시 주석과 import 를 먼저 지워야 한다.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
}

/**
 * `import`·`export ... from` 줄을 지운다.
 *
 * **들여온 것은 쓴 것이 아니다.** 실측 2026-09-26: 이 가드를 깨뜨려 보려고 배선 한 줄을
 * 떼었는데 통과했다 — import 줄이 그대로 남아 이름이 「쓰인다」로 세어졌기 때문이다.
 * 이름만 보고 값이 가는지를 안 보면 가드가 제 할 일을 안 한다.
 */
function stripImports(src: string): string {
  return stripComments(src)
    .replace(/^\s*import\s+[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, ' ')
    .replace(/^\s*import\s+['"][^'"]+['"];?\s*$/gm, ' ')
    .replace(/^\s*export\s+(?:type\s+)?\{[\s\S]*?\}\s+from\s+['"][^'"]+['"];?\s*$/gm, ' ')
}

/**
 * 이 이름을 **부르거나 읽는** 자리가 운영 코드 어딘가에 있나.
 *
 * 자기 파일 안도 센다 — 한 파일 안에서 작은 함수로 쪼개 놓고 겉으로 하나만 내보내는 것은
 * 정상이고, 그것을 「안 불린다」로 세면 쪼갤수록 가드가 시끄러워져 결국 무시당한다.
 * 다만 **선언 줄 자체는 빼고** 센다 — 안 그러면 모든 이름이 자기 선언으로 통과한다.
 */
function usedAnywhere(name: string, ownFile: string, files: readonly string[]): boolean {
  const word = new RegExp(`\\b${name}\\b`)
  const declaration = new RegExp(`^export\\s+(?:async\\s+)?(?:function|const|class)\\s+${name}\\b`)
  for (const file of files) {
    const src = stripImports(readFileSync(file, 'utf8'))
    if (file !== ownFile) {
      if (word.test(src)) return true
      continue
    }
    // 자기 파일은 선언 줄을 뺀 나머지에서 찾는다
    const rest = src.split('\n').filter((line) => !declaration.test(line)).join('\n')
    if (word.test(rest)) return true
  }
  return false
}

test('★ lib/trading 에 만들어만 놓고 아무도 안 부르는 자리가 없다', () => {
  const tradingFiles = walk(TRADING)
  // 부르는 쪽은 트레이딩 밖에도 있다(화면·라우트). 앱 전체를 훑는다
  /**
   * **시험 파일은 소비처가 아니다.**
   *
   * 이번 구멍이 정확히 그 모양이었다 — `aggregateBars` 는 단정 15개로 검증돼 있었고
   * 그래서 「쓰이고 있다」처럼 보였지만, 부르는 것은 시험뿐이고 운영 경로에는 없었다.
   * 시험을 소비처로 세면 이 가드는 자기가 잡아야 할 것을 정확히 놓친다.
   */
  const consumers = [...walk(join(WEB, 'lib')), ...walk(join(WEB, 'app'))]
    .filter((f) => !f.endsWith('.test.ts') && !f.endsWith('.test.tsx'))

  const orphans: string[] = []
  for (const file of tradingFiles) {
    if (file.endsWith('.test.ts')) continue
    const src = readFileSync(file, 'utf8')
    for (const name of valueExports(src)) {
      if (usedAnywhere(name, file, consumers)) continue
      if (NOT_CALLED_ON_PURPOSE[name]) continue
      orphans.push(`${relative(WEB, file)} 의 ${name}`)
    }
  }

  assert.deepEqual(
    orphans, [],
    `만들어만 놓고 아무도 안 부르는 자리가 ${orphans.length}개다:\n  ${orphans.join('\n  ')}\n\n` +
      `단위 시험이 초록인 것과 그 함수가 불리는 것은 다른 사실이다.\n` +
      `이었거나, 정말 안 불려도 되면 NOT_CALLED_ON_PURPOSE 에 **왜**를 적는다.\n` +
      `「아직 안 이었다」는 사유가 아니다 — 그것이 이 가드가 잡으라고 있는 상태다.`,
  )
})

test('규칙이 실제로 도는 대상이 있다 — 0개면 위 단정은 언제나 초록이다', () => {
  const files = walk(TRADING).filter((f) => !f.endsWith('.test.ts'))
  assert.ok(files.length >= 20, `검사 대상이 ${files.length}개뿐이다. 경로가 바뀌었는지 확인한다`)
  const exported = files.flatMap((f) => valueExports(readFileSync(f, 'utf8')))
  assert.ok(exported.length >= 50, `값 export 가 ${exported.length}개뿐이다 — 정규식이 안 맞는지 확인한다`)
})

test('면제 목록에 죽은 줄이 없다 — 지운 이름이 사유만 남기지 않게', () => {
  const declared = new Set(
    walk(TRADING).filter((f) => !f.endsWith('.test.ts'))
      .flatMap((f) => valueExports(readFileSync(f, 'utf8'))),
  )
  const stale = Object.keys(NOT_CALLED_ON_PURPOSE).filter((n) => !declared.has(n))
  assert.deepEqual(stale, [], `없는 이름이 면제 목록에 남아 있다: ${stale.join(', ')}`)
})

// ── 이름 말고 **자리**를 보는 두 가지 ─────────────────────────
//
// 위 단정은 값 export 의 이름을 센다. 그 그물을 두 가지가 빠져나갔고
// 둘 다 이 저장소에서 실제로 오래 살아 있었다 (실측 2026-09-26).
//
//   ① **객체 메서드** — `createAccountClient` 는 불렸으니 초록이었는데,
//      그것이 돌려주는 `fills`·`openOrders`·`deposit` 는 **아무도 안 불렀다.**
//      1-C 가 「KIS 체결 인식·대조, 손익 기록」을 만들었다고 적어 두었지만
//      `trading_fills` 는 한 줄도 없었고 실현 손익은 언제나 0원이었다.
//
//   ② **고정값으로 넘기는 인자** — `runWatch({ closedTrades: [], stopPrice: null, ... })`.
//      부르는 꼴은 완벽하다. 값이 없을 뿐이다. 그래서 손절 이탈 알림이
//      **구조적으로 한 번도 못 나갔다** — 손절가가 늘 null 이라 판정 자체를 안 했다.
//
// 가드는 이름을 보면 안 되고 **값이 가는지**를 봐야 한다.

/** 공장이 돌려주는 창구 인터페이스 이름들. `export function createX(...): Y` 의 Y */
function clientInterfaces(files: readonly string[]): { iface: string; file: string }[] {
  const out: { iface: string; file: string }[] = []
  for (const file of files) {
    const src = stripComments(readFileSync(file, 'utf8'))
    for (const m of src.matchAll(/^export function create\w+\([^)]*\):\s*(\w+)\s*\{/gm)) {
      out.push({ iface: m[1], file })
    }
  }
  return out
}

/** `export interface X { m(...): ... }` 의 메서드 이름들 */
function interfaceMethods(src: string, name: string): string[] {
  const start = src.indexOf(`export interface ${name} {`)
  if (start < 0) return []
  const end = src.indexOf('\n}', start)
  if (end < 0) return []
  const body = stripComments(src.slice(start, end))
  return [...body.matchAll(/^\s{2}(\w+)\s*\(/gm)].map((m) => m[1])
}

/**
 * 안 불려도 되는 메서드. **왜**를 적는다.
 *
 * 콜백 묶음(부르는 쪽이 넘기고 받는 쪽이 부르는 것)은 여기 오지 않는다 —
 * 공장이 돌려주는 인터페이스만 보기 때문에 `BacktestParams`·`TickPorts` 는 애초에 대상이 아니다.
 */
const METHOD_NOT_CALLED_ON_PURPOSE: Record<string, string> = {
  'RateQueue.totalWaitedMs': '속도 제한에 기다린 시간. 실행 기록에 실을 자리를 정하기 전까지 재기만 한다',
}

test('★ 공장이 돌려주는 창구의 메서드가 전부 불린다 — 이름만 보면 안 보인다', () => {
  const tradingFiles = walk(TRADING).filter((f) => !f.endsWith('.test.ts'))
  const consumers = [...walk(join(WEB, 'lib')), ...walk(join(WEB, 'app'))]
    .filter((f) => !f.endsWith('.test.ts') && !f.endsWith('.test.tsx'))

  const clients = clientInterfaces(tradingFiles)
  assert.ok(clients.length >= 3,
    `공장을 ${clients.length}개밖에 못 찾았다. 정규식이 안 맞는지 확인한다`)

  const orphans: string[] = []
  let checked = 0
  for (const { iface, file } of clients) {
    const methods = interfaceMethods(readFileSync(file, 'utf8'), iface)
    for (const method of methods) {
      checked += 1
      if (METHOD_NOT_CALLED_ON_PURPOSE[`${iface}.${method}`]) continue
      /**
       * **`.이름(` 으로 찾는다.** 구현 자리는 `async fills(tradeDate) {` 라 안 걸리고,
       * 부르는 자리만 `account.fills(` 로 걸린다. 이름만 찾으면 구현이 자기를 통과시킨다.
       */
      const call = new RegExp(`\\.${method}\\s*\\(`)
      const called = consumers.some((f) => call.test(stripImports(readFileSync(f, 'utf8'))))
      if (!called) orphans.push(`${relative(WEB, file)} 의 ${iface}.${method}`)
    }
  }
  assert.ok(checked >= 8, `메서드를 ${checked}개밖에 못 찾았다 — 본문 자르기가 틀렸는지 확인한다`)
  assert.deepEqual(orphans, [],
    `만들어만 놓고 아무도 안 부르는 창구가 ${orphans.length}개다:\n  ${orphans.join('\n  ')}\n\n`
      + `공장이 불린다고 그 창구가 쓰이는 것은 아니다. 배선하거나, 왜 안 불려도 되는지 적는다.`)
})

// ── 고정값으로 넘기는 자리 ───────────────────────────────────

/** 괄호 균형으로 `이름({ ... })` 의 인자 덩어리를 통째로 잘라 낸다 */
function callArgument(src: string, callee: string): string | null {
  const at = src.indexOf(`${callee}({`)
  if (at < 0) return null
  let depth = 0
  for (let i = src.indexOf('{', at); i < src.length; i += 1) {
    if (src[i] === '{') depth += 1
    else if (src[i] === '}') {
      depth -= 1
      if (depth === 0) return src.slice(at, i + 1)
    }
  }
  return null
}

/** `이름: 고정값` 인 줄들. 중첩 객체 안까지 본다 */
function literalProps(argument: string): string[] {
  const code = argument.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
  const literal = /^\s*(\w+):\s*(null|false|true|0|\[\]|''|""),?\s*$/gm
  return [...code.matchAll(literal)].map((m) => `${m[1]}=${m[2]}`)
}

/**
 * 고정값으로 남겨도 되는 자리. **무엇을 재야 하는지 알면서 안 재는 것은 여기 못 온다.**
 *
 * 「아직 안 이었다」는 사유가 아니다. 그것이 이 가드가 잡으라고 있는 상태다.
 */
const LITERAL_ON_PURPOSE: Record<string, string> = {
  // 게이트 값 — 아직 재는 길이 없고, 재는 날 measure.ts 에 붙인다
  'runWatch.marketAbnormal=false': '서킷브레이커·사이드카를 주는 창구를 아직 안 붙였다',
  'runWatch.notifyFailureStreak=0': 'runWatch 가 안에서 recentNotifications 로 다시 센다. 여기 값은 안 쓴다',
  /**
   * 평가 손익은 **일부러** 안 넣는다. 한도가 보는 것은 실현이고(§8 D-32),
   * 평가를 섞으면 들고 있는 것이 오르내릴 때마다 새 신호가 멈췄다 풀렸다 한다.
   */
  'runWatch.unrealizedKrw=null': '한도는 실현만 본다 (§8 D-32). 평가를 섞으면 신호가 깜빡인다',
  'runWatch.brokerWasFailing=false': '직전 실행의 증권사 상태는 measureGate 가 세고, 복구 대조는 그 값을 아직 안 쓴다',
  'runWatch.reconciledSinceRecovery=false': '위와 한 쌍이다. 복구 대조를 붙이는 날 함께 채운다',
}

test('★ 감시와 주문에 고정값을 안 넘긴다 — 부르는 꼴은 완벽한데 값이 없던 자리', () => {
  const tick = readFileSync(join(TRADING, 'jobs', 'tick.ts'), 'utf8')

  const found: string[] = []
  let scanned = 0
  for (const callee of ['runWatch', 'runOrderJob']) {
    const argument = callArgument(tick, callee)
    assert.ok(argument, `${callee}({ ... }) 호출을 못 찾았다 — 부르는 꼴이 바뀌었는지 확인한다`)
    scanned += 1
    for (const prop of literalProps(argument as string)) {
      if (LITERAL_ON_PURPOSE[`${callee}.${prop}`]) continue
      found.push(`${callee} 의 ${prop}`)
    }
  }
  assert.equal(scanned, 2, '두 호출을 다 봐야 한다')

  assert.deepEqual(found, [],
    `재야 할 값을 고정값으로 넘기는 자리가 ${found.length}개다:\n  ${found.join('\n  ')}\n\n`
      + `부르는 꼴이 맞다고 값이 가는 것은 아니다. 재거나, 왜 못 재는지 LITERAL_ON_PURPOSE 에 적는다.`)
})

test('면제 목록 둘에 죽은 줄이 없다', () => {
  const tick = readFileSync(join(TRADING, 'jobs', 'tick.ts'), 'utf8')
  const live = new Set<string>()
  for (const callee of ['runWatch', 'runOrderJob']) {
    const argument = callArgument(tick, callee)
    if (!argument) continue
    for (const prop of literalProps(argument)) live.add(`${callee}.${prop}`)
  }
  assert.deepEqual(
    Object.keys(LITERAL_ON_PURPOSE).filter((k) => !live.has(k)), [],
    '이미 재고 있는 자리가 면제 목록에 남아 있다',
  )

  const tradingFiles = walk(TRADING).filter((f) => !f.endsWith('.test.ts'))
  const declared = new Set<string>()
  for (const { iface, file } of clientInterfaces(tradingFiles)) {
    for (const m of interfaceMethods(readFileSync(file, 'utf8'), iface)) declared.add(`${iface}.${m}`)
  }
  assert.deepEqual(
    Object.keys(METHOD_NOT_CALLED_ON_PURPOSE).filter((k) => !declared.has(k)), [],
    '없는 메서드가 면제 목록에 남아 있다',
  )
})
