'use client'

// 견적번호 형식 입력 — 자유롭게 쓰되 **결과를 즉시 보여 준다**
//
// **왜 전용 입력인가**: `{SEQ}` 같은 표시를 설명 없이 자유 입력하게 두면 반드시 오타가
// 나고, 그 오타는 **고객에게 나간 문서**에서 발견된다. 그래서 ① 쓸 수 있는 표시를 곁에 두고
// ② 오늘 날짜로 만든 번호를 바로 보여 주고 ③ 잘못된 형식은 저장 전에 막는다.
//
// **드롭다운으로 가두지 않는 이유**: 회사마다 쓰는 형식이 다르고, 몇 가지를 고르게 하면
// 반드시 없는 형식이 나온다(사용자 지시: 「설정방식은 사용자가 자유롭게 할 수 있으면 좋을 것 같다」).

import {
  QUOTE_NO_TOKENS, QUOTE_NO_PRESETS, previewQuoteNo, validateQuoteNoPattern,
  seqScopeOf, SEQ_SCOPE_LABEL,
} from '@/lib/crm/domain/quote-number'
import styles from './quote-no-field.module.css'

interface Props {
  id: string
  value: string
  onChange: (next: string) => void
  /** 오늘(KST) — 미리보기를 만드는 기준. 화면이 시간을 정하지 않게 밖에서 받는다 */
  todayKey: string
}

export default function QuoteNoField({ id, value, onChange, todayKey }: Props) {
  const error = value.trim() ? validateQuoteNoPattern(value) : null
  const preview = error ? [] : previewQuoteNo(value, todayKey)
  const scope = seqScopeOf(value)

  return (
    <div className={styles.wrap}>
      <input
        id={id}
        className="input-field"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="DA-{YYYY}-{MMDD}-{SEQ:2}"
        aria-invalid={error ? true : undefined}
        aria-describedby={`${id}-preview`}
      />

      {/* 결과를 먼저 보여 준다 — 형식을 읽는 것보다 번호를 보는 것이 빠르다 */}
      <p id={`${id}-preview`} className={error ? styles.error : styles.preview}>
        {error ?? (
          <>
            <span className={styles.previewLabel}>이렇게 나옵니다</span>
            <b className={styles.sample}>{preview[0]}</b>
            <span className={styles.next}>다음 → {preview[1]}</span>
            <span className={styles.scope}>{SEQ_SCOPE_LABEL[scope]}</span>
          </>
        )}
      </p>

      <div className={styles.presets}>
        {QUOTE_NO_PRESETS.map((p) => (
          <button
            key={p.pattern}
            type="button"
            className={`${styles.preset}${p.pattern === value ? ` ${styles.presetOn}` : ''}`}
            onClick={() => onChange(p.pattern)}
          >
            {p.label}
          </button>
        ))}
      </div>

      <dl className={styles.tokens}>
        {QUOTE_NO_TOKENS.map((t) => (
          <div key={t.token} className={styles.token}>
            <dt>{t.token}</dt>
            <dd>{t.desc} <span className={styles.tokenSample}>{t.sample}</span></dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
