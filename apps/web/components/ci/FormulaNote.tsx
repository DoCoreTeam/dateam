// components/ci/FormulaNote.tsx — "따라 만든다면" 한 줄 (전 화면 공용)
//
// 영상을 읽어 뽑은 재현 공식은 이 제품이 사용자에게 건네는 **가장 실행 가능한 한 줄**이다.
// 상세 시트에서 보고, 아이디어를 만들 때 이어받는다 — 두 곳이 다르게 생기면
// 사용자는 같은 문장을 다른 것으로 읽는다.

import styles from './formula-note.module.css'

interface Props {
  formula: string | null | undefined
  /** 통한 이유 — 있으면 공식 아래에 근거로 붙는다 */
  why?: string | null
}

export default function FormulaNote({ formula, why }: Props) {
  if (!formula) return null
  return (
    <div className={styles.wrap}>
      <p className={styles.formula}>따라 만든다면 — {formula}</p>
      {why && <p className={styles.why}>통한 이유 — {why}</p>}
    </div>
  )
}
