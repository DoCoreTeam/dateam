import { test, expect } from '@playwright/test'

/**
 * 개발자센터 「AI 공통층」 메뉴가 실제로 뜨고 읽히는가
 *
 * 형 검사와 가드는 **표와 화면이 어긋나지 않았다**만 말한다. 눌렀을 때 내용이 바뀌는지는
 * 브라우저만 안다 — 이 저장소에서 tsc·단위시험·리뷰가 전부 초록인데 브라우저가 결함 7건을
 * 잡아낸 적이 있다(v0.7.367).
 */
test('AI 공통층 네 항목이 뜨고 눌리면 내용이 바뀐다', async ({ page }) => {
  await page.goto('/develop')
  await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 })

  // 묶음 이름이 왼쪽에 있다
  await expect(page.getByText('AI 공통층', { exact: true })).toBeVisible()

  for (const label of ['무엇인가', '붙이는 순서', '패키지 넷', '결과 계약']) {
    await expect(page.getByRole('button', { name: label, exact: true })).toBeVisible()
  }

  // 소개
  await page.getByRole('button', { name: '무엇인가', exact: true }).click()
  await expect(page.getByText('한 줄로', { exact: true })).toBeVisible()

  // 붙이는 순서 — 여섯 단계와 붙여 넣을 코드
  await page.getByRole('button', { name: '붙이는 순서', exact: true }).click()
  await expect(page.getByText('transpilePackages')).toBeVisible()
  await expect(page.getByText('확인하는 법', { exact: true })).toBeVisible()

  // 패키지 넷 — 이름과 대표 수출
  await page.getByRole('button', { name: '패키지 넷', exact: true }).click()
  for (const n of ['@ax/ai-core', '@ax/ai-gateway', '@ax/ai-providers', '@ax/ai-react']) {
    // 이름은 제목에도 「기대는 것」 배지에도 뜬다 — 여럿인 것이 정상이라 첫째만 본다
    await expect(page.getByText(n, { exact: true }).first()).toBeVisible()
  }
  // 대표 수출이 실제로 그려진다 (가드가 이 이름이 진짜 수출인지 따로 센다)
  await expect(page.getByText('confidencePercentView', { exact: true })).toBeVisible()
  await expect(page.getByText('maskPii', { exact: true })).toBeVisible()

  // 결과 계약 — 일곱 자리
  await page.getByRole('button', { name: '결과 계약', exact: true }).click()
  for (const k of ['value', 'confidence', 'evidence', 'source', 'status', 'corrections', 'contractVersion']) {
    await expect(page.getByText(k, { exact: true }).first()).toBeVisible()
  }
  // 능력 여덟이 계약과 같은 이름으로 떠 있다
  await expect(page.getByText('transcribe', { exact: true })).toBeVisible()
})
