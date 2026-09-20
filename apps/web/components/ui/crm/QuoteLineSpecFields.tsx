'use client'

/**
 * 한 항목의 **규격과 비고** 칸.
 *
 * ## 왜 따로 떨어져 있나
 *
 * 편집 모달이 800줄 상한에 닿았다(`lib/ui/quote-layout.test.ts`). 한 파일이 세 가지 일을
 * 하면 고칠 자리를 못 찾으므로, 줄 하나를 설명하는 두 칸을 통째로 여기로 옮겼다.
 *
 * ## 규격과 비고는 왜 다른 칸인가
 *
 * **규격은 물건이 무엇인가**다 — 「AMD EPYC 9355 32C/64T」.
 * **비고는 이 견적에서 그 줄이 무슨 구실인가**다 — 「서버 새시」「64코어」「Raid5」.
 * 우리 견적서 양식에는 둘 다 자리가 있는데 폼에 비고 칸이 없어 아무도 못 채웠고,
 * 원본에 적혀 있어도 읽는 순간 버려졌다(사용자 지적 2026-09-21: 「비고는 왜 없는거야」).
 */

import { QUOTE, fillSpecSplit } from '@/lib/terms'
import { splitSpec, splitInlineMarks } from '@/lib/crm/domain/quote-spec'
import styles from './quote-panel.module.css'

/**
 * 비고 길이 상한 — 표 한 칸에 들어갈 말이지 문단이 아니다.
 * 읽어 온 값도 스키마가 같은 뜻으로 자른다(`ai/schemas/quote-draft.ts`).
 */
export const MAX_REMARK = 100

/**
 * 적힌 글을 줄로 나눈 모양을 돌려준다. **나눌 것이 없으면 `null`** —
 * 단추를 낼지 말지가 이 한 값으로 갈린다.
 */
export function splitMarks(descriptionMd: string): string | null {
  const written = descriptionMd.split('\n').map((l) => l.trim()).filter(Boolean)
  if (written.length !== 1) return null
  const pieces = splitInlineMarks(written[0])
  return pieces.length >= 2 ? pieces.join('\n') : null
}

interface Props {
  /** 몇 번째 줄인가 — 라벨과 입력을 잇는 id 에 쓴다 */
  index: number
  spec: string
  remark: string
  locked: boolean
  onSpec: (value: string) => void
  onRemark: (value: string) => void
}

export default function QuoteLineSpecFields({ index, spec, remark, locked, onSpec, onRemark }: Props) {
  const split = splitMarks(spec)
  return (
    <>
      {/*
        규격·설명 — 견적서에서 품목 이름 아래 작게 인쇄된다.
        DB 에는 자리가 있었는데 폼에 칸이 없어 **아무도 못 채웠다**.
        「H100 80GB」만으로는 SXM 인지 PCIe 인지 고객이 알 수 없다.
      */}
      <label className="label" htmlFor={`ln-spec-${index}`}>{QUOTE.lineSpec}</label>
      {/*
        **여러 줄이다.** 한 줄 칸이던 동안 파일에서 읽은 구성 열세 줄이 들어올 자리가
        없었고(실측 2026-09-20), 사람이 손으로 적을 수도 없었다. 첫 줄이 규격,
        아래가 구성이다 — 인쇄도 같은 약속으로 그린다(`lib/crm/domain/quote-spec.ts`).
      */}
      <textarea
        id={`ln-spec-${index}`}
        className={`input-field ${styles.specInput}`}
        rows={2}
        value={spec}
        disabled={locked}
        onChange={(e) => onSpec(e.target.value)}
        placeholder={QUOTE.lineSpecPlaceholder}
      />
      {/*
        **어떻게 갈리는지 그 자리에서 보여 준다.** 「여러 줄로 적으세요」라고만 하면
        적고 나서도 어디까지가 규격인지 모른다 — 지금 적은 글이 몇 줄로 갈리는지
        숫자로 보여 줘야 안다(사용자 지적 2026-09-21).
      */}
      <p className={styles.specHint}>
        <span>{QUOTE.lineSpecSplitHint}</span>
        <b>{fillSpecSplit(splitSpec(spec).components.length)}</b>
      </p>
      {/*
        **보이기만 가르면 저장본은 그대로다.** 파일에서 읽어 온 규격은 줄바꿈 없이
        한 덩어리로 오는 일이 있고, 화면만 갈라 두면 다음에 고치는 사람이 또 한 덩어리를
        본다 — 누르면 적힌 글 자체가 줄로 나뉜다(사용자 지시 2026-09-21:
        「견적쪽에 입력할 때도 그렇게 자동으로 줄바꾼거는 처리 해주면 되자나」).

        표식이 없으면 단추를 내지 않는다. 눌러도 아무 일이 없는 단추는 고장으로 읽힌다.
      */}
      {!locked && split !== null && (
        <button type="button" className={styles.specSplitAction} onClick={() => onSpec(split)}>
          {QUOTE.lineSpecSplitAction}
        </button>
      )}
      {/*
        **비고는 규격과 다른 칸이다.** 규격 칸 아래에 둔다 — 둘은 같은 줄을 설명하는
        말이라 떨어져 있으면 적는 사람이 둘 중 어디에 적을지 헷갈린다.
      */}
      <label className={`label ${styles.remarkLabel}`} htmlFor={`ln-remark-${index}`}>
        {QUOTE.lineRemark}
      </label>
      <input
        id={`ln-remark-${index}`}
        className="input-field"
        value={remark}
        disabled={locked}
        maxLength={MAX_REMARK}
        onChange={(e) => onRemark(e.target.value)}
        placeholder={QUOTE.lineRemarkPlaceholder}
      />
    </>
  )
}
