import { test, expect } from '@playwright/test'

// v0.7.120 — 신규 mono 테마 + 프리뷰 버그픽스 + 개인별 테마 선택 실검증
// 색 기준값(globals.css 토큰): brand → nb #7c3aed / classic #6366f1 / mono #111111
const BRAND = {
  nb: 'rgb(124, 58, 237)',
  classic: 'rgb(99, 102, 241)',
  mono: 'rgb(17, 17, 17)',
}

test('테마 프리뷰: 전역 테마와 무관하게 각 카드가 자기 테마 색으로 렌더(버그픽스)', async ({ page }) => {
  await page.goto('/admin/settings')
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 })

  // 각 테마 카드의 첫 스와치(=var(--brand)) 배경색이 그 테마 고유색이어야 함
  for (const id of ['nb', 'classic', 'mono'] as const) {
    const swatch = page.locator(`button[data-theme="${id}"] span`).first()
    await expect(swatch).toBeVisible({ timeout: 10_000 })
    const bg = await swatch.evaluate((el) => getComputedStyle(el).backgroundColor)
    expect(bg, `${id} 카드 brand 스와치 색`).toBe(BRAND[id])
  }
})

test('개인 테마: 사용자 메뉴 → 테마변경 서브메뉴 → mono 선택 → 즉시 반영 + 새로고침 유지', async ({ page }) => {
  await page.goto('/home')
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 })

  const original = await page.evaluate(() => document.documentElement.getAttribute('data-theme'))

  // 좌하단 프로필 메뉴 열기
  await page.getByTestId('sidebar-profile-trigger').first().click()

  // 테마변경 → 호버만으로 오른쪽 서브메뉴가 열려야 함(클릭 없이)
  const themeChangeBtn = page.locator('button:has-text("테마변경")')
  await expect(themeChangeBtn).toBeVisible({ timeout: 10_000 })
  await themeChangeBtn.hover()
  const monoItem = page.getByRole('menuitemradio', { name: /Monochrome/ })
  await expect(monoItem).toBeVisible({ timeout: 10_000 })

  // mono 선택 → 즉시 반영
  await monoItem.click()
  await expect.poll(
    () => page.evaluate(() => document.documentElement.getAttribute('data-theme')),
    { timeout: 10_000 },
  ).toBe('mono')

  // 새로고침 후에도 mono 유지(DB 영속 + SSR 주입)
  await page.reload()
  await expect.poll(
    () => page.evaluate(() => document.documentElement.getAttribute('data-theme')),
    { timeout: 10_000 },
  ).toBe('mono')

  // 정리 — 개인 테마를 null(리셋=전역 디폴트 추종)로 되돌림.
  // ⚠️ 실계정 오염 방지: original 값으로 되돌리면 theme_preference가 '값'으로 남아
  //    어드민의 전역 테마 변경이 본인 화면에 안 보이는 혼란을 유발(테스트 격리).
  await page.request.post('/api/user/theme', { data: { theme: null } })
  void original
})
