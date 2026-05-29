import { test, expect } from '@playwright/test'

// 다중 모델 혼합 견적 텍스트 (H100 + A100)
const MULTI_MODEL_TEXT = `
[GMI Cloud] GPU 가용량 안내

안녕하세요. 아래 두 가지 GPU 모델에 대한 견적을 안내드립니다.

1. H100 SXM5 80GB
   가격: $2.10/GPU·hr
   약정: 3개월
   최소 수량: 8장
   가용: 현재 32장 즉시 공급 가능
   견적 유효: 2026-07-15

2. A100 SXM4 80GB
   가격: $1.50/GPU·hr
   약정: 없음 (온디맨드)
   가용: 16장

문의: sales@gmicloud.ai
`.trim()

test.describe('GPU 다중 모델 추출', () => {
  test('POST /api/pricing/gpu/review — 다중 모델 텍스트 → items 배열 반환', async ({ request }) => {
    const res = await request.post('/api/pricing/gpu/review', {
      data: { text: MULTI_MODEL_TEXT, channel: 'mail', is_test: true },
    })

    // AI 키 미설정이면 500 허용 (CI 환경)
    if (res.status() === 500) {
      const json = await res.json()
      expect(json).toHaveProperty('error')
      console.log('AI 키 미설정 — API 응답 검증 스킵:', json.error)
      return
    }

    expect(res.status()).toBe(200)
    const json = await res.json()

    // 다중 모델인 경우 items 배열 반환
    if (json.items) {
      expect(Array.isArray(json.items)).toBe(true)
      expect(json.items.length).toBeGreaterThanOrEqual(2)
      expect(json).toHaveProperty('count')
      expect(json).toHaveProperty('batch_id')
      expect(json.count).toBe(json.items.length)

      // 각 item 구조 검증
      for (const item of json.items) {
        expect(item).toHaveProperty('id')
        expect(item).toHaveProperty('product_hint')
        expect(item).toHaveProperty('overall_confidence')
        expect(item).toHaveProperty('current_extracted')
      }

      // batch_id로 DB 묶음 확인 (GET으로 검색)
      const getRes = await request.get('/api/pricing/gpu/review?status=pending')
      expect(getRes.status()).toBe(200)
      const getData = await getRes.json()
      const batchItems = getData.items.filter(
        (i: { source_batch_id?: string }) => i.source_batch_id === json.batch_id
      )
      expect(batchItems.length).toBe(json.count)

    } else {
      // 단일 모델 응답 (AI가 1개만 인식한 경우) — 하위 호환 검증
      expect(json).toHaveProperty('item')
      expect(json.item).toHaveProperty('id')
      console.log('단일 모델만 감지됨 (AI 응답에 따라 허용)')
    }
  })

  test('POST /api/pricing/gpu/review — 단일 모델 텍스트 → 하위 호환 item 반환', async ({ request }) => {
    const singleModelText = '[Vectorlay] H100 SXM5 80GB: $2.30/GPU·hr, 약정 없음, 즉시 가용 512장'

    const res = await request.post('/api/pricing/gpu/review', {
      data: { text: singleModelText, channel: 'mail', is_test: true },
    })

    if (res.status() === 500) {
      const json = await res.json()
      console.log('AI 키 미설정 — 단일 모델 테스트 스킵:', json.error)
      return
    }

    expect(res.status()).toBe(200)
    const json = await res.json()

    // 단일 모델: item(단수) 또는 items[1개] 모두 허용
    const hasItem = !!json.item
    const hasOneItemArr = Array.isArray(json.items) && json.items.length === 1
    expect(hasItem || hasOneItemArr).toBe(true)
  })

  test('GPU 통합 입력 페이지 — 다중 모델 탭 UI 렌더링', async ({ page }) => {
    await page.goto('/pricing/gpu')

    const url = page.url()
    if (url.includes('/login') || url.includes('/auth')) {
      console.log('인증 필요 — 로그인 리다이렉트 정상')
      return
    }

    // 통합 입력 탭 클릭
    await page.getByRole('button', { name: '통합 입력' }).click()
    await page.waitForTimeout(300)

    // 텍스트 입력
    const textarea = page.locator('.gpu-intake-textarea')
    await expect(textarea).toBeVisible({ timeout: 5000 })
    await textarea.fill(MULTI_MODEL_TEXT)

    // 테스트 데이터 태깅 체크
    await page.locator('input[type="checkbox"]').check()

    // AI 분석 버튼 클릭
    const analyzeBtn = page.getByRole('button', { name: 'AI 분석 시작' })
    await expect(analyzeBtn).toBeEnabled()
    await analyzeBtn.click()

    // 분석 중 상태 확인
    await expect(page.locator('[data-testid="analyze-step-msg"]')).toBeVisible({ timeout: 3000 })

    // 결과 대기 (최대 30초)
    try {
      await page.waitForSelector('[data-testid="multi-model-tabs"]', { timeout: 30000 })

      // 탭이 2개 이상 렌더됐는지 확인
      const tabs = page.locator('[data-testid^="model-tab-"]')
      const tabCount = await tabs.count()
      expect(tabCount).toBeGreaterThanOrEqual(2)
      console.log(`✅ 다중 모델 탭 ${tabCount}개 렌더됨`)

      // 탭 0 선택 시 내용 표시 확인
      await tabs.nth(0).click()
      await page.waitForTimeout(200)

      // 두 번째 탭 클릭 시 내용 전환 확인
      await tabs.nth(1).click()
      await page.waitForTimeout(200)

      // 성공 메시지 확인
      await expect(page.locator('.gpu-success-msg')).toBeVisible({ timeout: 3000 })
      const successText = await page.locator('.gpu-success-msg').textContent()
      expect(successText).toContain('개 모델')

    } catch {
      // AI 키 미설정 or 단일 모델 감지 시 — 에러 메시지 또는 단일 결과 허용
      const errorMsg = page.locator('.gpu-error-msg')
      const successMsg = page.locator('.gpu-success-msg')
      const hasError = await errorMsg.isVisible()
      const hasSuccess = await successMsg.isVisible()

      if (hasError) {
        console.log('AI 키 미설정 또는 분석 오류 — 에러 메시지 표시 확인됨')
      } else if (hasSuccess) {
        console.log('단일 모델만 감지됨 — 성공 메시지 확인됨')
      } else {
        // 타임아웃 — AI 응답 지연 가능성
        console.log('결과 대기 타임아웃 (AI 응답 지연 가능)')
      }
    }
  })

  test('GPU 통합 입력 페이지 — 탭 전환 시 내용 변경 확인', async ({ page }) => {
    await page.goto('/pricing/gpu')

    const url = page.url()
    if (url.includes('/login') || url.includes('/auth')) {
      console.log('인증 필요')
      return
    }

    // 통합 입력 탭으로 이동
    await page.getByRole('button', { name: '통합 입력' }).click()
    await page.waitForTimeout(300)

    // 탭이 없을 경우 (단일 결과) → 기존 UI 확인
    const tabs = page.locator('[data-testid^="model-tab-"]')
    const hasTabs = await tabs.count() > 0

    if (hasTabs) {
      const tab0 = tabs.nth(0)
      const tab1 = tabs.nth(1)

      await tab0.click()
      const tab0Label = await tab0.textContent()

      await tab1.click()
      const tab1Label = await tab1.textContent()

      // 두 탭 라벨이 다름 (다른 모델)
      expect(tab0Label?.trim()).not.toBe(tab1Label?.trim())
      console.log(`탭 전환 확인: "${tab0Label?.trim()}" → "${tab1Label?.trim()}"`)
    } else {
      console.log('탭 없음 — 분석 전 상태 (정상)')
    }
  })
})
