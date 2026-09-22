/**
 * 사람 한 명 — 이름 옆에 직책이 붙는 한 벌
 *
 * **왜 부품으로 두나**: 사람이 나오는 자리가 화면마다 제각각이었다. 멤버 목록은 이름과 메일만,
 * 견적서만 「김도현 본부장」, 담당자 칸은 아직 없었다. 자리마다 각자 그리면 한 곳을 고쳐도
 * 나머지는 그대로 남는다. 고르는 규칙은 `lib/ui/person.ts` 가 한 곳에서 정한다.
 *
 * 값이 없으면 **없다고 말한다.** 비어 있는 칸에 그럴듯한 이름을 채우지 않는다 —
 * 작성자를 못 찾은 행이 실제로 있고(거래처 383건 중 373건), 그 행은 「기록 없음」이 맞는 답이다.
 */

import { personDisplay, type PersonSource } from '@/lib/ui/person'
import styles from './Person.module.css'

export interface PersonProps extends PersonSource {
  /** 값이 아예 없을 때 대신 쓸 말. 예: 기록 없음, 담당자 없음 */
  emptyLabel?: string
  /** 담당자가 아니라 조직 상위가 대신 맡고 있다 — 색과 표식으로 구분된다 */
  acting?: boolean
  /** 이름 아래로 직책을 접는다. 표 한 칸처럼 좁은 자리에서 쓴다 */
  stacked?: boolean
  /** 동그라미를 안 그린다. 문장 안에 섞어 쓸 때 */
  noAvatar?: boolean
  /** 흐린 동그라미 — 내가 아닌 사람을 옅게 그릴 때 */
  muted?: boolean
  /** 마우스를 올렸을 때 나오는 설명. 대행이면 왜 이 사람인지를 적는다 */
  tooltip?: string
}

export default function Person({
  emptyLabel = '기록 없음',
  acting = false,
  stacked = false,
  noAvatar = false,
  muted = false,
  tooltip,
  ...src
}: PersonProps) {
  // 이름도 직함도 없으면 사람이 없는 것이다. 「이름 없음」을 그리는 것보다 정확하다
  const hasAnyone = Boolean((src.name ?? '').trim())
  if (!hasAnyone) return <span className={styles.none}>{emptyLabel}</span>

  const { name, title, initial } = personDisplay(src)
  const avatarClass = [styles.avatar, acting ? styles.acting : '', muted ? styles.muted : '']
    .filter(Boolean).join(' ')

  return (
    <span className={styles.root} title={tooltip}>
      {!noAvatar && <span className={avatarClass} aria-hidden="true">{initial}</span>}
      <span className={`${styles.body} ${stacked ? styles.stacked : ''}`}>
        <span className={styles.name}>{name}</span>
        {title && <span className={styles.title}>{title}</span>}
      </span>
      {acting && <span className={styles.actingMark} title="담당자가 정해지지 않아 조직 상위가 맡고 있습니다">대행</span>}
    </span>
  )
}
