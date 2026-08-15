import { test as setup } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'

const AUTH_STATE = path.join(__dirname, 'auth-state.json')
const ORIGIN = 'http://localhost:3000'

/**
 * `(member)/layout.tsx`가 쓰는 것과 같은 규칙으로 이번 주 월요일(KST, ISO)을 구한다.
 * 레이아웃은 `WeeklyReminderModal weekStart={thisMonday}`로 넘기고, 모달은 그 값으로
 * `weekly_reminder_seen_{weekStart}` 억제 키를 읽는다 — 키를 정확히 맞춰야 한다.
 */
function kstMondayIso(offsetWeeks = 0): string {
  const todayStr = new Date().toLocaleDateString('sv', { timeZone: 'Asia/Seoul' }) // kst-ok
  const anchor = new Date(`${todayStr}T00:00:00Z`)
  const dow = anchor.getUTCDay()
  anchor.setUTCDate(anchor.getUTCDate() + (dow === 0 ? -6 : 1 - dow) + offsetWeeks * 7)
  return anchor.toISOString().slice(0, 10)
}

/**
 * 저장된 세션에 "자동 안내 모달을 이미 봤다" 표시를 심는다.
 *
 * 왜: 앱은 상황에 따라 스스로 모달을 띄운다(새로운 소식·주간보고 작성 안내). 정상 동작이지만
 *   E2E에서는 그 `.modal-backdrop`이 포인터 이벤트를 가로채, 스펙이 요소를 찾아 놓고
 *   **클릭에서 타임아웃**으로 죽는다 — 앱은 멀쩡한데 검사만 죽는 가장 헷갈리는 실패다.
 *   예전엔 스펙마다 addInitScript로 각자 막았고(그래서 빠뜨린 스펙이 생겼다),
 *   그 빠진 스펙이 v0.7.475에서 실제로 이 이유로 실패했다.
 *   storageState는 localStorage를 포함하므로 **여기 한 번**이면 전 스펙이 상속받는다.
 *
 * changelog(버전마다 재등장) + 주간보고 작성 안내(주마다 재등장) 둘 다 시간이 지나면
 * 되살아나는 종류라, 한 곳에서 같이 심는다. 주차 경계에서 실행이 걸쳐도 되도록 전/현/차주를 심는다.
 */
function seedAutoModalsSeen(statePath: string): void {
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'))
  state.origins ??= []
  let origin = state.origins.find((o: { origin: string }) => o.origin === ORIGIN)
  if (!origin) { origin = { origin: ORIGIN, localStorage: [] }; state.origins.push(origin) }
  origin.localStorage ??= []

  const seeds: Array<[string, string]> = [
    ['changelog_seen_version', '999.999.999'],
    ...[-1, 0, 1].map((w) => [`weekly_reminder_seen_${kstMondayIso(w)}`, '1'] as [string, string]),
  ]
  for (const [name, value] of seeds) {
    const item = origin.localStorage.find((i: { name: string }) => i.name === name)
    if (item) item.value = value
    else origin.localStorage.push({ name, value })
  }
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2))
}

setup('로그인 세션 저장', async ({ page }) => {
  if (fs.existsSync(AUTH_STATE)) {
    seedAutoModalsSeen(AUTH_STATE)
    console.log('✅ 기존 세션 재사용:', AUTH_STATE)
    return
  }

  await page.goto('http://localhost:3000')

  console.log('\n=== 브라우저에서 직접 로그인해주세요 ===')
  console.log('로그인 완료 시 세션이 자동 저장됩니다.\n')

  await page.waitForURL(
    (url) => {
      const p = url.pathname
      return p.startsWith('/daily') || p.startsWith('/home') || p.startsWith('/calendar')
    },
    { timeout: 120_000 },
  )

  await page.context().storageState({ path: AUTH_STATE })
  seedAutoModalsSeen(AUTH_STATE)
  console.log(`✅ 세션 저장 완료: ${AUTH_STATE}`)
})
