import type { Page } from '@playwright/test'

/**
 * 화면을 덮는 자동 안내 모달을 닫는다.
 *
 * 왜: 앱은 상황에 따라 스스로 모달을 띄운다(주간보고 미작성 안내·이름 설정·루틴 체크인 등).
 *   이건 정상 동작이지만, E2E에서는 `.modal-backdrop`이 포인터 이벤트를 가로채
 *   **"요소는 찾았는데 클릭에서 타임아웃"** 이라는 가장 헷갈리는 실패를 만든다.
 *   앱은 멀쩡한데 검사만 죽으므로, 원인을 못 찾으면 애먼 코드를 고치게 된다.
 *
 * changelog "새로운 소식"은 여기서 닫지 않는다 — auth.setup이 저장 세션에
 * `changelog_seen_version`을 심어 애초에 뜨지 않게 한다(버전 올릴 때마다 반복되므로).
 *
 * 예전엔 이 함수가 work-shell-uniformity.spec.ts 안에만 있었고, 복사해 가지 않은 스펙이
 * 그대로 실패했다(v0.7.475). 그래서 공용으로 뺀다.
 */
export async function dismissGlobalModals(page: Page): Promise<void> {
  await page.waitForTimeout(400)
  for (let i = 0; i < 4; i += 1) {
    const backdrop = page.locator('.modal-backdrop').first()
    if (!(await backdrop.isVisible().catch(() => false))) return
    // 백드롭 모서리를 눌러 닫는다 — 카드 위를 누르면 안의 버튼이 눌린다
    await backdrop.click({ position: { x: 2, y: 2 } }).catch(() => {})
    await page.waitForTimeout(150)
  }
}
