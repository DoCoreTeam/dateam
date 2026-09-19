import { defineConfig, devices } from '@playwright/test'
import * as path from 'path'
import * as dotenv from 'dotenv'

dotenv.config({ path: path.join(__dirname, 'apps/web/.env.local') })

const AUTH_STATE = path.join(__dirname, 'apps/web/e2e/auth-state.json')

export default defineConfig({
  testDir: './apps/web/e2e',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    /*
      **어느 서버를 보는지 고를 수 있어야 한다.** 공유 dev 서버(:3000)는 여러 세션이 쓰고
      옛 코드를 물고 있을 때가 있다 — 실제로 v0.10.177 을 확인하려는데 그 서버가
      v0.10.149 를 그리고 있었다. 그때 서버를 다시 띄우면 남의 작업이 끊기므로
      격리된 두 번째 서버(NEXT_DIST_DIR + 다른 포트)를 띄우고 여기로 가리킨다.
    */
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: AUTH_STATE,
      },
      dependencies: ['setup'],
    },
  ],
})
