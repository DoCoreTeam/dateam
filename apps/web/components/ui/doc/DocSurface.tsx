'use client'

// 문서 표면 (SSOT) — 고객에게 나가는 문서는 **여기 안에서만** 인쇄·내보내기한다
//
// **왜 만드나**: 견적서를 인쇄했더니 사이드바·상단 바(회의 모드·알림·검색·전체 메뉴)와
// 회색 앱 배경이 그대로 종이에 찍혔다. 우리 화면 장치가 고객에게 가는 문서에 실린 것이다.
// (사용자 지적 2026-08-28: 「출력할때 웹서비스 화면이 그냥 나와버리는데 … 이런게 나오는건
//  버그고 회색 배경이 … PDF 인쇄에 나오면 절대 안된다. 별도의 미리보기를 만들고 거기서
//  엑셀, PDF, 이미지 내려 받도록 하고 우리 정책이다」)
//
// **왜 «인쇄 CSS 를 더 고치기»가 아닌가**: 그 길은 앱에 요소가 하나 늘 때마다 다시 깨진다.
// 숨길 것을 세는 대신 **보일 것만 남긴다** — 이 오버레이 밖은 인쇄에서 통째로 사라진다.
//
// **왜 별도 라우트가 아닌가**: 라우트를 새로 파면 인증·셸 계약 가드·복귀 경로가 모두 따라온다.
// 오버레이는 그 자리에서 열리고 닫히며, 주소(`?preview=1`)로 공유·새로고침도 된다.
//
// ── 한 장 맞춤 (v0.7.702) ────────────────────────────────────────────────
// **배율은 이제 «종이의 상태»다.** 예전에는 인쇄용 CSS 안에만 있어서
//   · 미리보기는 100% 로 보이고
//   · 인쇄는 `transform: scale()` 을 걸었는데 그건 **그리기**라 쪽 수를 못 바꾸고
//   · PDF 버튼은 그런 게 있는지도 모른 채 그림을 A4 높이로 잘랐다.
// 같은 견적서인데 **어느 버튼을 누르느냐에 따라 다른 파일**이 나갔다.
//
// 지금은 화면이 줄고, 인쇄·PDF·이미지가 **그 화면을 그대로** 뽑는다.
// 줄이는 수단은 `zoom` 이다 — `transform` 과 달리 배치에 영향을 주므로 쪽 수가 실제로 준다
// (실측: 같은 내용 같은 배율 0.88 → transform 2쪽 · zoom 1쪽).
//
// 폭 보정은 **하지 않는다.** `zoom` 아래에서 `100%` 는 이미 부모의 실제 폭으로 확장된다 —
// 여기서 또 `1/배율` 을 곱하면 내용이 종이 밖으로 15% 넘친다(실측에서 잡았다).

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X, Minus, Plus } from 'lucide-react'
import { useEscClose } from '@/lib/use-esc-close'
import {
  MAX_FIT_PASSES, fitPercent, fitsOnePage, nextFit, stepFit,
} from '@/lib/doc/page-fit'
import {
  FIT_ON, FIT_OFF, FIT_SMALLER, FIT_BIGGER, PREVIEW_CLOSE, fitReason, tooLongNote,
} from '@/lib/terms'
import styles from './doc-surface.module.css'

interface Props {
  /** 미리보기 머리글 — 무슨 문서인지 */
  title: string
  /** 도구(내려받기·인쇄). 화면에만 있고 종이에는 안 나온다 */
  actions?: ReactNode
  onClose: () => void
  /** 종이 위에 올라가는 것. 이것만 인쇄된다 */
  children: ReactNode
  /**
   * 한 장 맞춤을 켠 채로 열까.
   *
   * 기본은 켬이다 — 고객에게 나가는 문서는 한 장이 기본이고,
   * 「원래 크기」로 되돌리는 것은 담당자가 한 번 누르면 된다.
   */
  fitToPage?: boolean
}

export default function DocSurface({ title, actions, onClose, children, fitToPage = true }: Props) {
  useEscClose(onClose)
  /*
    **body 직계로 띄운다(포털).**
    앱 셸 안에 그리면 인쇄 규칙(`body.doc-printing > *:not(.doc-overlay)`)이
    조상인 `.app-shell` 을 숨기면서 **오버레이까지 함께 사라진다** — 실제로 그랬다.
    포털이면 조상의 overflow·transform 에도 안 갇힌다.
  */
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  const paperRef = useRef<HTMLDivElement | null>(null)
  const fitRef = useRef<HTMLDivElement | null>(null)

  /** 한 장 맞춤을 켰나 */
  const [fitOn, setFitOn] = useState(fitToPage)
  /** 지금 적용된 배율 */
  const [scale, setScale] = useState(1)
  /** 사용자가 −/+ 로 정한 배율. 있으면 자동 계산을 멈춘다 — 사람이 정한 것을 기계가 덮지 않는다 */
  const [manual, setManual] = useState<number | null>(null)
  /** 배율 1 일 때 한 장을 넘치나 — 안 넘치면 배지 자체를 그리지 않는다 */
  const [overflows, setOverflows] = useState(false)
  /** 하한까지 줄여도 못 넣는다 — 그때는 두 장이 맞다고 말한다 */
  const [tooLong, setTooLong] = useState(false)

  /**
   * 재고 줄이고 다시 잰다.
   *
   * 한 번에 안 맞는 이유: 글자가 작아지면 한 줄에 더 많이 들어가 **줄바꿈이 바뀐다.**
   * 실측은 3회차에 멈췄다(1.000 → 0.881 → 0.871).
   */
  const measure = useCallback(() => {
    const paper = paperRef.current
    const box = fitRef.current
    if (!paper || !box) return

    // ① 원래 크기에서 먼저 본다 — 안 넘치면 아무것도 하지 않는다
    box.style.setProperty('--doc-fit', '1')
    const natural = paper.scrollHeight
    const over = !fitsOnePage(natural)
    setOverflows(over)

    if (!fitOn || !over) {
      setScale(1)
      setTooLong(false)
      return
    }

    // ② 사람이 정한 배율이 있으면 그대로 존중한다
    if (manual !== null) {
      box.style.setProperty('--doc-fit', String(manual))
      setScale(manual)
      setTooLong(!fitsOnePage(paper.scrollHeight))
      return
    }

    // ③ 줄이고 다시 재기를 되풀이한다
    let f = 1
    for (let i = 0; i < MAX_FIT_PASSES; i += 1) {
      const h = paper.scrollHeight
      if (fitsOnePage(h)) break
      const next = nextFit(f, h)
      if (next >= f) break // 하한에 닿았다 — 더 줄여도 소용없다
      f = next
      box.style.setProperty('--doc-fit', String(f))
    }
    setScale(f)
    setTooLong(!fitsOnePage(paper.scrollHeight))
  }, [fitOn, manual])

  /**
   * 언제 재나.
   *
   * 글꼴과 로고가 늦게 오면 높이가 바뀐다. 그 전에 잰 배율은 틀린 값이라
   * **오는 대로 다시 잰다** — 안 그러면 로고가 뜬 순간 한 장이 두 장이 된다.
   */
  useEffect(() => {
    if (!mounted) return
    let dead = false
    const run = () => { if (!dead) measure() }

    run()

    const fonts = (document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts
    fonts?.ready?.then(run).catch(() => {})

    const paper = paperRef.current
    const imgs = paper ? Array.from(paper.querySelectorAll('img')) : []
    imgs.forEach((img) => {
      if (img.complete) return
      img.addEventListener('load', run)
      img.addEventListener('error', run)
    })

    const t = window.setTimeout(run, 400)
    return () => {
      dead = true
      window.clearTimeout(t)
      imgs.forEach((img) => {
        img.removeEventListener('load', run)
        img.removeEventListener('error', run)
      })
    }
  }, [mounted, measure])

  /*
    열려 있는 동안 뒤 화면이 스크롤되지 않게 한다.
    안 막으면 미리보기 안에서 굴린 줄 알았는데 뒤가 움직이고, 닫으면 엉뚱한 자리에 있다.
  */
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    /*
      **인쇄 대상을 표시한다.** `@media print` 가 이 클래스를 보고
      오버레이 밖을 전부 숨긴다 — 숨길 것을 세는 대신 보일 것만 남기는 방식이다.
    */
    document.body.classList.add('doc-printing')
    return () => {
      document.body.style.overflow = prev
      document.body.classList.remove('doc-printing')
    }
  }, [])

  if (!mounted) return null

  const percent = fitPercent(scale)

  return createPortal(
    <div className={`${styles.overlay} doc-overlay`} role="dialog" aria-modal="true" aria-label={title}>
      <header className={styles.bar}>
        <h2 className={styles.title}>{title}</h2>

        {/*
          **쪽 설정은 미리보기에서 정한다.** 인쇄 대화상자에 맡기면 사용자가 매번 찾아야 하고,
          찾는 자리를 모르면 두 장짜리 견적서가 그대로 나간다.
          줄일 필요가 없는 문서에는 아무것도 그리지 않는다 — 늘 뜨는 안내는 아무도 안 읽는다.
        */}
        {overflows && (
          <div className={styles.fitBox}>
            <button
              type="button"
              className={`${styles.fitToggle}${fitOn ? ` ${styles.fitOn}` : ''}`}
              onClick={() => { setManual(null); setFitOn((v) => !v) }}
              title={fitOn ? fitReason(percent) : ''}
              aria-pressed={fitOn}
            >
              {fitOn ? `${FIT_ON} · ${percent}%` : FIT_OFF}
            </button>
            {fitOn && (
              <>
                <button
                  type="button"
                  className={styles.fitStep}
                  onClick={() => setManual(stepFit(scale, -1))}
                  aria-label={FIT_SMALLER}
                  title={FIT_SMALLER}
                >
                  <Minus size={14} />
                </button>
                <button
                  type="button"
                  className={styles.fitStep}
                  onClick={() => setManual(stepFit(scale, 1))}
                  aria-label={FIT_BIGGER}
                  title={FIT_BIGGER}
                >
                  <Plus size={14} />
                </button>
              </>
            )}
          </div>
        )}

        <div className={styles.actions}>
          {actions}
          <button type="button" className={styles.close} onClick={onClose} aria-label={PREVIEW_CLOSE}>
            <X size={18} />
          </button>
        </div>
      </header>

      {/* 하한까지 줄여도 못 넣으면 그 사실과 «어디서 끊기는지»를 함께 말한다 */}
      {fitOn && tooLong && <p className={styles.fitNote}>{tooLongNote(percent)}</p>}

      <div className={styles.scroll}>
        {/* 종이 — A4 비율. 화면에서 보는 것이 곧 인쇄되는 것이다 */}
        <div className={`${styles.paper} doc-paper`} ref={paperRef}>
          {/*
            줄이는 것은 **안쪽**이다. 종이는 A4 폭·여백을 그대로 지킨다 —
            종이째 줄이면 오른쪽에 흰 띠가 남고 여백까지 함께 작아진다.
          */}
          <div className={`${styles.fit} doc-fitbox`} ref={fitRef}>{children}</div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
