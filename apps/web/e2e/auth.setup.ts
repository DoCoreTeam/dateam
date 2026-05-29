import { test as setup } from '@playwright/test'
import * as path from 'path'

const AUTH_STATE = path.join(__dirname, 'auth-state.json')

setup('로그인 세션 저장', async ({ page }) => {
  await page.goto('http://localhost:3000')

  console.log('\n=== 브라우저에서 직접 로그인해주세요 ===')
  console.log('로그인 완료 시 세션이 자동 저장됩니다.\n')

  // /daily, /home, /calendar 중 하나에 도달하면 로그인 완료로 간주
  await page.waitForURL(
    (url) => {
      const p = url.pathname
      return p.startsWith('/daily') || p.startsWith('/home') || p.startsWith('/calendar')
    },
    { timeout: 120_000 },
  )

  await page.context().storageState({ path: AUTH_STATE })
  console.log(`✅ 세션 저장 완료: ${AUTH_STATE}`)
})
