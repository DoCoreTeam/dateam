/**
 * 배선 가드 — 만들어놓고 안 부르는 것을 막는다 (dacrm 정정판)
 *
 * **이 저장소가 반복한 사고**: 기능을 완성하고 테스트도 통과시켰는데
 * **부르는 곳이 없어서** 사용자에게는 아무 일도 일어나지 않는 것.
 * 화면에는 버튼이 있고 설정에는 입력창이 있으니 아무도 이상하다고 생각하지 않는다.
 *
 * 실제로 있었던 것들:
 *   · `syncGmail()` — 완성·테스트 통과, 호출처는 테스트뿐. 계정을 연결해도 메일이 영영 안 들어왔다
 *   · `createSuggestion()` — 인박스를 채우는 유일한 함수인데 생산 호출 0. 인박스가 구조적으로 빈 화면이었다
 *   · `stt.api_key` — 설정에 입력창이 있는데 읽는 코드 0. 키를 넣어도 아무 일도 없었다
 *
 * 그래서 이 가드는 "함수가 있는가"가 아니라 **"프로덕션 코드가 그것을 부르는가"**를 본다.
 * 테스트에서만 불리는 것은 안 불리는 것과 같다 — 사용자는 테스트를 실행하지 않는다.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..', '..')

/** 프로덕션 코드만 — 테스트는 호출처로 치지 않는다 */
function productionFiles(): string[] {
  const out: string[] = []
  const skip = new Set(['node_modules', '.next', 'tests', 'e2e', 'prisma'])

  function walk(dir: string) {
    for (const name of readdirSync(dir)) {
      if (skip.has(name)) continue
      const full = join(dir, name)
      if (statSync(full).isDirectory()) { walk(full); continue }
      if (!/\.(ts|tsx)$/.test(name)) continue
      if (/\.test\.tsx?$/.test(name)) continue
      out.push(full)
    }
  }
  for (const top of ['lib', 'app', 'components', 'scripts']) {
    try { walk(join(ROOT, top)) } catch { /* 없는 폴더는 넘어간다 */ }
  }
  return out
}

const FILES = productionFiles()

/** 정의한 파일 자신은 호출처가 아니다 — 자기 자신을 부른 것으로 세면 가드가 아무것도 안 막는다 */
function callersOf(symbol: string, definedIn: string): string[] {
  const re = new RegExp(`\\b${symbol}\\s*\\(`)
  return FILES.filter((f) => !f.endsWith(definedIn) && re.test(readFileSync(f, 'utf8')))
}

/**
 * 사용자에게 닿으려면 반드시 프로덕션에서 불려야 하는 것들.
 *
 * 새 기능을 만들 때 여기에 한 줄 추가한다 — 그러면 배선을 잊었을 때 커밋 전에 걸린다.
 */
const MUST_BE_WIRED: { symbol: string; definedIn: string; why: string }[] = [
  {
    symbol: 'syncGmail', definedIn: 'lib/crm/integrations/gmail.ts',
    why: '계정을 연결해도 메일이 안 들어온다',
  },
  {
    symbol: 'createSuggestion', definedIn: 'lib/crm/services/suggestion.ts',
    why: '인박스가 구조적으로 영원히 빈 화면이 된다',
  },
  {
    symbol: 'importLead', definedIn: 'lib/crm/services/lead-import.ts',
    why: '옛 리드를 옮길 방법이 없어 두 시스템을 계속 나란히 둬야 한다',
  },
  {
    symbol: 'mergeRecords', definedIn: 'lib/crm/services/merge.ts',
    why: '중복을 찾아 놓고 합칠 수 없다',
  },
  {
    symbol: 'buildPipelineReport', definedIn: 'lib/crm/services/report.ts',
    why: '파이프라인에 얼마가 걸려 있는지 볼 수 없다',
  },
  {
    symbol: 'listDealContacts', definedIn: 'lib/crm/services/deal-contact.ts',
    why: '딜에 누가 관여하는지 화면이 못 보여 준다',
  },
  {
    symbol: 'hostAdapter', definedIn: 'lib/crm/ai/adapters/host.ts',
    why: 'CRM 이 호스트 AI 키를 못 쓰고 mock 으로만 돈다',
  },
  {
    symbol: 'saveCrmGoogleConnection', definedIn: 'lib/crm/integrations/connect.ts',
    why: '구글 동의를 마쳐도 연결이 저장되지 않는다',
  },
  {
    symbol: 'getCrmAccessToken', definedIn: 'lib/crm/integrations/connect.ts',
    why: '토큰이 만료되면 동기화가 영영 멈춘다',
  },
]

for (const { symbol, definedIn, why } of MUST_BE_WIRED) {
  test(`★ ${symbol}() 이 프로덕션에서 불린다 — 안 불리면: ${why}`, () => {
    const callers = callersOf(symbol, definedIn)
    assert.ok(
      callers.length > 0,
      `${symbol}() 을 부르는 프로덕션 코드가 없다. 테스트만 부르는 것은 안 부르는 것과 같다.\n결과: ${why}`,
    )
  })
}

/**
 * 설정 키는 **읽는 코드가 있어야** 입력창을 띄운다.
 *
 * 읽지도 않는 값을 받으면 사용자는 넣고 나서 왜 아무 일도 안 일어나는지 모른다.
 * 그건 빈 칸보다 나쁘다 — 빈 칸은 적어도 "아직 없구나"라고 알려 준다.
 */
test('★ 설정에 노출한 키는 전부 읽는 코드가 있다 — 안 읽는 입력창은 거짓말이다', () => {
  const setting = readFileSync(join(ROOT, 'lib/crm/services/setting.ts'), 'utf8')
  /**
   * 화면에 뜨는 것은 SETTING_DEFS 뿐이다.
   * PLANNED_SETTINGS 는 "아직 안 쓴다"고 밝혀 둔 목록이라 검사 대상이 아니다 —
   * 그걸 세면 "미리 적어 두는 것" 자체를 못 하게 되고, 그러면 다들 그냥 SETTING_DEFS 에 넣는다.
   */
  const defsBlock = setting.slice(
    setting.indexOf('export const SETTING_DEFS'),
    setting.indexOf('export const PLANNED_SETTINGS'),
  )
  const keys = Array.from(defsBlock.matchAll(/key: '([\w.]+)'/g)).map((m) => m[1])
  assert.ok(keys.length > 0, '설정 키를 못 읽었다 — 가드가 헛돌고 있다')

  const unread: string[] = []
  for (const key of keys) {
    // 정의 파일 밖에서 그 키 문자열을 쓰는 곳이 있나
    const used = FILES.some((f) =>
      !f.endsWith('lib/crm/services/setting.ts') && readFileSync(f, 'utf8').includes(`'${key}'`))
    if (!used) unread.push(key)
  }

  assert.deepEqual(unread, [],
    `설정에 입력창은 있는데 읽는 코드가 없는 키: ${unread.join(', ')}\n` +
    '읽을 계획이 없으면 설정에서 빼야 한다 — 넣어도 아무 일이 없는 칸은 사용자를 속인다.')
})

/**
 * 크론에 등록된 잡은 실재해야 한다.
 *
 * 경로를 오타 내면 크론은 조용히 404 를 받고, 아무도 그 사실을 모른다.
 */
test('크론이 부르는 경로가 실재한다 — 오타 나면 조용히 404 만 받는다', () => {
  const vercel = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8')) as {
    crons?: { path: string }[]
  }
  for (const cron of vercel.crons ?? []) {
    // /api/crm/jobs/gmail-sync → app/api/crm/jobs/gmail-sync/route.ts
    const file = join(ROOT, 'app', cron.path.replace(/^\//, ''), 'route.ts')
    assert.ok(
      FILES.some((f) => f === file),
      `크론 경로에 라우트가 없다: ${cron.path}`,
    )
  }
})
