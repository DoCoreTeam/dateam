import { test, expect } from '@playwright/test'

test.describe('GPU 환율 (FX Rate)', () => {
  test('POST /api/pricing/gpu/fx — 미인증 요청은 성공(200+rate) 응답 없음', async ({ browser }) => {
    // ⚠️ `browser.newContext()`는 playwright.config의 `use.storageState`(로그인 세션)를 **물려받는다**.
    //    그냥 만들면 "미인증"이라고 이름 붙인 컨텍스트가 실은 로그인 상태라, 이 보안 단언이
    //    아무것도 검사하지 않게 된다(실제로 그 상태로 통과하고 있었다). 명시적으로 비워야 한다.
    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } })
    const req = await ctx.request.post('http://localhost:3000/api/pricing/gpu/fx', {
      failOnStatusCode: false,
    })
    // 미들웨어 리다이렉트(3xx)든 route handler의 401이든, 성공 응답이 아니어야 하고
    // 어떤 경우에도 환율 데이터가 새어 나가면 안 된다.
    expect(req.status()).not.toBe(200)
    expect(await req.text()).not.toContain('"usd_krw"')
    await ctx.close()
  })

  test('GET /api/pricing/gpu/fx — 환율 목록 반환', async ({ request }) => {
    const res = await request.get('/api/pricing/gpu/fx')
    expect(res.status()).toBe(200)

    const json = await res.json()
    expect(json).toHaveProperty('rates')
    expect(Array.isArray(json.rates)).toBe(true)
  })

  test('POST /api/pricing/gpu/fx — 환율 fetch 및 DB 저장', async ({ request }) => {
    const res = await request.post('/api/pricing/gpu/fx')
    // 200: 정상 | 500: admin panel에 API키 미설정 | 502: 한국수출입은행 응답 없음(휴일)
    expect([200, 500, 502]).toContain(res.status())

    if (res.status() === 200) {
      const json = await res.json()
      expect(json).toHaveProperty('usd_krw')
      expect(json).toHaveProperty('rate_date')
      expect(typeof json.usd_krw).toBe('number')
      expect(json.usd_krw).toBeGreaterThan(0)

      // 저장 후 GET으로 확인
      const getRes = await request.get('/api/pricing/gpu/fx')
      const getData = await getRes.json()
      const saved = getData.rates.find((r: { rate_date: string }) => r.rate_date === json.rate_date)
      expect(saved).toBeDefined()
      expect(Number(saved.usd_krw)).toBeCloseTo(json.usd_krw, 1)
    } else {
      // 한국수출입은행 API 미응답(휴일/주말) 시 502 허용
      const json = await res.json()
      expect(json).toHaveProperty('error')
    }
  })

  test('GPU 가격관리 페이지 — 환율 pill 표시', async ({ page }) => {
    await page.goto('/pricing/gpu')

    // 환율 pill이 렌더되거나, 로그인 리다이렉트 확인
    const url = page.url()
    if (url.includes('/login') || url.includes('/auth')) {
      console.log('인증 필요 — 로그인 리다이렉트 정상')
      return
    }

    // fx pill 대기 (settings API 응답 후 표시)
    const fxPill = page.locator('.gpu-fx-pill')
    await expect(fxPill).toBeVisible({ timeout: 8000 })

    // "1 USD = " 텍스트 포함 확인
    await expect(fxPill).toContainText('1 USD =')
    await expect(fxPill).toContainText('원')
  })

  test('GPU 가격관리 페이지 — 환율 값이 유효 범위 (800~2000원)', async ({ page }) => {
    await page.goto('/pricing/gpu')

    const url = page.url()
    if (url.includes('/login') || url.includes('/auth')) {
      console.log('인증 필요 — 로그인 리다이렉트 정상')
      return
    }

    const fxPill = page.locator('.gpu-fx-pill')
    await expect(fxPill).toBeVisible({ timeout: 8000 })

    const text = await fxPill.textContent()
    // 숫자 추출 — "1,498원" 형태 (정수 표시, 소수점 없음)
    const match = text?.match(/(\d[\d,]*)원/)
    expect(match).not.toBeNull()
    const rate = parseInt(match![1].replace(/,/g, ''), 10)
    expect(rate).toBeGreaterThan(800)
    expect(rate).toBeLessThan(2000)
  })

  test('/api/pricing/gpu/products — usd_krw 필드 포함', async ({ request }) => {
    const res = await request.get('/api/pricing/gpu/products')
    expect(res.status()).toBe(200)

    const json = await res.json()
    expect(json).toHaveProperty('usd_krw')
    expect(typeof json.usd_krw).toBe('number')
    expect(json.usd_krw).toBeGreaterThan(0)
  })

  test('/api/pricing/gpu/settings — usd_krw, fx_date 반환', async ({ request }) => {
    const res = await request.get('/api/pricing/gpu/settings')
    expect(res.status()).toBe(200)

    const json = await res.json()
    expect(json).toHaveProperty('usd_krw')
    expect(json).toHaveProperty('fx_date')
    // 환율이 저장되어 있으면 null이 아님
    if (json.usd_krw !== null) {
      expect(json.usd_krw).toBeGreaterThan(0)
    }
  })
})
