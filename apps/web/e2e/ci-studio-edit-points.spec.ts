import { test, expect, type Page } from '@playwright/test'
import { dismissGlobalModals } from './_helpers'

// 편집점이 **실제로 나오는지** — 영상을 넣고 타임코드가 찍히는 데까지 간다.
//
// 왜 E2E인가: 이 기능은 단위 테스트로 증명되지 않는다. 판정 함수(buildEditPoints)는 순수 함수라
//   단위로 잠글 수 있지만, 정작 사용자가 겪는 것은 그 앞단이다 —
//   영상이 열리는가 · 프레임을 실제로 뜨는가 · canvas가 픽셀을 내주는가 · 소리가 디코딩되는가.
//   이것들은 브라우저 미디어 파이프라인 안에서만 일어나고, 하나라도 죽으면
//   **화면은 조용한데 아무 결과도 안 나온다.**
//   (실측 v0.7.516: 영상을 골라도 오류도 진행 표시도 없이 영원히 멈추는 결함이 여기서 나왔다.
//    tsc·단위·design:check는 전부 초록이었다.)
//
// 왜 영상을 만들어 쓰는가: 저장소에 테스트 영상을 두면 무거워지고, 외부 주소를 쓰면 남의 서버에
//   의존해 CI가 흔들린다. 브라우저가 canvas와 오디오로 **그 자리에서** 만든다 —
//   도입 무음·장면 전환·음량 피크를 의도적으로 넣어 편집점이 나올 수밖에 없는 영상을 만든다.

/** 만들 영상 길이. 도입 무음 + 장면 전환 + 중간 무음이 모두 들어갈 최소치. */
const CLIP_SEC = 14

/**
 * 브라우저 안에서 검증용 영상을 만들어 파일 입력에 넣는다.
 *
 * 설계(편집점이 나오도록 의도적으로 심는 신호):
 *   0.0~2.5초  검은 화면 + 무음 → 도입 데드에어(trim)
 *   3초마다     화면이 확 바뀜   → 장면 전환
 *   7.5~9.2초  무음             → 중간 늘어짐(trim)
 *   1초마다     음량이 튐        → 강조(emphasis) · 훅(hook)
 */
async function feedGeneratedVideo(page: Page, seconds: number): Promise<void> {
  await page.evaluate(async (sec) => {
    const canvas = document.createElement('canvas')
    canvas.width = 270
    canvas.height = 480 // 세로(9:16) — 눕혀 샘플링하는 회귀를 함께 막는다
    const g = canvas.getContext('2d')!
    const stream = canvas.captureStream(25)

    const ac = new AudioContext()
    const dest = ac.createMediaStreamDestination()
    const osc = ac.createOscillator()
    const gain = ac.createGain()
    osc.type = 'sawtooth'
    osc.frequency.value = 220
    osc.connect(gain)
    gain.connect(dest)
    gain.gain.value = 0
    osc.start()
    for (const t of dest.stream.getAudioTracks()) stream.addTrack(t)

    const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp8')
      ? 'video/webm;codecs=vp8'
      : 'video/webm'
    const rec = new MediaRecorder(stream, { mimeType: mime })
    const chunks: Blob[] = []
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }
    rec.start()

    const t0 = performance.now()
    const timer = window.setInterval(() => {
      const t = (performance.now() - t0) / 1000
      g.fillStyle = t < 2.5 ? '#000000' : (Math.floor(t / 3) % 2 ? '#ffffff' : '#102040')
      g.fillRect(0, 0, canvas.width, canvas.height)
      g.fillStyle = t < 2.5 ? '#050505' : '#ff0000'
      g.fillRect(20, 40 + ((t * 37) % 320), 130, 70)
      const quiet = t < 2.5 || (t > 7.5 && t < 9.2)
      gain.gain.value = quiet ? 0 : (Math.floor(t) % 3 === 0 ? 0.95 : 0.10)
    }, 40)

    await new Promise((r) => setTimeout(r, sec * 1000))
    window.clearInterval(timer)
    rec.stop()
    await new Promise<void>((r) => { rec.onstop = () => r() })
    osc.stop()
    void ac.close()

    const file = new File([new Blob(chunks, { type: mime })], 'edit-point-check.webm', { type: mime })
    const input = document.getElementById('s-file') as HTMLInputElement
    const dt = new DataTransfer()
    dt.items.add(file)
    input.files = dt.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }, seconds)
}

test.describe('편집점 — 영상을 넣으면 타임코드가 나온다', () => {
  test('파일을 고르면 진행 표시가 즉시 뜨고, 편집점이 근거와 함께 나온다', async ({ page }) => {
    test.setTimeout(180_000) // 영상 생성 + 프레임 훑기 + 오디오 디코딩

    await page.goto('/ci/studio')
    await dismissGlobalModals(page)
    await expect(page.getByRole('heading', { name: '편집점' }).first()).toBeVisible()

    await page.getByRole('tab', { name: '파일 고르기' }).click()
    await expect(page.locator('#s-file')).toBeVisible()

    await feedGeneratedVideo(page, CLIP_SEC)

    // ① 고른 직후 화면이 조용하면 안 된다 — "골랐는데 아무 일도 안 일어난다"가 실제 사고였다
    await expect(page.locator('main').getByRole('status')).toBeVisible({ timeout: 5_000 })

    // ② 분석이 끝나면 진행 표시가 사라지고 결과가 남는다
    await expect(page.locator('main').getByRole('status')).toHaveCount(0, { timeout: 150_000 })

    // ③ 오류로 끝나지 않았다 — 이유 없이 멈추거나 형식 오류로 떨어지면 여기서 잡힌다
    await expect(page.locator('.error-state')).toHaveCount(0)

    // ④ 길이를 실제로 읽었다(00:00이 아니다)
    const duration = await page.locator('.ci-metric-big').first().innerText()
    expect(duration).not.toBe('00:00.000')
    const seconds = Number(duration.split(':')[0]) * 60 + parseFloat(duration.split(':')[1] ?? '0')
    expect(seconds).toBeGreaterThan(5)

    // ⑤ 화면도 실제로 훑었다 — 여기가 '미확보'면 프레임 샘플링이 죽은 것이다
    //    (실측 v0.7.519: 주소로 읽는 경로에서 탐색 타임아웃이 3초라 첫 프레임에서 통째로 포기했다)
    const meta = await page.locator('.ci-meta-grid').innerText()
    expect(meta).not.toContain('미확보')

    // ⑥ 편집점이 하나 이상 나왔고, 타임코드와 근거가 함께 붙어 있다
    const points = page.locator('.ci-studio-item')
    await expect(points.first()).toBeVisible()
    const first = points.first()
    await expect(first.locator('.ci-studio-time')).toHaveText(/\d{2}:\d{2}\.\d{3}/)
    expect((await first.innerText()).length).toBeGreaterThan(20) // 지시 + 근거

    // ⑦ 내보내기 수단이 함께 열린다 — 편집툴로 못 가져가면 편집점은 쓸모가 없다
    await expect(page.getByRole('button', { name: /지시서 복사/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /마커 CSV/ })).toBeVisible()
  })

  test('플랫폼 링크는 못 읽은 축을 "미확보"라고 말한다 — 빈 값을 결과로 위장하지 않는다', async ({ page }) => {
    test.setTimeout(90_000)

    await page.goto('/ci/studio')
    await dismissGlobalModals(page)

    await page.getByRole('tab', { name: '링크 붙여넣기' }).click()
    await page.locator('#s-link').fill('https://www.youtube.com/watch?v=jNQXAC9IVRw')
    await page.getByRole('button', { name: '분석' }).click()

    // 길이는 확보하고, 화면·소리는 못 봤다고 말한다
    await expect(page.locator('.ci-meta-grid')).toBeVisible({ timeout: 60_000 })
    const meta = await page.locator('.ci-meta-grid').innerText()
    expect(meta).toContain('미확보')
    await expect(page.getByText('플랫폼 영상은 원본 화면을 읽을 수 없습니다')).toBeVisible()
  })

  test('지원하지 않는 주소는 이유와 대안을 말한다', async ({ page }) => {
    await page.goto('/ci/studio')
    await dismissGlobalModals(page)

    await page.getByRole('tab', { name: '링크 붙여넣기' }).click()
    await page.locator('#s-link').fill('https://www.tiktok.com/@someone/video/123456789')
    await page.getByRole('button', { name: '분석' }).click()

    const err = page.locator('.error-state')
    await expect(err).toBeVisible({ timeout: 30_000 })
    await expect(err).toContainText('드라이브 링크')  // 대안을 함께 준다
  })

  test('아직 누를 수 없는 버튼은 눌러 보기 전에 그렇게 보인다', async ({ page }) => {
    await page.goto('/ci/studio')
    await dismissGlobalModals(page)
    await page.getByRole('tab', { name: '링크 붙여넣기' }).click()

    const btn = page.getByRole('button', { name: '분석' })
    await expect(btn).toBeDisabled()
    const style = await btn.evaluate((el) => {
      const cs = getComputedStyle(el)
      return { opacity: Number(cs.opacity), cursor: cs.cursor }
    })
    expect(style.opacity).toBeLessThan(1)
    expect(style.cursor).toBe('not-allowed')
  })
})
