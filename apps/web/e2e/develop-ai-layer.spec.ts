import { test, expect } from '@playwright/test'

/**
 * 개발자센터 「AI 공통층」 다섯 항목이 실제로 뜨고 읽히는가
 *
 * 타입 검사와 가드는 **표와 화면이 어긋나지 않았다**만 말한다. 눌렀을 때 내용이 바뀌는지는
 * 브라우저만 안다 — 이 저장소에서 tsc·단위시험·리뷰가 전부 초록인데 브라우저가 결함 7건을
 * 잡아낸 적이 있다(v0.7.367).
 *
 * 이 절은 v0.10.163~167 에서 다시 쓰였다. 이름만 나열하던 것이 인자·반환·오류가 있는
 * 참조 문서가 됐고, 모델 정책 절이 새로 생겼다. 그 전 판의 명세는 개수를 붙인 옛 항목
 * 이름을 들고 있어서, 돌리면 그 자리에서 죽었다.
 */

/** 왼쪽 목록의 이름과 눌렀을 때 떠야 하는 제목 */
const SECTIONS = [
  { label: '무엇인가', title: 'AI 공통층' },
  { label: '붙이는 순서', title: '붙이는 순서' },
  { label: '모델 정책', title: '모델 정책' },
  { label: '패키지', title: '패키지와 수출' },
  { label: '결과 계약', title: '결과 계약' },
] as const

test('AI 공통층 다섯 항목이 뜨고 누르면 제목과 내용이 바뀐다', async ({ page }) => {
  await page.goto('/develop')
  await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 })

  // 묶음 이름이 왼쪽에 있다
  await expect(page.getByText('AI 공통층', { exact: true }).first()).toBeVisible()

  for (const s of SECTIONS) {
    await expect(page.getByRole('button', { name: s.label, exact: true })).toBeVisible()
  }

  // 항목마다 제목이 뜬다 — 이 절만 제목 없이 본문부터 시작하던 것을 고쳤다
  for (const s of SECTIONS) {
    await page.getByRole('button', { name: s.label, exact: true }).click()
    await expect(page.getByRole('heading', { level: 1, name: s.title })).toBeVisible()
  }
})

test('붙이는 순서에 붙여 넣을 코드와 확인 명령이 있다', async ({ page }) => {
  await page.goto('/develop')
  await page.getByRole('button', { name: '붙이는 순서', exact: true }).click()
  await expect(page.getByText('transpilePackages')).toBeVisible()
  await expect(page.getByText('확인하는 법', { exact: true })).toBeVisible()
  await expect(page.getByText('pnpm typecheck:packages')).toBeVisible()
})

test('모델 정책에 공급자와 상한과 실패 갈래가 있다', async ({ page }) => {
  await page.goto('/develop')
  await page.getByRole('button', { name: '모델 정책', exact: true }).click()

  // 공급자 다섯 — vendor.ts 에서 파생한 표
  for (const id of ['gemini', 'claude', 'openai', 'groq', 'grok']) {
    await expect(page.getByText(id, { exact: true }).first()).toBeVisible()
  }
  await expect(page.getByText('AIza', { exact: true })).toBeVisible()

  // 상한 숫자는 model-chain.ts 상수에서 온다
  await expect(page.getByText(/전체 후보 6개까지 시도합니다/)).toBeVisible()
  await expect(page.getByText(/한 공급자에서는 2개까지만 씁니다/)).toBeVisible()

  // 실패 갈래 셋
  for (const scope of ['provider', 'model', 'transient']) {
    await expect(page.getByText(scope, { exact: true }).first()).toBeVisible()
  }

  // 부르는 쪽 모양
  await expect(page.getByText('buildModelChain')).toBeVisible()
  await expect(page.getByText('pruneChain').first()).toBeVisible()
})

test('패키지 절에 호출 모양과 오류 표가 있다', async ({ page }) => {
  await page.goto('/develop')
  await page.getByRole('button', { name: '패키지', exact: true }).click()

  for (const n of ['@ax/ai-core', '@ax/ai-gateway', '@ax/ai-providers', '@ax/ai-react']) {
    // 이름은 제목에도 「기대는 것」 배지에도 뜬다 — 여럿인 것이 정상이라 첫째만 본다
    await expect(page.getByText(n, { exact: true }).first()).toBeVisible()
  }

  // 이름만이 아니라 인자와 반환이 보인다 (가드가 이 줄이 실제 선언과 같은지 따로 센다)
  await expect(page.getByText('missingLabels(labels: Partial<AiLabels> | null | undefined): string[]')).toBeVisible()
  await expect(page.getByText('maskPii(text: string, options?: MaskOptions): MaskResult')).toBeVisible()
  await expect(page.getByText('{ text, hits: [{ kind, value, token }] }')).toBeVisible()

  // 던지는 오류
  await expect(page.getByText('던지는 오류', { exact: true })).toBeVisible()
  await expect(page.getByText('NoModelAvailableError', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('JsonRecoverError', { exact: true }).first()).toBeVisible()

  // 그 밖의 수출은 이름만 남는다
  await expect(page.getByText('그 밖의 수출', { exact: true }).first()).toBeVisible()
})

test('결과 계약에 타입과 상태 전이와 끝까지 예시가 있다', async ({ page }) => {
  await page.goto('/develop')
  await page.getByRole('button', { name: '결과 계약', exact: true }).click()

  // 저장하는 모양 — 실제 타입
  await expect(page.getByText('저장하는 모양', { exact: true })).toBeVisible()
  await expect(page.getByText('AiValueStatus').first()).toBeVisible()

  // 상태 넷과 옮겨 갈 수 있는 곳 (canTransition 에서 만든다)
  for (const s of ['streaming', 'candidate', 'confirmed', 'corrected']) {
    await expect(page.getByText(s, { exact: true }).first()).toBeVisible()
  }

  // 계약의 자리 — capability 가 빠져 있던 것을 채웠다
  for (const k of ['capability', 'value', 'confidence', 'evidence', 'source', 'status', 'corrections', 'contractVersion']) {
    await expect(page.getByText(k, { exact: true }).first()).toBeVisible()
  }

  // 능력 이름이 사람이 읽는 말이다
  await expect(page.getByText('transcribe', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('전사', { exact: true })).toBeVisible()
  await expect(page.getByText('추출', { exact: true })).toBeVisible()

  // 부르기부터 고치기까지 한 예시
  await expect(page.getByText('한 화면을 처음부터 끝까지', { exact: true })).toBeVisible()
  await expect(page.getByText('applyCorrection').first()).toBeVisible()
})
