import { test, expect } from '@playwright/test'

test.describe('GPU DB Chat', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/pricing/gpu')
    // AI 조회 패널 열기
    await page.getByTestId('ai-panel-toggle').click()
    await expect(page.getByTestId('db-chat-input')).toBeVisible()
  })

  test('케이스1: DB 기반 실제 답변', async ({ page }) => {
    const input = page.getByTestId('db-chat-input')
    await input.fill('H100 현재 최저가 알려줘')
    await page.getByTestId('db-chat-send').click()

    // 로딩 후 AI 답변 나타날 때까지 대기 (최대 30초)
    const assistantMsg = page.locator('div').filter({ hasText: /H100|GPU|가격|공급|달러|\$|USD|원/ }).last()
    await expect(assistantMsg).toBeVisible({ timeout: 30000 })

    // 분석 중... 텍스트가 사라지고 실제 답변이 있어야 함
    await expect(page.getByText('분석 중...')).toBeHidden({ timeout: 30000 })
    await expect(assistantMsg).toBeVisible({ timeout: 5000 })
  })

  test('케이스2: 멀티턴 맥락 유지', async ({ page }) => {
    const input = page.getByTestId('db-chat-input')
    const sendBtn = page.getByTestId('db-chat-send')

    // 첫 번째 질문
    await input.fill('현재 등록된 공급사 목록 알려줘')
    await sendBtn.click()
    await expect(page.getByText('분석 중...')).toBeHidden({ timeout: 30000 })

    // 두 번째 질문 (앞 대화 맥락 참조)
    await input.fill('그 중에 한국 공급사가 있어?')
    await sendBtn.click()
    await expect(page.getByText('분석 중...')).toBeHidden({ timeout: 30000 })

    // 메시지가 4개(질문2 + 답변2) 이상 있어야 함
    const userMsgs = page.locator('div').filter({ hasText: '그 중에 한국 공급사가 있어?' })
    await expect(userMsgs.first()).toBeVisible()
  })

  test('케이스3: DB 무관 질문 거절', async ({ page }) => {
    const input = page.getByTestId('db-chat-input')
    await input.fill('오늘 날씨 어때?')
    await page.getByTestId('db-chat-send').click()

    await expect(page.getByText('분석 중...')).toBeHidden({ timeout: 30000 })

    // 거절 키워드가 답변에 포함되어야 함
    const rejectKeywords = ['관련 질문만', 'DB에', '없습니다', '견적', 'GPU']
    let found = false
    for (const kw of rejectKeywords) {
      const el = page.getByText(new RegExp(kw, 'i'))
      if (await el.count() > 0) { found = true; break }
    }
    expect(found, '거절 메시지가 없습니다').toBe(true)
  })
})
