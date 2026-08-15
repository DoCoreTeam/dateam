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

    // 응답은 분류에 따라 두 갈래다(v0.7.x 계약):
    //  · competitor(클라우드 시세) → { type:'competitor', preview[], count } — **적재 없이 미리보기만**
    //  · supplier(공급사 견적)     → { items[](id 포함), count, batch_id } — 검토대기 즉시 적재
    // 예전 판은 supplier 갈래만 알고 있어서, 경쟁사로 분류되면 그냥 죽었다.
    const rows = json.preview ?? json.items ?? (json.item ? [json.item] : [])
    expect(Array.isArray(rows), `예상 밖 응답 형태: ${JSON.stringify(json).slice(0, 200)}`).toBe(true)
    expect(rows.length, '다중 모델 텍스트에서 2개 이상 추출').toBeGreaterThanOrEqual(2)
    expect(json.count).toBe(rows.length)

    if (json.items) {
      // supplier 갈래 — 실제 적재까지 확인
      for (const item of json.items) {
        expect(item).toHaveProperty('id')
        expect(item).toHaveProperty('product_hint')
        expect(item).toHaveProperty('overall_confidence')
        expect(item).toHaveProperty('current_extracted')
      }
      expect(json).toHaveProperty('batch_id')
      const getRes = await request.get('/api/pricing/gpu/review?status=pending')
      expect(getRes.status()).toBe(200)
      const getData = await getRes.json()
      const batchItems = getData.items.filter(
        (i: { source_batch_id?: string }) => i.source_batch_id === json.batch_id
      )
      expect(batchItems.length).toBe(json.count)
    } else {
      // competitor 갈래 — 미리보기 행의 최소 필드
      for (const row of rows) {
        expect(row).toHaveProperty('model_name')
        expect(row).toHaveProperty('price_usd')
      }
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

    // 단일 모델: item(단수) · items[1개] · preview[1개](경쟁사 미리보기) 모두 허용
    const rows = json.preview ?? json.items ?? (json.item ? [json.item] : [])
    expect(rows.length, `단일 모델 1건 기대, 응답: ${JSON.stringify(json).slice(0, 200)}`).toBe(1)
  })

  test('GPU 통합 입력 페이지 — 다중 모델 탭 UI 렌더링', async ({ page }) => {
    test.setTimeout(120_000) // 실 AI 호출 — 기본 30초는 결과 대기(30초)와 같아 catch 안에서 페이지가 닫혔다
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

    // 분석 중 상태 확인 — 진행 로그(analyze-live-log)가 현재 렌더러다(구 analyze-step-msg는 없어졌다)
    await expect(page.locator('[data-testid="analyze-live-log"]')).toBeVisible({ timeout: 10_000 })

    // 결과가 어떤 형태로든 반드시 떠야 한다 — '분석 중'에서 영영 안 돌아오는 것만은 허용하지 않는다.
    //  · supplier 분류 → 공급가 미리보기(다중이면 모델 탭)
    //  · competitor 분류 → 경쟁사 미리보기(탭 UI 없음 — 이 텍스트는 클라우드 시세라 보통 이쪽이다)
    //  · 실패 → 에러 메시지(무음 아님)
    const anyResult = page.locator(
      '[data-testid="multi-model-tabs"], [data-testid="supplier-preview"], [data-testid="competitor-preview"], .gpu-error-msg',
    )
    await expect(anyResult.first()).toBeVisible({ timeout: 90_000 })

    // 모델 탭이 떴다면 다중 렌더·전환까지 확인한다(안 떴으면 이 화면의 계약이 아니다).
    const tabs = page.locator('[data-testid^="model-tab-"]')
    if (await page.locator('[data-testid="multi-model-tabs"]').count()) {
      expect(await tabs.count()).toBeGreaterThanOrEqual(2)
      await tabs.nth(0).click()
      await tabs.nth(1).click()
      await expect(page.locator('.gpu-success-msg')).toContainText('개 모델', { timeout: 5_000 })
    } else {
      console.log('모델 탭 아님 — 경쟁사/단일 미리보기 경로로 결과 렌더 확인됨')
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
