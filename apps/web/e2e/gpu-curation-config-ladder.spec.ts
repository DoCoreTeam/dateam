import { test, expect } from '@playwright/test'

// GPU 큐레이션(v0.7.406) + 구성 1/2/4/8 표시계층(v0.7.409) + 모델 그룹핑(v0.7.408) 실렌더 검증.
// 실 렌더 경로 = UnifiedTableConnected(플래그 'unified' DEFAULT_ON) → UnifiedTable.
// 검증만 — 코드 수정 없음. 세션 만료 시 /login 리다이렉트로 명확히 실패(거짓통과 방지).

test.describe('GPU 가격표 큐레이션 + 구성 사다리 (실렌더)', () => {
  test.beforeEach(async ({ page }) => {
    // '새로운 소식' changelog 모달 억제(새 버전이라 자동 노출 → backdrop이 클릭 가로챔).
    // changelog_seen_version을 높은 버전으로 선주입해 isChangelogPending=false.
    await page.addInitScript(() => {
      try {
        window.localStorage.setItem('changelog_seen_version', '999.999.999')
      } catch {
        /* 무시 */
      }
    })
    await page.goto('/pricing/gpu')
    await expect(
      page.locator('.gpu-pricing-root'),
      'GPU 페이지 미로드 — 세션 만료 시 /login 리다이렉트. auth-state.json 갱신 필요',
    ).toBeVisible({ timeout: 15000 })
    // 주간보고 작성 안내 모달(z=200 backdrop) 자동 노출 시 '나중에'로 닫기 → localStorage 키 세팅되어 리로드 후 재노출 차단.
    const laterBtn = page.getByRole('button', { name: '나중에' })
    if (await laterBtn.isVisible().catch(() => false)) {
      await laterBtn.click()
      await expect(page.locator('.modal-backdrop')).toHaveCount(0, { timeout: 5000 })
    }
    // 기본값 ON 확인 — 잔여 오버라이드 제거
    await page.evaluate(() => window.localStorage.removeItem('gpu:flag:unified'))
    await page.reload()
    await expect(page.locator('.gpu-unified')).toBeVisible({ timeout: 15000 })
    // 그룹 헤더 렌더 완료 대기(비동기 fetch 후 그룹핑)
    await expect(page.locator('.gpu-unified-group-head').first()).toBeVisible({ timeout: 15000 })
  })

  test('v0.7.406: 취급만/전체보기 토글 + 숨김·검토 배지', async ({ page }) => {
    // 취급/전체 보기 토글 버튼 존재(기본=취급만)
    const toggle = page.getByRole('button', { name: /전체 보기|취급만 보기/ })
    await expect(toggle).toBeVisible({ timeout: 10000 })

    // 기본 상태 = "전체 보기" 라벨(현재 취급만 보는 중이라 전환 라벨). 숨김 개수(+N) 확인.
    const initialLabel = await toggle.textContent()
    console.log('[검증] 초기 토글 라벨:', initialLabel)
    expect(initialLabel).toMatch(/전체 보기/)

    // 전체 보기로 전환 → 숨김/검토대기 배지가 하나라도 나타나는지
    await toggle.click()
    await expect(page.getByRole('button', { name: /취급만 보기/ })).toBeVisible({ timeout: 10000 })

    const hiddenBadges = page.locator('.gpu-ubadge--muted', { hasText: '숨김' })
    const reviewBadges = page.locator('.gpu-ubadge--warn', { hasText: '검토 대기' })
    const hiddenCount = await hiddenBadges.count()
    const reviewCount = await reviewBadges.count()
    console.log(`[검증] 전체보기 — 숨김 배지 ${hiddenCount}개, 검토대기 배지 ${reviewCount}개`)
    // 시드상 11개 숨김(TESLA10+Quadro1) 존재 → 최소 1개 이상
    expect(hiddenCount + reviewCount).toBeGreaterThan(0)
  })

  test('v0.7.409: 구성 사다리 — 그룹 펼침 시 1/2/4/8 + 계산 배지', async ({ page }) => {
    // 첫 그룹 펼치기
    const firstGroup = page.locator('.gpu-unified-group-head').first()
    await expect(firstGroup).toBeVisible({ timeout: 10000 })
    if ((await firstGroup.getAttribute('aria-expanded')) === 'false') {
      await firstGroup.click()
    }
    // 펼친 그룹 안에 합성 rung('계산' 배지)이 하나라도 있는지 — 전 모델 1/2/4/8 보장이 목표
    const calcBadges = page.locator('.gpu-ubadge--muted', { hasText: '계산' })
    // 여러 그룹 펼쳐 표본 확보
    const groups = page.locator('.gpu-unified-group-head')
    const gcount = Math.min(await groups.count(), 5)
    for (let i = 0; i < gcount; i++) {
      const g = groups.nth(i)
      if ((await g.getAttribute('aria-expanded')) === 'false') await g.click()
    }
    const calcCount = await calcBadges.count()
    console.log(`[검증] 상위 ${gcount}개 그룹 펼침 — '계산'(합성 구성) 배지 ${calcCount}개`)
    // 1장전용 모델도 2/4/8을 계산으로 채우므로 합성 배지가 반드시 존재해야 함
    expect(calcCount).toBeGreaterThan(0)
  })

  test('v0.7.408: 모델 그룹핑 — 변형(폼팩터/에디션) 하위 표기', async ({ page }) => {
    // 그룹 헤더가 base 모델명으로 접혀 있고, 펼치면 변형 라벨이 보이는 구조 확인.
    const groups = page.locator('.gpu-unified-group-head')
    const count = await groups.count()
    console.log(`[검증] 모델 그룹 헤더 수: ${count}`)
    expect(count).toBeGreaterThan(0)
    // '변형' 문구(폼팩터→변형 리네이밍) 또는 그룹 내 행 존재
    const first = groups.first()
    if ((await first.getAttribute('aria-expanded')) === 'false') await first.click()
    await expect(page.locator('.gpu-unified-row--item').first()).toBeVisible({ timeout: 10000 })
  })
})
