import { test as setup } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'

const AUTH_STATE = path.join(__dirname, 'auth-state.json')
const ORIGIN = 'http://localhost:3000'

/**
 * 저장된 세션에 "새로운 소식(changelog) 이미 봄" 표시를 심는다.
 *
 * 왜: 버전을 올릴 때마다 changelog 모달이 자동으로 뜨고, 그 backdrop이 클릭을 가로챈다.
 *   스펙은 링크를 찾아 놓고 클릭에서 30초 타임아웃으로 죽는다 — 앱은 멀쩡한데 검사만 죽는
 *   가장 헷갈리는 실패다. 예전엔 스펙마다 addInitScript로 각자 막았고(그래서 빠뜨린 스펙이
 *   생겼다), 그 빠진 스펙이 v0.7.475에서 실제로 이 이유로 실패했다.
 *   storageState는 localStorage를 포함하므로 **여기 한 번**이면 전 스펙이 상속받는다.
 */
function seedChangelogSeen(statePath: string): void {
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'))
  state.origins ??= []
  let origin = state.origins.find((o: { origin: string }) => o.origin === ORIGIN)
  if (!origin) { origin = { origin: ORIGIN, localStorage: [] }; state.origins.push(origin) }
  origin.localStorage ??= []
  const item = origin.localStorage.find((i: { name: string }) => i.name === 'changelog_seen_version')
  if (item) item.value = '999.999.999'
  else origin.localStorage.push({ name: 'changelog_seen_version', value: '999.999.999' })
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2))
}

setup('로그인 세션 저장', async ({ page }) => {
  if (fs.existsSync(AUTH_STATE)) {
    seedChangelogSeen(AUTH_STATE)
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
  seedChangelogSeen(AUTH_STATE)
  console.log(`✅ 세션 저장 완료: ${AUTH_STATE}`)
})
