import { test, expect } from '@playwright/test'

// 통합 표(리팩토링) E2E — 'unified' 기본 ON(v0.7.124~). 미설정이면 통합 표가 기본.
//   1) 통합 표(.gpu-unified) 기본 렌더 + 모델별 그룹 헤더
//   2) 보기 전환 → 컬럼 헤더 텍스트 교체(가격표 ↔ 가격 결정)
//   3) 행 선택 → 우측 상세 패널 노출
//   4) flag 'off' 오버라이드 → 기존 10탭으로 롤백

test.describe('GPU 통합 표 (flag: unified)', () => {
  test('기본 ON → 통합 표 렌더 + 모델 그룹 + 보기 전환 + 행 선택 상세', async ({ page }) => {
    await page.goto('/pricing/gpu')
    // 인증 가드: 로그인으로 리다이렉트되면 세션 만료 — 거짓 통과 방지(명확히 실패).
    await expect(page.locator('.gpu-pricing-root'), 'GPU 페이지 미로드(세션 만료 시 /login 리다이렉트). auth-state.json 갱신 필요').toBeVisible({ timeout: 15000 })
    // 기본값 ON — 오버라이드 없이 통합 표가 기본. 잔여 오버라이드 제거 후 확인.
    await page.evaluate(() => window.localStorage.removeItem('gpu:flag:unified'))
    await page.reload()
    await expect(page.locator('.gpu-pricing-root')).toBeVisible({ timeout: 15000 })

    // 가격표 탭(기본) 영역이 통합 표로 교체되었는지
    const unified = page.locator('.gpu-unified')
    await expect(unified).toBeVisible({ timeout: 15000 })

    // 모델별 그룹 헤더가 하나라도 있으면 접기/펼치기 동작 검증.
    // 기본값=전체 접힘(v0.7.127) → 첫 상태 aria-expanded=false, 클릭 시 토글.
    const firstGroup = page.locator('.gpu-unified-group-head').first()
    if (await firstGroup.count() > 0) {
      await expect(firstGroup).toHaveAttribute('aria-expanded', 'false')
      await firstGroup.click()
      await expect(firstGroup).toHaveAttribute('aria-expanded', 'true')
      await firstGroup.click()
      await expect(firstGroup).toHaveAttribute('aria-expanded', 'false')
    }

    // 보기 전환 세그먼트 존재
    const seg = page.locator('.gpu-uview-seg')
    await expect(seg).toBeVisible()

    // 기본 보기(판매가) 헤더에 '판매가' 컬럼
    const head = page.locator('.gpu-unified-row--head')
    await expect(head).toContainText('판매가')

    // '가격 결정' 보기로 전환 → 헤더에 '공급원가' 컬럼 등장
    await page.getByRole('tab', { name: '가격 결정' }).click()
    await expect(head).toContainText('공급원가')

    // 행이 하나라도 있으면 선택 → 상세 패널 노출
    const firstRow = page.locator('.gpu-unified-row--item').first()
    if (await firstRow.count() > 0) {
      await firstRow.click()
      await expect(page.locator('.gpu-udetail-title')).toBeVisible()
      // 상세 탭(공급원가) 노출
      await expect(page.getByRole('tab', { name: '공급원가' })).toBeVisible()
    }
  })

  test("flag 'off' 오버라이드 → 기존 가격표 탭으로 롤백(통합 표 없음)", async ({ page }) => {
    await page.goto('/pricing/gpu')
    await expect(page.locator('.gpu-pricing-root'), 'GPU 페이지 미로드(세션 만료 시 /login). auth-state.json 갱신 필요').toBeVisible({ timeout: 15000 })
    await page.evaluate(() => window.localStorage.setItem('gpu:flag:unified', 'off'))
    await page.reload()
    await expect(page.locator('.gpu-pricing-root')).toBeVisible({ timeout: 15000 })
    await expect(page.locator('.gpu-unified')).toHaveCount(0)
  })
})
