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
// 새 문서(계약서·거래명세서·발주서)도 이 부품을 쓴다. 문서마다 인쇄 규칙을 다시 쓰지 않는다.

import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useEscClose } from '@/lib/use-esc-close'
import styles from './doc-surface.module.css'

/** A4 한 장의 «쓸 수 있는» 높이(px). 297mm − 위아래 여백 15mm×2 */
const PAGE_H_PX = ((297 - 30) / 25.4) * 96

/**
 * 조금 넘칠 때만 줄인다.
 *
 * 0.8 밑으로 줄이면 글자가 읽기 어려워진다 — 그때는 **두 장이 맞다.**
 * 사용자도 「내용이 길면 두 장이 될 수도 있지만」이라고 했다.
 */
const MIN_FIT = 0.8

interface Props {
  /** 미리보기 머리글 — 무슨 문서인지 */
  title: string
  /** 도구(내려받기·인쇄). 화면에만 있고 종이에는 안 나온다 */
  actions?: ReactNode
  onClose: () => void
  /** 종이 위에 올라가는 것. 이것만 인쇄된다 */
  children: ReactNode
}

export default function DocSurface({ title, actions, onClose, children }: Props) {
  useEscClose(onClose)
  /*
    **body 직계로 띄운다(포털).**
    앱 셸 안에 그리면 인쇄 규칙(`body.doc-printing > *:not(.doc-overlay)`)이
    조상인 `.app-shell` 을 숨기면서 **오버레이까지 함께 사라진다** — 실제로 그랬다.
    포털이면 조상의 overflow·transform 에도 안 갇힌다.
  */
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  /*
    **한 장에 거의 들어가면 한 장으로 인쇄한다.**
    브라우저의 「한 장에 맞추기」는 사용자가 인쇄 대화상자에서 매번 골라야 하고,
    고르는 자리를 모르면 두 장짜리 견적서가 그대로 나간다.
    내용 높이를 재서 배율을 정하면 **누르는 것만으로 한 장**이 된다.
  */
  useEffect(() => {
    if (!mounted) return
    const paper = document.querySelector('.doc-paper')
    if (!(paper instanceof HTMLElement)) return
    const h = paper.scrollHeight
    const fit = h <= PAGE_H_PX ? 1 : Math.max(MIN_FIT, PAGE_H_PX / h)
    // 많이 넘치면 1 로 두어 정직하게 두 장이 되게 한다
    paper.style.setProperty('--doc-fit', String(fit >= MIN_FIT ? fit : 1))
  }, [mounted, children])

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

  return createPortal(
    <div className={`${styles.overlay} doc-overlay`} role="dialog" aria-modal="true" aria-label={title}>
      <header className={styles.bar}>
        <h2 className={styles.title}>{title}</h2>
        <div className={styles.actions}>
          {actions}
          <button type="button" className={styles.close} onClick={onClose} aria-label="미리보기 닫기">
            <X size={18} />
          </button>
        </div>
      </header>

      <div className={styles.scroll}>
        {/* 종이 — A4 비율. 화면에서 보는 것이 곧 인쇄되는 것이다 */}
        <div className={`${styles.paper} doc-paper`}>{children}</div>
      </div>
    </div>,
    document.body,
  )
}
