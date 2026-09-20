import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { backTarget, linkWithBack, hereNow, withBackIfDetail } from './back-link.ts'
import { navLabelOf } from './groups.ts'

const params = (o: Record<string, string>) => ({ get: (k: string) => o[k] ?? null })
const FALLBACK = { href: '/crm/deals', label: '딜 목록' }

test('돌아갈 곳이 없으면 목록으로 — 화면이 이름을 지어내지 않는다', () => {
  assert.deepEqual(backTarget(params({}), FALLBACK), FALLBACK)
})

test('실려 온 곳이 있으면 그리로 가고, 이름도 함께 온다', () => {
  const t = backTarget(params({ returnTo: '/crm/deals/abc', returnLabel: '수원시청' }), FALLBACK)
  assert.deepEqual(t, { href: '/crm/deals/abc', label: '수원시청' })
})

test('이름이 없으면 「돌아가기」 — 빈 이름을 그리지 않는다', () => {
  const t = backTarget(params({ returnTo: '/crm/deals/abc' }), FALLBACK)
  assert.equal(t.label, '돌아가기')
})

test('★ 바깥 주소로는 안 보낸다 — 열린 리다이렉트 차단', () => {
  for (const bad of ['https://evil.example.com', '//evil.example.com', '/\\evil', 'http://x.kr/a']) {
    const t = backTarget(params({ returnTo: bad }), FALLBACK)
    assert.deepEqual(t, FALLBACK, `${bad} 가 통과했다`)
  }
})

test('개행이 섞인 주소도 막는다 — 헤더 분리 공격', () => {
  const t = backTarget(params({ returnTo: '/crm/a\r\nSet-Cookie: x=1' }), FALLBACK)
  assert.deepEqual(t, FALLBACK)
})

test('링크에 «여기»와 이름을 함께 싣는다', () => {
  const href = linkWithBack('/crm/companies/c1', { path: '/crm/deals/d1?tab=x', label: '수원시청' })
  assert.ok(href.startsWith('/crm/companies/c1?'))
  assert.ok(href.includes('returnTo='))
  assert.ok(href.includes('returnLabel='))
  // 원래 쿼리(탭·필터)가 살아 있어야 돌아갔을 때 같은 화면이다
  assert.ok(decodeURIComponent(href).includes('/crm/deals/d1?tab=x'))
})

test('이미 쿼리가 있는 주소에도 붙는다 — ? 가 두 번 들어가지 않는다', () => {
  const href = linkWithBack('/crm/companies/c1?view=x', { path: '/crm/deals/d1', label: 'A' })
  assert.equal((href.match(/\?/g) ?? []).length, 1)
})

/*
  ── 들어온 곳으로 돌아가나 (전수) ──────────────────────────────

  **왜 전수인가**: 「딜에서 연 견적에서 뒤로 갔더니 견적 목록으로 떨어진다」는 지적이
  2026-09-20 에 왔는데, 같은 모양이 그 자리 하나가 아니었다. 할 일·오늘·리포트·미팅 상세에서
  다른 상세로 가는 링크가 전부 맨 주소였다 — 한 자리만 고치면 다음 주에 다른 자리에서
  같은 말을 듣는다(정책: 같은 성격의 자리는 한 벌로 고친다).

  **규칙**: 상세나 허브에서 다른 «상세»로 가는 링크는 `linkWithBack` 으로 지금 화면을 싣는다.
  목록 화면의 줄 링크(`rowHref`)는 예외다 — 그 화면의 기본 돌아갈 곳이 곧 그 목록이라
  실어 보낼 것이 없고, 실으면 주소만 길어진다.
*/

import { readdirSync, statSync } from 'node:fs'
import { join, dirname as dirOf, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const WEB = join(dirOf(fileURLToPath(import.meta.url)), '..', '..', '..')

/** 상세 주소를 만드는 링크. 템플릿 문자열에 id 가 들어가는 모양만 본다 */
const DETAIL_LINK = /(?:href=\{?|rowHref=\{?)[^\n]*`\/crm\/(?:deals|companies|people|meetings|quotes)\/\$\{/

/**
 * 실어 보낼 것이 없는 자리. **이유를 적는다** —
 * 이유 없이 늘어나면 예외 목록이 규칙을 먹는다.
 */
const EXCEPTIONS: { file: string; must: string; why: string }[] = [
  { file: 'app/(crm)/crm/quotes/QuoteListView.tsx', must: 'rowHref', why: '견적 목록의 줄 — 기본 돌아갈 곳이 곧 이 목록이다' },
  { file: 'app/(crm)/crm/deals/DealTableView.tsx', must: 'rowHref', why: '딜 목록의 줄' },
  { file: 'app/(crm)/crm/people/PersonListView.tsx', must: 'rowHref', why: '인물 목록의 줄' },
  { file: 'app/(crm)/crm/companies/CompanyListView.tsx', must: 'rowHref', why: '회사 목록의 줄' },
  { file: 'app/(crm)/crm/meetings/MeetingsClient.tsx', must: 'rowHref', why: '미팅 목록의 줄' },
  { file: 'app/(crm)/crm/deals/DealBoard.tsx', must: 'cardLink', why: '딜 보드는 딜 목록의 다른 모양이다 — 뒤로가 딜 목록이면 맞다' },
  { file: 'app/(crm)/crm/meetings/[id]/MeetingDetail.tsx', must: 'meetingId', why: '작업대가 돌아올 «자기 자신»의 주소다 — 다른 상세로 가는 링크가 아니다' },
]

function walkTsx(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walkTsx(full, out)
    else if (full.endsWith('.tsx')) out.push(full)
  }
  return out
}

test('★ 상세로 가는 링크는 들어온 곳을 싣는다 — 뒤로가 낯선 목록으로 떨어지지 않게', () => {
  const files = [join(WEB, 'app/(crm)'), join(WEB, 'components/ui/crm')].flatMap((d) => walkTsx(d))
  assert.ok(files.length > 30, `훑을 파일이 너무 적다(${files.length}) — 규칙이 헛돈다`)

  let scanned = 0
  const bare: string[] = []
  for (const file of files) {
    const rel = relative(WEB, file)
    const lines = readFileSync(file, 'utf8').split('\n')
    lines.forEach((line, i) => {
      if (!DETAIL_LINK.test(line)) return
      scanned += 1
      if (line.includes('linkWithBack')) return
      const ok = EXCEPTIONS.some((e) => e.file === rel && line.includes(e.must))
      if (!ok) bare.push(`${rel}:${i + 1}  ${line.trim().slice(0, 90)}`)
    })
  }

  // 훑은 자리가 실제로 있어야 한다 — 0이면 정규식이 아무것도 안 잡은 것이고 그건 통과가 아니다
  assert.ok(scanned >= 10, `상세로 가는 링크를 ${scanned}개밖에 못 찾았다 — 정규식이 헛돈다`)
  assert.deepEqual(
    bare,
    [],
    `들어온 곳을 안 싣는 링크\n${bare.join('\n')}\n\n` +
      `linkWithBack(href, here) 로 감싼다. 목록의 줄 링크처럼 실을 것이 없으면 EXCEPTIONS 에 이유와 함께 적는다.`,
  )
})

test('지금 화면을 돌아올 곳으로 만들 때 쿼리를 안 잃는다', () => {
  // 할 일의 범위·검색어, 리포트의 기간·탭이 전부 주소에 있다. 잃으면 돌아와서 다시 추려야 한다
  assert.deepEqual(
    hereNow('/crm/tasks', new URLSearchParams({ due: 'today', q: '납품' }), '할 일'),
    { path: '/crm/tasks?due=today&q=%EB%82%A9%ED%92%88', label: '할 일' },
  )
  // 쿼리가 없으면 ? 를 붙이지 않는다 — 빈 물음표가 붙은 주소가 남으면 비교가 어긋난다
  assert.deepEqual(hereNow('/crm/today', '', '오늘'), { path: '/crm/today', label: '오늘' })
  assert.deepEqual(hereNow('/crm/today', null, '오늘'), { path: '/crm/today', label: '오늘' })
  // 앞의 ? 는 한 번만 — 문자열로 넘어와도 같은 결과다
  assert.equal(hereNow('/crm/reports', '?period=q', 'r').path, '/crm/reports?period=q')
})

test('돌아갈 곳의 이름은 메뉴가 정한다 — 화면이 지어내지 않는다', () => {
  assert.equal(navLabelOf('/crm/tasks'), '할 일')
  assert.equal(navLabelOf('/crm/today'), '오늘')
  assert.equal(navLabelOf('/crm/reports'), '리포트')
  // 모르는 주소에 이름을 지어내지 않는다
  assert.equal(navLabelOf('/crm/nope'), '')
})

test('서버가 준 주소도 상세면 돌아올 곳을 싣는다 — 허브 주소는 그대로 둔다', () => {
  /*
    왜: 오늘 화면의 「살펴볼 것」은 주소를 서버(`lib/crm/services/attention.ts`)가 만든다.
    화면이 그대로 그리면 딜 상세로 가 놓고도 돌아올 곳이 안 실린다 — 실측으로 3건이 그랬다.
  */
  const here = { path: '/crm/today', label: '오늘' }
  assert.match(withBackIfDetail('/crm/deals/abc123', here), /^\/crm\/deals\/abc123\?returnTo=/)
  // 허브는 그대로 — 뒤로 단추가 없는 화면에 돌아올 곳을 실어 봐야 주소만 길어진다
  assert.equal(withBackIfDetail('/crm/tasks', here), '/crm/tasks')
  assert.equal(withBackIfDetail('/crm/inbox', here), '/crm/inbox')
  // 이미 쿼리가 붙은 주소는 상세로 치지 않는다 — 덧붙이면 그 쿼리의 뜻이 흐려진다
  assert.equal(withBackIfDetail('/crm/deals/abc?tab=x', here), '/crm/deals/abc?tab=x')

  // 오늘 화면이 실제로 이 함수를 쓰는지 본다 — 안 쓰면 위 단정은 혼자만 초록이다
  const today = readFileSync(join(WEB, 'app/(crm)/crm/today/TodayClient.tsx'), 'utf8')
  assert.match(today, /href=\{withBackIfDetail\(it\.href,/, '오늘 화면이 서버가 준 주소를 그대로 그린다')
})
