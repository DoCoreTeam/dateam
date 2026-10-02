/**
 * CRM 삭제 계약 가드 — 「서버에는 있는데 화면이 안 부른다」를 막는다
 *
 * **왜 있나**(v0.7.705, 사용자 지적): *"여기 삭제가 왜 하나도 없니? CRUD 기본인데
 * 눌러서 상세에 가도 없고 목록에도 없고 너무 기본이라 이건 웃음만 나오네"*
 *
 * 미팅은 지우는 **로직이 이미 다 있었다** — `DELETE /api/crm/meetings/:id` 도,
 * 소프트 삭제도, 제안 거두기도. 그런데 **화면이 한 곳도 안 불렀다.**
 * 그래서 사용자에게는 «없는 기능»이었다. 같은 부류를 그날 셋 더 찾았다:
 *   · 견적 상세 — 목록에서만 지울 수 있고 상세에는 없었다
 *   · 할 일 — 확인창이 「30일 안에 되돌릴 수 있어요」라고 약속하는데 **휴지통 보기가 없었다**
 *     (`trash=1` 도 되살리기 API 도 서버에 이미 있었다)
 *
 * 정책 §2-5 (3): *"서버액션이 이미 있는데 UI가 안 부르는 상태를 방치하지 않는다."*
 * 이 가드가 그 문장을 기계가 읽을 수 있게 만든 것이다.
 *
 * **왜 정적 검사인가**: `tsc`·`lint`·`design:check` 는 이 부류를 절대 못 본다 —
 * 안 부르는 것은 **문법 오류가 아니라 빠진 코드**다. 사람이 화면을 열어 보기 전엔 아무도 모른다.
 *
 * ## RFP 도 본다 (2026-09-30)
 *
 * 같은 지적이 RFP 에서 그대로 다시 왔다: *"CRUD 몰라? 공고 찾았으면 상관없는건
 * 제거하거나 뺄수 있는 방법이 있어야지"*. 공고 레이더가 쉰 건을 찾아 놓고 치울 길이 없었다.
 *
 * **가드는 있었는데 CRM 만 보고 있었다.** 그래서 RFP 는 규칙 밖이었고 같은 구멍이 다시 생겼다.
 * 한 번 더 그러지 않게 여기서 RFP 도 함께 센다.
 *
 * RFP 는 지우는 모양이 다르다 — 지우지 않고 **상태로 숨긴다**(`PATCH status=dismissed`).
 * 원천을 지우면 다음 훑기에 또 들어와 뺀 것이 되살아나기 때문이다.
 * 그래서 규칙을 둘로 본다: 지우는 API 가 있으면 지울 길이 있어야 하고,
 * 상태로 숨기는 창구가 있으면 **숨기는 길과 보이게 하는 길이 둘 다** 있어야 한다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'

const API_ROOT = 'app/api/crm'
const SCREEN_ROOT = 'app/(crm)/crm'

/** 화면이 «지울 수 있다»고 인정받는 방법 — 셋 중 하나면 된다 */
const DELETE_MARKS = [
  'DeleteRecordModal',   // 한 건 확인창 (상세)
  'useCrmBulk',          // 골라서 한 번에 (목록)
  "method: 'DELETE'",    // 그 화면이 직접 부르는 경우
]

/** 휴지통 보기를 갖췄나 — 부품이 하나뿐이므로 이름 하나로 판정된다 */
const TRASH_MARK = 'TRASH_FILTER'

/**
 * 화면 없이 다른 화면의 패널 안에서만 다뤄지는 하위 자원.
 *
 * 여기 적는 것은 «면제»가 아니라 **사실**이다 — `app/(crm)/crm/<이름>` 자체가 없다.
 * 나중에 화면이 생기면 이 목록과 무관하게 규칙이 걸린다(디렉터리 존재로 판정하므로).
 */
function screenDirOf(entity: string): string | null {
  const dir = join(SCREEN_ROOT, entity)
  return existsSync(dir) && statSync(dir).isDirectory() ? dir : null
}

function walkTsx(root: string, skip?: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(root)) {
    const p = join(root, name)
    if (p === skip) continue
    if (statSync(p).isDirectory()) out.push(...walkTsx(p, skip))
    else if (name.endsWith('.tsx')) out.push(p)
  }
  return out
}

/**
 * `root` 아래 어느 화면이든 이 표식을 갖고 있나.
 *
 * `skip` 은 «목록에 있나»를 물을 때 **상세 폴더를 빼기 위한 것**이다.
 * 빼지 않으면 상세의 삭제 버튼 하나가 목록 규칙까지 통과시켜서,
 * 정작 사용자가 지적한 «목록에도 없다»를 못 잡는다(가드를 일부러 깨서 확인했다).
 */
function anyHas(root: string, marks: readonly string[], skip?: string): boolean {
  return walkTsx(root, skip).some((f) => {
    const src = readFileSync(f, 'utf8')
    return marks.some((m) => src.includes(m))
  })
}

interface Entity {
  name: string
  screenDir: string
  detailDir: string | null
  hasRestoreApi: boolean
}

/** DELETE 를 받는 CRM 자원 중 **자기 화면이 있는 것**만 규칙 대상이다 */
function entitiesWithDeleteApi(): Entity[] {
  const out: Entity[] = []
  for (const name of readdirSync(API_ROOT).sort()) {
    const route = join(API_ROOT, name, '[id]', 'route.ts')
    if (!existsSync(route)) continue
    if (!readFileSync(route, 'utf8').includes('export async function DELETE')) continue

    const screenDir = screenDirOf(name)
    if (!screenDir) continue

    const detail = join(screenDir, '[id]')
    out.push({
      name,
      screenDir,
      detailDir: existsSync(detail) ? detail : null,
      hasRestoreApi: existsSync(join(API_ROOT, name, '[id]', 'restore', 'route.ts')),
    })
  }
  return out
}

test('삭제 API 가 있으면 목록 화면에서 지울 수 있어야 한다', () => {
  const missing = entitiesWithDeleteApi()
    .filter((e) => !anyHas(e.screenDir, DELETE_MARKS, e.detailDir ?? undefined))
    .map((e) => e.name)

  assert.deepEqual(missing, [], [
    '지우는 API 는 있는데 화면에 지울 길이 없다:',
    ...missing.map((n) => `  · ${n} — app/(crm)/crm/${n} 에 useCrmBulk 또는 DeleteRecordModal 을 꽂는다`),
  ].join('\n'))
})

test('상세 화면이 있으면 그 자리에서도 지울 수 있어야 한다', () => {
  // 사용자는 목록과 상세를 오가며 쓴다 — 한쪽에만 있으면 "눌러서 상세에 가도 없다"가 된다
  const missing = entitiesWithDeleteApi()
    .filter((e) => e.detailDir && !anyHas(e.detailDir, DELETE_MARKS))
    .map((e) => e.name)

  assert.deepEqual(missing, [], [
    '상세 화면에 삭제가 없다(§2-3-2 — 제목 우측이 그 자리다):',
    ...missing.map((n) => `  · ${n} — app/(crm)/crm/${n}/[id] 에 DeleteRecordModal 을 꽂는다`),
  ].join('\n'))
})

test('되살리기 API 가 있으면 화면에 휴지통 보기가 있어야 한다', () => {
  /*
    확인창이 「30일 안에 되돌릴 수 있어요」라고 약속한다.
    되돌릴 길이 화면에 없으면 그 문장은 **거짓말**이고, 소프트 삭제를 쓴 이유도 사라진다.
  */
  const missing = entitiesWithDeleteApi()
    .filter((e) => e.hasRestoreApi && !anyHas(e.screenDir, [TRASH_MARK], e.detailDir ?? undefined))
    .map((e) => e.name)

  assert.deepEqual(missing, [], [
    '되살리기 API 는 있는데 휴지통 보기가 없다:',
    ...missing.map((n) => `  · ${n} — components/ui/crm/trash 의 TRASH_FILTER 를 꽂는다`),
  ].join('\n'))
})

test('규칙이 도는 대상이 실제로 있다', () => {
  // 경로가 바뀌어 대상이 0개가 되면 위 셋은 «전부 통과»로 보인다 — 가장 위험한 실패다
  const found = entitiesWithDeleteApi()
  assert.ok(found.length >= 6, `삭제 API 를 가진 CRM 화면이 ${found.length}개뿐이다 — 경로가 바뀌었는지 확인한다`)
})


// ── RFP: 지우지 않고 상태로 빼는 목록 ───────────────────────────────

const RFP_SCREEN_ROOT = 'app/(rfp)/rfp'
const RFP_COMPONENT_ROOT = 'components/rfp'

/** 상태로 숨기는 창구 — 있으면 화면에 숨기는 길과 보이게 하는 길이 둘 다 있어야 한다 */
const RFP_DISMISS_APIS = [
  'app/api/rfp/radar/hits/[id]/route.ts',
  'app/api/rfp/radar/hits/route.ts',
]

/** 그 창구를 쓰는 화면 */
const RFP_DISMISS_SCREENS = ['components/rfp/RadarRules.tsx']

test('RFP: 상태로 숨기는 창구가 있으면 화면에 숨기는 길이 있다', () => {
  // 창구만 있고 화면이 안 부르면 사용자에게는 «없는 기능»이다 — CRM 에서 이미 겪은 그 모양이다
  const live = RFP_DISMISS_APIS.filter((f) => existsSync(f))
  assert.ok(live.length > 0, '상태로 빼는 창구가 하나도 없다 — 경로가 바뀌었는지 확인한다')

  const missing = RFP_DISMISS_SCREENS.filter((f) => {
    const src = readFileSync(f, 'utf8')
    return !src.includes("status: 'dismissed'")
  })
  assert.deepEqual(missing, [], `숨기는 창구를 안 부르는 화면: ${missing.join(', ')}`)
})

test('RFP: 숨길 수 있으면 다시 보이게 할 수 있어야 한다', () => {
  /*
    숨기기는 다시 보이게 할 수 있어야 누를 수 있다. 그 길이 없으면 사용자는 안 누르고,
    그러면 목록은 영영 안 줄어들어 기능이 있으나 마나가 된다.
    CRM 에서 「30일 안에 되돌릴 수 있어요」라고 약속해 놓고 휴지통 보기가 없던 것과 같은 자리다.
  */
  const missing = RFP_DISMISS_SCREENS.filter((f) => {
    const src = readFileSync(f, 'utf8')
    // 질의를 URLSearchParams 로 만들어도 상태는 골라 보내야 한다
    const 숨긴목록을본다 = src.includes("status: dismissed ? 'dismissed' : 'new'")
    const 다시보인다 = src.includes("status: 'new'")
    return !(숨긴목록을본다 && 다시보인다)
  })
  assert.deepEqual(missing, [], [
    '숨길 수는 있는데 다시 보이게 할 길이 없다:',
    ...missing.map((f) => `  · ${f} — 숨긴 목록 보기와 보이기를 둘 다 둔다`),
  ].join('\n'))
})

test('RFP: 목록이 있는 화면은 줄마다 글 칸을 갖춘다', () => {
  // 글 칸이 없으면 단추가 제목 길이를 따라 흩어진다(사용자 지적 2026-09-30).
  // 자세한 것은 lib/ui/rfp-list-row.test.ts 가 보고, 여기서는 **목록 화면이 규칙 밖에 안 남게** 센다
  const screens = [
    ...walkTsx(RFP_COMPONENT_ROOT),
    ...walkTsx(RFP_SCREEN_ROOT),
  ].filter((f) => readFileSync(f, 'utf8').includes('styles.ruleItem'))

  assert.ok(screens.length >= 7, `줄을 쓰는 RFP 화면이 ${screens.length}개뿐이다 — 경로가 바뀌었는지 확인한다`)

  const missing = screens.filter((f) => !readFileSync(f, 'utf8').includes('styles.ruleMain'))
  assert.deepEqual(missing, [], [
    '줄은 쓰는데 글 칸이 없다 — 단추가 제목 길이를 따라 흩어진다:',
    ...missing.map((f) => `  · ${f}`),
  ].join('\n'))
})
