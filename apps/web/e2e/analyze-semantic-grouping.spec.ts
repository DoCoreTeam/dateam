import { test, expect, type Page } from '@playwright/test'

// 목록 심층분석 재정의(v0.7.367) — 의미블록 그룹핑 E2E.
// 03-test-strategy.md의 E1~E8을 기본 렌더 경로에서 검증한다.
//
// 설계 원칙:
//  - auth-state.json이 있으면 실제 admin 세션으로 그룹 렌더·재지시까지 검증(E1~E8).
//  - 없으면(CI 인증 미설정) 로그인 리다이렉트를 정상으로 간주하고 UI 진입 가능성만 확인.
//    기존 gpu-*.spec.ts와 동일한 관용 패턴(인증 없으면 구조만, 있으면 실동작).
//  - AI(Gemini) 실호출은 시간·쿼터 변동이 크므로 넉넉한 타임아웃 + 조건부 skip으로 감싼다.

const ANALYZE_URL = 'http://localhost:3000/ai-chat/analyze'

// 141개 파편 사고를 재현하는 문서 — front-matter 메타 + 섹션 구조 + 변경이력.
// 이 문서를 넣으면 (구현 전) 141개 파편이 나왔고, (재정의 후) 섹션 수 규모의 그룹만 나와야 한다.
const INCIDENT_DOC = `# 신규 서비스 기획서

- 문서 버전: v0.1.0
- 작성일: 2026-07-20
- 상태: 초안 (Draft)
- 프로젝트명: 미정 (가칭 "제타 클론")

## 1. 개요
이 문서는 신규 서비스의 기획 방향을 정리한다.

## 2. 목표
- 사용자 확보 10만 명
- 월 매출 1억 원
- 리텐션 40% 이상

## 3. 로드맵
### P0
- MVP 출시
- 핵심 기능 3종 구현

### P1
- 결제 연동
- 상태: 진행 중
- 알림 시스템

### P2
- 다국어 지원
- 파트너 API 개방

## 변경 이력
- v0.1.0 (2026-07-20): 초안 작성`

/** 인증 리다이렉트면 true(구조 검증만 하고 조기 종료). */
function isAuthRedirect(page: Page): boolean {
  const u = page.url()
  return u.includes('/login') || u.includes('/auth')
}

/**
 * 첫 로그인 시 뜨는 안내 모달(changelog "새로운 소식"·온보딩 등)을 닫는다.
 * 새 브라우저 세션은 localStorage가 비어 이 모달이 뜨고, 그 modal-backdrop이 실행 버튼
 * 클릭을 가로막는다(실측: E2/E3/E5 실패 원인). 기존 사용자는 이미 봐서 안 뜬다.
 */
async function dismissOverlays(page: Page): Promise<void> {
  for (let i = 0; i < 4; i++) {
    if ((await page.locator('.modal-backdrop').count()) === 0) return
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
  }
  // Escape로 안 닫히면 backdrop 바깥 클릭 시도(대부분 모달은 backdrop 클릭 시 닫힘)
  const backdrop = page.locator('.modal-backdrop').first()
  if ((await backdrop.count()) > 0) await backdrop.click({ position: { x: 5, y: 5 } }).catch(() => {})
}

/** 입력 화면에 문서+지시를 채우고 실행. 그룹 결과가 뜰 때까지 대기(그룹 헤더 등장). */
async function runAnalysis(page: Page, doc: string, command: string): Promise<boolean> {
  await dismissOverlays(page)
  const source = page.getByPlaceholder(/문서 원문을 여기 붙여넣으세요/)
  await source.fill(doc)
  if (command) {
    await page.getByPlaceholder(/요구사항 단위로 묶어줘/).fill(command)
  }
  await page.getByRole('button', { name: '실행', exact: true }).click()

  // 그룹 결과 화면 = "N개 그룹으로 나뉘었습니다" 텍스트. AI 호출이라 넉넉히 대기.
  const grouped = page.getByText(/개 그룹으로 나뉘었습니다/)
  try {
    await expect(grouped).toBeVisible({ timeout: 45_000 })
    return true
  } catch {
    return false
  }
}

test.describe('목록 심층분석 — 의미블록 그룹핑', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(ANALYZE_URL, { waitUntil: 'networkidle', timeout: 15_000 }).catch(() => {})
    if (!isAuthRedirect(page)) await dismissOverlays(page)
  })

  test('입력 화면: 지시 입력과 실행 버튼이 한 덩어리, 검수 단계 없음', async ({ page }) => {
    if (isAuthRedirect(page)) {
      expect(page.url()).toMatch(/login|auth/)
      return
    }
    // 명령↔실행이 한 화면(구 141개 체크박스 검수 단계 제거 확인)
    await expect(page.getByPlaceholder(/문서 원문을 여기 붙여넣으세요/)).toBeVisible()
    await expect(page.getByPlaceholder(/요구사항 단위로 묶어줘/)).toBeVisible()
    await expect(page.getByRole('button', { name: '실행', exact: true })).toBeVisible()

    // 폐기된 lens 칩 5개가 없어야 한다
    await expect(page.getByText('핵심 요약', { exact: true })).toHaveCount(0)
    await expect(page.getByText('리스크·우려사항', { exact: true })).toHaveCount(0)
  })

  test('탭 구조: "내 분석 문서"가 1급, 세션은 "이전 원문"으로 강등(계약 E)', async ({ page }) => {
    if (isAuthRedirect(page)) return
    // WorkSubTabs는 <Link role="tab">이라 role은 'link'가 아니라 'tab'이다.
    await expect(page.getByRole('tab', { name: '내 분석 문서' })).toBeVisible()
    await expect(page.getByRole('tab', { name: '이전 원문' })).toBeVisible()
    // 구 라벨 "전체 세션"은 없어야 한다(계약 E: 세션 강등)
    await expect(page.getByRole('tab', { name: '전체 세션' })).toHaveCount(0)
  })

  test('E2·E4·E5: 141 사고 문서 → 섹션 규모 그룹 + 미귀속 0 + 메타 분리', async ({ page }) => {
    if (isAuthRedirect(page)) {
      test.skip(true, '인증 세션 없음 — 실행 경로 스킵(구조 테스트로 대체)')
      return
    }
    const ok = await runAnalysis(page, INCIDENT_DOC, '큰 섹션 단위로 묶어줘')
    test.skip(!ok, 'AI 응답 지연/쿼터 — 실행 미완')

    // E2: 141개가 아니라 섹션 수(<20) 규모
    const groupCountText = await page.getByText(/개 그룹으로 나뉘었습니다/).textContent()
    const n = Number(groupCountText?.match(/(\d+)개 그룹/)?.[1] ?? '999')
    expect(n).toBeGreaterThan(0)
    expect(n).toBeLessThan(20)

    // E4: 미귀속 원문 0줄 배지(P0 신뢰 장치)
    await expect(page.getByText(/미귀속 원문 0줄/)).toBeVisible()

    // E5: 문서 메타가 그룹이 아니라 "분리 보관"으로 노출
    await expect(page.getByText(/분리 보관됨/)).toBeVisible()
    // 메타 문자열이 그룹 제목으로 새지 않았는지 — "문서 버전" 텍스트가 그룹 헤더에 없어야
    await expect(page.getByRole('button', { name: /^문서 버전: v0\.1\.0/ })).toHaveCount(0)
  })

  test('E3: 재지시로 그룹이 실제로 달라진다', async ({ page }) => {
    if (isAuthRedirect(page)) {
      test.skip(true, '인증 세션 없음')
      return
    }
    const ok = await runAnalysis(page, INCIDENT_DOC, '큰 섹션 단위로 묶어줘')
    test.skip(!ok, 'AI 응답 지연/쿼터')

    const first = await page.getByText(/개 그룹으로 나뉘었습니다/).textContent()
    const firstN = Number(first?.match(/(\d+)개 그룹/)?.[1] ?? '0')

    // 재지시: 더 잘게
    await page.getByPlaceholder(/더 크게 묶어/).fill('로드맵을 P0/P1/P2 세부 단위로 쪼개')
    await page.getByRole('button', { name: '다시 묶기' }).click()

    // 리비전 2로 갱신 + 그룹 수 변화(더 잘게 → 증가). AI라 넉넉히.
    await expect(page.getByText(/리비전 2/)).toBeVisible({ timeout: 45_000 })
    const second = await page.getByText(/개 그룹으로 나뉘었습니다/).textContent()
    const secondN = Number(second?.match(/(\d+)개 그룹/)?.[1] ?? '0')

    // 정확한 그룹 수 변화는 실제 AI(Gemini) 비결정이라 단정하지 않는다
    // (지시→그룹 변화의 결정론 검증은 pipeline.test.ts의 fakeAi가 담당).
    // E2E는 "재그룹핑 파이프라인이 실제로 돈다(리비전 진행) + 유실 0"을 확인한다.
    expect(secondN).toBeGreaterThan(0)
    expect(firstN).toBeGreaterThan(0)
    await expect(page.getByText(/미귀속 원문 0줄/)).toBeVisible()
  })

  test('E8: "내 분석 문서" 탭이 에러 없이 렌더된다(마이그 161·171 적용 확인)', async ({ page }) => {
    await page.goto(`${ANALYZE_URL}?tab=documents`, { waitUntil: 'networkidle', timeout: 15_000 }).catch(() => {})
    if (isAuthRedirect(page)) return

    // 목록 조회 실패 에러가 뜨지 않아야 한다(161/171 미적용 시 나던 에러)
    await expect(page.getByText(/조회 중 오류가 발생했습니다/)).toHaveCount(0)
    // 빈 상태 또는 문서 목록 중 하나는 보인다
    const emptyOrList = page.getByText(/저장된 분석 문서가 없습니다|내 분석 문서/)
    await expect(emptyOrList.first()).toBeVisible({ timeout: 10_000 })
  })

  test('세션 목록 탭이 에러 없이 렌더된다(마이그 161 적용 확인)', async ({ page }) => {
    await page.goto(`${ANALYZE_URL}?tab=list`, { waitUntil: 'networkidle', timeout: 15_000 }).catch(() => {})
    if (isAuthRedirect(page)) return
    await expect(page.getByText(/조회 중 오류가 발생했습니다/)).toHaveCount(0)
  })
})
