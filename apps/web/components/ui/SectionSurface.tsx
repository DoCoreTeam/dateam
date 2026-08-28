// 섹션 면 (SSOT) — 「여기부터 여기까지가 한 덩어리」를 **글자가 아니라 면으로** 말한다
//
// **왜 만드나**: 딜 보드에서 파이프라인을 세로로 쌓았는데 구분이 제목 글자뿐이라
// 어디서 끊기는지 안 보였다(사용자 지적: 「이거 너무 눈에 안보인다 구분이 글자로만 되니깐」).
// 화면마다 테두리를 손으로 그리면 화면마다 두께·여백·배경이 갈린다 — 그래서 부품으로 둔다.
//
// **왜 card 가 아닌가**: `.card` 는 속을 채우는 상자다. 이건 **머리띠 + 본문**이라
// 머리에만 배경이 깔리고 본문은 스스로 패딩을 갖는 것(보드 컬럼·표)까지 담아야 한다.

import type { ReactNode } from 'react'
import styles from './section-surface.module.css'

interface Props {
  title: string
  /** 제목 옆 작은 글씨 — 건수처럼 제목을 보조하는 사실 */
  meta?: ReactNode
  /** 오른쪽 끝 숫자 — 금액처럼 이 덩어리를 대표하는 값 */
  figure?: ReactNode
  /** figure 아래 한 줄 — 「금액 미정 2건 제외」처럼 숫자의 단서 */
  note?: ReactNode
  /** 머리띠 오른쪽 버튼 (figure 와 함께 쓰지 않는다 — 자리가 하나다) */
  action?: ReactNode
  /**
   * 본문에 패딩을 주지 않는다.
   * 보드 컬럼·표처럼 **스스로 여백을 갖는 것**을 넣을 때 쓴다 — 안 그러면 여백이 두 겹이 된다.
   */
  bleed?: boolean
  children: ReactNode
}

export default function SectionSurface({ title, meta, figure, note, action, bleed, children }: Props) {
  return (
    <section className={styles.surface}>
      <header className={styles.head}>
        <h3 className={styles.title}>{title}</h3>
        {meta != null && <span className={styles.meta}>{meta}</span>}
        {(figure != null || note != null || action != null) && (
          <div className={styles.right}>
            {figure != null && <span className={styles.figure}>{figure}</span>}
            {note != null && <span className={styles.note}>{note}</span>}
            {action}
          </div>
        )}
      </header>
      <div className={bleed ? styles.bodyBleed : styles.body}>{children}</div>
    </section>
  )
}
