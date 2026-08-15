import { test, expect, type Page } from '@playwright/test'
import { dismissGlobalModals } from './_helpers'

// 렌더된 화면의 **치수 일관성** — 전 화면 순회 검사.
//
// 왜 E2E인가: 여기서 잡는 것들은 정적 분석으로 보이지 않는다. 클래스도 토큰도 다 맞는데
//   **그려 놓고 보면 어긋나 있는** 종류다. 사용자가 직접 짚은 것들이 그랬다:
//     · "표 높이만 해도 변하자나 같은 값인데"      → /ci/inbox 행이 79 ↔ 87 ↔ 121px로 출렁였다
//     · "드롭다운이랑 버튼 쪽이랑 위아래 안맞는거"  → 셀렉트가 버튼보다 10px 아래였다(41 vs 39)
//   tsc·단위·design:check가 전부 초록인 채로 통과하던 것들이다.
//
// 왜 전 화면인가: 처음엔 이 검사기를 문제가 난 화면 2개에만 걸었다. 그러면 **다음 화면에서 같은 일이
//   또 난다**(사용자 지적: "그만큼 디테일한 검사기로 다 검사를 해야지"). 검사기는 화면 목록 전체를 돈다.

/** 검사 대상 — docs/ui-system/SWEEP-FINDINGS.md의 "확인 완료" 목록과 같은 집합. */
const SCREENS: readonly string[] = [
  // member
  '/home', '/calendar', '/deals', '/accounts', '/contacts', '/meeting-notes', '/weekly-report',
  '/kpi', '/routine', '/operations', '/lead-intake', '/work/overview', '/work/activity',
  '/work/projects', '/pricing/catalog', '/api-keys',
  // admin
  '/admin/members', '/admin/settings', '/admin/content', '/admin/api', '/admin/ai-usage',
  '/admin/ai-prompts', '/admin/daily-logs', '/admin/kpi', '/admin/reports', '/admin/routine',
  '/admin/partner-tiers', '/admin/data-quality', '/admin/org-chart', '/admin/ai-chat',
  // ci
  '/ci', '/ci/inbox', '/ci/inbox?tab=review', '/ci/boards', '/ci/trends', '/ci/assets',
  '/ci/publish', '/ci/performance', '/ci/pipeline', '/ci/settings', '/ci/studio',
  '/ci/monitoring', '/ci/my-channels',
]

interface Finding { rule: string; detail: string }

/**
 * 화면 안에서 치수 규칙을 한 번에 판정한다.
 * 브라우저 문맥에서 도는 코드라 바깥 변수를 쓰지 않는다(직렬화 경계).
 */
async function inspect(page: Page): Promise<Finding[]> {
  return page.evaluate(() => {
    const out: { rule: string; detail: string }[] = []
    const round = (n: number) => Math.round(n)
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect()
      return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'
    }
    const label = (el: Element) => {
      const t = (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 18)
      return t || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.tagName.toLowerCase()
    }

    // ① 가로 스크롤 — 표는 모바일 카드로 바뀌지 가로로 밀리지 않는다(정책).
    const scroller = document.querySelector('main.page-inner') ?? document.scrollingElement
    if (scroller && scroller.scrollWidth - scroller.clientWidth > 2) {
      out.push({ rule: '가로스크롤', detail: `본문이 가로로 ${scroller.scrollWidth - scroller.clientWidth}px 넘친다` })
    }
    // 본문이 아니라 **안쪽 래퍼**가 밀리는 경우도 같은 위반이다(정책이 금지한 `.table-responsive` 패턴).
    // 바깥만 보면 통과해 버린다 — 실제로 그렇게 놓칠 뻔했다.
    //
    // 단, **표를 담은 스크롤러만** 본다. 정책이 금지한 것은 "가로 스크롤 테이블"이지 가로 스크롤 자체가 아니다.
    // (실측 /deals: 영업 파이프라인 칸반이 단계를 옆으로 넘긴다 — 보드는 원래 그렇게 읽는 것이라 정상이다)
    for (const el of Array.from(document.querySelectorAll('main.page-inner *'))) {
      if (el.scrollWidth - el.clientWidth <= 2) continue
      if (!/auto|scroll/.test(getComputedStyle(el).overflowX)) continue
      if (!el.querySelector('table')) continue
      out.push({ rule: '가로스크롤', detail: `표를 담은 "${label(el)}" 영역이 가로로 ${el.scrollWidth - el.clientWidth}px 밀린다` })
      break
    }

    // ② 10px 미만 글씨(§3-1) — 읽을 수 없다.
    for (const el of Array.from(document.querySelectorAll('main.page-inner *'))) {
      if (!visible(el) || !(el.textContent ?? '').trim()) continue
      const fs = parseFloat(getComputedStyle(el).fontSize)
      if (fs > 0 && fs < 10) { out.push({ rule: '10px미만글씨', detail: `${round(fs)}px — "${label(el)}"` }); break }
    }

    // ③ 같은 줄에 선 입력·버튼은 높이가 같다.
    //    규약이 없으면 입력 41 · 버튼 39처럼 갈리고, 라벨이 붙은 쪽만 아래로 밀린다.
    //    textarea는 뺀다 — 높이가 `rows`로 정해지는 여러 줄 입력이라 옆 한 줄 입력보다 큰 게 정상이다
    //    (실측 /admin/content: input 44 · textarea rows=2 → 56. 이건 어긋난 게 아니다).
    const controls = Array.from(document.querySelectorAll(
      'main.page-inner .input-field, main.page-inner .btn-primary, main.page-inner .btn-ghost',
    )).filter(visible).filter((el) => el.tagName !== 'TEXTAREA')
    const bands = new Map<number, Element[]>()
    for (const el of controls) {
      const r = el.getBoundingClientRect()
      const key = Math.round((r.top + r.bottom) / 2 / 12)  // 12px 단위로 같은 줄 묶기
      const arr = bands.get(key) ?? []
      arr.push(el)
      bands.set(key, arr)
    }
    bands.forEach((els) => {
      if (els.length < 2) return
      const hs = els.map((e) => round(e.getBoundingClientRect().height))
      const gap = Math.max(...hs) - Math.min(...hs)
      if (gap > 2) {
        out.push({
          rule: '같은줄컨트롤높이',
          detail: `${gap}px 차이 — ${els.map((e, i) => `${label(e)}:${hs[i]}`).join(' / ')}`,
        })
      }
    })

    // ④ 가로로 두려던 컨트롤 묶음이 **접히면** 그 행만 커진다 = 목록 리듬이 깨진다.
    //    (실측 /admin/members: 관리 칸 135px에 버튼 5개가 5줄로 접혀 행이 216px가 됐다)
    //
    //    오탐을 두 번 걸러낸다 — 처음 판이 둘 다 틀렸다:
    //      · `flex-direction: column`은 **일부러 세로로 쌓은 것**이다(/meeting-notes 제목+작성자). 접힘이 아니다.
    //      · 같은 줄이라도 키가 다르면 `top`이 다르다(/api-keys: row·nowrap인데 2줄로 오판).
    //        줄 판정은 **세로 구간이 겹치는가**로 한다.
    for (const td of Array.from(document.querySelectorAll('table td'))) {
      for (const box of Array.from(td.children)) {
        const kids = Array.from(box.children).filter(visible)
        if (kids.length < 2) continue
        if (!kids.some((k) => /^(BUTTON|SELECT|INPUT|A)$/.test(k.tagName))) continue
        if (getComputedStyle(box).flexDirection === 'column') continue

        // 세로로 겹치면 같은 줄. 겹치지 않는 묶음이 둘 이상이면 접힌 것이다.
        const boxes = kids.map((k) => k.getBoundingClientRect()).sort((a, b) => a.top - b.top)
        let lines = 1
        let lineBottom = boxes[0].bottom
        for (const r of boxes.slice(1)) {
          if (r.top >= lineBottom - 1) { lines += 1; lineBottom = r.bottom }
          else lineBottom = Math.max(lineBottom, r.bottom)
        }
        if (lines > 1) {
          out.push({
            rule: '표셀컨트롤줄바꿈',
            detail: `"${label(td)}" 칸(${round(td.getBoundingClientRect().width)}px)의 컨트롤 ${kids.length}개가 ${lines}줄로 접혀 행이 ${round(td.closest('tr')!.getBoundingClientRect().height)}px가 됐다`,
          })
          break
        }
      }
    }

    return out
  })
}

/** 로그인/권한이 없으면 검사 자체가 무의미하다 — graceful skip. */
async function open(page: Page, path: string): Promise<boolean> {
  await page.goto(path, { waitUntil: 'domcontentloaded' })
  if (page.url().includes('/login')) return false
  await dismissGlobalModals(page)
  // `networkidle`을 기다리지 않는다 — `/ci/*`는 큐 구동기가 주기적으로 요청을 보내서
  // **idle이 영영 오지 않는다.** 실측: 그 한 줄 때문에 /ci 화면 12개가 전부 60초 타임아웃으로
  // 실패했고, 치수는 재 보지도 못했다(검사기가 스스로 눈을 가린 셈).
  // 대신 본문이 그려졌는지만 확정적으로 기다린다.
  await page.locator('main.page-inner').first().waitFor({ state: 'visible', timeout: 20_000 }).catch(() => {})
  await page.waitForTimeout(600)
  return !page.url().includes('/login')
}

test.describe('치수 일관성 — 전 화면', () => {
  for (const path of SCREENS) {
    test(`${path}`, async ({ page }) => {
      test.setTimeout(60_000)
      test.skip(!(await open(page, path)), '인증/권한 없음')
      const findings = await inspect(page)
      expect(findings, `${path}\n  ${findings.map((f) => `[${f.rule}] ${f.detail}`).join('\n  ')}`).toEqual([])
    })
  }
})

test('수집함: 탭을 옮겨도 표의 기본 행 높이가 같다', async ({ page }) => {
  test.setTimeout(90_000)
  const heights = () => page.locator('table tbody tr')
    .evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)))
  /** 가장 흔한 값 = 그 목록의 기본 리듬. 제목이 길어 두 줄이 되는 행은 소수이고, 그건 정상이다. */
  const base = (list: number[]) => {
    const count = new Map<number, number>()
    for (const h of list) count.set(h, (count.get(h) ?? 0) + 1)
    let best = list[0]
    count.forEach((n, h) => { if (n > (count.get(best) ?? 0)) best = h })
    return best
  }

  test.skip(!(await open(page, '/ci/inbox')), '인증 세션 없음')
  const all = await heights()
  test.skip(all.length === 0, '수집함이 비어 있어 비교할 수 없음')

  test.skip(!(await open(page, '/ci/inbox?tab=review')), '인증 세션 없음')
  const review = await heights()
  test.skip(review.length === 0, '검토 필요 항목이 없어 비교할 수 없음')

  expect(base(review), `탭마다 기본 행 높이가 다르다 (전체 ${base(all)}px vs 검토 ${base(review)}px)`).toBe(base(all))
})

test('채널 상세: 같은 줄의 셀렉트와 버튼이 같은 높이·같은 바닥선', async ({ page }) => {
  test.setTimeout(90_000)
  test.skip(!(await open(page, '/ci/monitoring')), '인증 세션 없음')

  const firstRow = page.locator('table tbody tr').first()
  test.skip((await firstRow.count()) === 0, '등록된 채널이 없어 상세를 열 수 없음')
  await firstRow.click()
  await page.waitForURL(/\/ci\/channels\//, { timeout: 20_000 })
  await dismissGlobalModals(page)

  const box = await page.locator('#ch-window').boundingBox()
  const btn = await page.getByRole('button', { name: /채널 정보 새로고침/ }).boundingBox()
  expect(box && btn, '수집 기간 셀렉트 또는 새로고침 버튼을 찾지 못함').toBeTruthy()

  // 라벨이 붙은 컨트롤과 라벨 없는 버튼이 같은 줄에 설 때 center 정렬이면 라벨 높이만큼 밀린다.
  expect(round(box!.height), '셀렉트와 버튼의 높이가 다르다').toBe(round(btn!.height))
  expect(Math.abs((box!.y + box!.height) - (btn!.y + btn!.height)), '바닥선이 어긋난다').toBeLessThanOrEqual(1)
})

function round(n: number): number { return Math.round(n) }
