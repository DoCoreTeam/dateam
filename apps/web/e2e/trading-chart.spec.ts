import { test, expect } from '@playwright/test'

/**
 * 현황 차트 — **코드에 있는 것과 화면에 뜨는 것은 다르다**
 *
 * 사용자 지적 2026-09-28 「이거 설명도 없고」, 2026-09-29 「실시간 시스템처럼 차트가
 * 움직여야」 「내가 지금 주문을 어떻게 해야 하는지 모르겠어」.
 *
 * 도움말 배선(`R.Tooltip content={<BarTip/>}`)도 구간 띠(`R.Brush`)도 단위 시험은
 * 파일에 그 글자가 있는지만 본다. recharts 는 그려 보기 전에는 도는지 알 수 없다.
 *
 * **읽기만 한다.** 현황은 조회 화면이라 쓰기 경로가 없고, 이 스펙은 아무것도 안 만든다.
 */

/**
 * 차트가 설 때까지 기다린다 — **안 기다리면 건너뛰기가 통과로 보인다.**
 *
 * recharts 는 동적으로 불러오므로(`void import('recharts')`) 첫 렌더에는 스켈레톤만 있다.
 * 그 순간 `count()` 로 물으면 0 이고, 0 이면 스펙이 스스로 건너뛴다 — 실측 2026-09-29 에
 * 도움말과 구간 띠 두 검사가 그렇게 조용히 안 돌았다. 「봉이 0건이라 못 본다」와
 * 「아직 안 그려졌다」는 완전히 다른 사실이다.
 *
 * @returns 그릴 봉이 있으면 true, 정말 0건이면 false
 */
async function chartReady(page: import('@playwright/test').Page): Promise<boolean> {
  const chart = page.locator('.recharts-wrapper')
  const empty = page.getByText('가격 봉이 아직 없습니다')
  await expect(chart.or(empty).first()).toBeVisible({ timeout: 30_000 })
  if (await empty.count() > 0) return false
  await expect(chart.first()).toBeVisible({ timeout: 30_000 })
  return true
}

test.describe('현황 차트', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/trading')
    await expect(page.getByRole('heading', { name: '현황' })).toBeVisible({ timeout: 30_000 })
    /*
      **자동 모달이 클릭을 삼킨다.** 백드롭은 뒤 요소를 visible·enabled 로 두고
      클릭만 가로채므로, 안 닫으면 「요소는 찾았는데 클릭에서 타임아웃」이 된다.
      auth.setup 이 이미 심어 두지만 판이 오르면 되살아나므로 여기서도 확인한다.
    */
    const backdrop = page.locator('.modal-backdrop')
    if (await backdrop.count() > 0 && await backdrop.first().isVisible()) {
      await page.keyboard.press('Escape')
      await expect(backdrop.first()).toBeHidden({ timeout: 5_000 })
    }
  })

  test('봉이 있으면 차트가 서고, 없으면 왜 없는지 말한다', async ({ page }) => {
    // 둘 중 하나는 반드시 있어야 한다 — 둘 다 없으면 화면이 조용히 빈 것이다
    const drawn = await chartReady(page)
    if (!drawn) await expect(page.getByText('가격 봉이 아직 없습니다')).toBeVisible()
  })

  test('봉에 마우스를 올리면 시가·고가·저가·종가가 뜬다 — 기계 이름이 아니라', async ({ page }) => {
    test.skip(!(await chartReady(page)), '봉이 0건이라 이 판에서는 그림을 못 본다')
    const chart = page.locator('.recharts-wrapper').first()
    const box = await chart.boundingBox()
    expect(box).not.toBeNull()

    /*
      봉 하나 위로 커서를 옮긴다. 가운데는 봉이 있을 확률이 높고, 없으면 몇 칸 옮겨 본다 —
      한 자리에서 안 떴다고 「도움말이 없다」로 적으면 그것이 오진이다.
      배경 탭에서는 프레임이 안 도는 전례가 있어, Playwright 는 앞 탭으로 돈다.
    */
    let shown = false
    for (const ratio of [0.5, 0.6, 0.4, 0.7, 0.3]) {
      await page.mouse.move(box!.x + box!.width * ratio, box!.y + box!.height * 0.5)
      await page.waitForTimeout(300)
      if (await page.locator('.recharts-tooltip-wrapper').filter({ hasText: '시가' }).count() > 0) {
        shown = true
        break
      }
    }
    expect(shown, '봉 위에 올려도 도움말이 안 뜬다').toBe(true)

    const tip = page.locator('.recharts-tooltip-wrapper').first()
    for (const name of ['시가', '고가', '저가', '종가']) {
      await expect(tip).toContainText(name)
    }
    // recharts 기본 도움말은 dataKey 를 그대로 찍어 `band : 1092.28,1093.3` 이 된다
    await expect(tip).not.toContainText('band')
  })

  test('지금 예측이 주문할 수 있는 말로 끝난다', async ({ page }) => {
    const panel = page.locator('section', { has: page.getByRole('heading', { name: '지금 예측' }) }).first()
    await expect(panel).toBeVisible()

    // 판단이 아예 없는 판에서는 계획도 없다. 그때는 왜 없는지를 말해야 한다
    if (await panel.getByText('아직 판단이 없습니다').count() > 0) {
      test.skip(true, '판단이 0건이라 이 판에서는 계획을 못 본다')
    }
    // 관망이면 주문할 것이 없다 — 그것도 말로 나와야 한다
    if (await panel.getByText('관망이라 주문할 것이 없습니다').count() > 0) return

    /*
      **신호가 0건이어도 숫자가 떠야 한다.** 전에는 이 네 줄이 신호일 때만 그려져서
      신호 0건인 판에서는 방향과 점수만 남았다 — 그것으로는 주문을 못 낸다.
    */
    for (const label of ['진입 기준가', '손절가', '목표가']) {
      await expect(panel.getByText(label, { exact: true })).toBeVisible()
    }
    // 들어갈 수 있는 동안과 들고 있는 동안은 다른 시계다. 한 글자로 뭉치면 안 된다
    await expect(panel.getByText('진입 유효', { exact: true })).toBeVisible()
    await expect(panel.getByText('시간 청산', { exact: true })).toBeVisible()

    // 예고를 지시로 읽으면 사람이 그대로 주문한다 — 어디서 온 값인지가 같은 자리에 있어야 한다
    const source = panel.getByText(/신호에 적힌 값입니다|이 판단이 신호가 된다면 나갈 값입니다/)
    await expect(source.first()).toBeVisible()
  })

  test('구간 띠를 끌면 그림이 좁아지고, 도로 넓히면 돌아온다', async ({ page }) => {
    test.skip(!(await chartReady(page)), '봉이 0건이라 띠를 안 그린다')
    const brush = page.locator('.recharts-brush')
    await expect(brush.first()).toBeVisible({ timeout: 10_000 })

    /*
      **눈금 수로 재지 않는다.** X축에 `minTickGap={32}` 가 걸려 있어 구간을 좁혀도
      눈금 수는 그대로고 **어느 시각이 찍히는지**가 바뀐다 (실측 2026-09-29: 7 → 7).
      수로 재면 멀쩡한 기능을 고장으로 적게 된다 — 재는 자리가 틀린 것이다.

      그래서 **그려진 봉의 수**와 **첫 눈금의 시각**을 본다. 둘 다 창이 실제로
      좁아졌을 때만 바뀐다.
    */
    const ticks = page.locator('.recharts-xAxis .recharts-cartesian-axis-tick')
    expect(await ticks.count(), 'X축에 눈금이 하나도 없다').toBeGreaterThan(0)
    const candles = page.locator('.recharts-bar-rectangle')
    const barsBefore = await candles.count()
    const firstTickBefore = await ticks.first().textContent()
    expect(barsBefore, '봉이 하나도 안 그려졌다').toBeGreaterThan(0)

    // 왼쪽 손잡이를 오른쪽으로 끌어 구간을 좁힌다
    const traveller = page.locator('.recharts-brush-traveller').first()
    const t = await traveller.boundingBox()
    const b = await brush.first().boundingBox()
    expect(t).not.toBeNull()
    await page.mouse.move(t!.x + t!.width / 2, t!.y + t!.height / 2)
    await page.mouse.down()
    await page.mouse.move(b!.x + b!.width * 0.75, t!.y + t!.height / 2, { steps: 10 })
    await page.mouse.up()
    await page.waitForTimeout(500)

    const barsAfter = await candles.count()
    const firstTickAfter = await ticks.first().textContent()
    expect(
      barsAfter < barsBefore || firstTickAfter !== firstTickBefore,
      `구간을 좁혔는데 그림이 그대로다 (봉 ${barsBefore}→${barsAfter}, 첫 눈금 ${firstTickBefore}→${firstTickAfter})`,
    ).toBe(true)

    /*
      **되돌릴 길이 있어야 한다.** 되돌릴 방법이 없는 확대는 갇히는 것이다.
      손잡이를 왼쪽 끝으로 도로 끌면 처음 그리던 만큼 돌아와야 한다.
    */
    const t2 = await traveller.boundingBox()
    await page.mouse.move(t2!.x + t2!.width / 2, t2!.y + t2!.height / 2)
    await page.mouse.down()
    await page.mouse.move(b!.x, t2!.y + t2!.height / 2, { steps: 10 })
    await page.mouse.up()
    await page.waitForTimeout(500)
    expect(await candles.count(), '넓혔는데 봉이 안 늘어난다 — 되돌릴 길이 없다')
      .toBeGreaterThan(barsAfter)
  })
})
