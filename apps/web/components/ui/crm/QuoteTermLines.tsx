'use client'

/**
 * 저장된 견적의 거래 조건 문구를 줄마다 고치고 지운다 (P0186, 요구 REQ-087)
 *
 * 공급자 기본 조건은 새 견적이 처음 굳을 때만 쓴다. 그 뒤로 견적서에 찍히는 것은
 * 이 견적에 저장된 문구이고, 여기서 고친 그대로 조회 문서 PDF 엑셀에 나간다.
 * 등록된 조건은 지우지 않고 「넣기」로 줄 끝에 붙인다, 고른 순서가 인쇄 순서다.
 */
import { Plus, X } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import { QuoteFold } from './QuoteTotals'
import { QUOTE, QUOTE_TERMS_EDIT } from '@/lib/terms'
import styles from './quote-panel.module.css'

interface TermPreset {
  id: string
  title: string
  body: string
}

interface QuoteTermLinesProps {
  lines: string[]
  presets: TermPreset[]
  /** 보낸 견적은 고객이 든 문서와 같아야 해서 잠근다, 고른 조건 체크와 같은 규칙 */
  locked: boolean
  onChange: (lines: string[]) => void
}

export default function QuoteTermLines({ lines, presets, locked, onChange }: QuoteTermLinesProps) {
  const filled = lines.some((l) => l.trim() !== '')
  const setAt = (i: number, value: string) => onChange(lines.map((l, idx) => (idx === i ? value : l)))
  const removeAt = (i: number) => onChange(lines.filter((_, idx) => idx !== i))

  return (
    <QuoteFold title={QUOTE.terms} filled={filled}>
      <p className={styles.termHint}>{QUOTE_TERMS_EDIT.hint}</p>
      {lines.length === 0 && <p className={styles.termHint}>{QUOTE_TERMS_EDIT.empty}</p>}
      <ol className={styles.termLines}>
        {lines.map((line, i) => (
          // 줄 순서가 곧 인쇄 순서라 자리 번호가 이 줄의 이름이다
          <li key={i} className={styles.termLine}>
            <input
              className="input-field"
              value={line}
              disabled={locked}
              aria-label={QUOTE_TERMS_EDIT.line(i + 1)}
              onChange={(e) => setAt(i, e.target.value)}
            />
            {!locked && (
              <button
                type="button"
                className={styles.lineRemove}
                aria-label={QUOTE_TERMS_EDIT.remove(i + 1)}
                onClick={() => removeAt(i)}
              >
                <X size={16} />
              </button>
            )}
          </li>
        ))}
      </ol>
      {!locked && (
        <div className={styles.termActions}>
          <NbButton variant="ghost" onClick={() => onChange([...lines, ''])}>
            <Plus size={16} /> {QUOTE_TERMS_EDIT.add}
          </NbButton>
        </div>
      )}
      {!locked && presets.length > 0 && (
        <details className={styles.termPresets}>
          <summary>{QUOTE_TERMS_EDIT.presets}</summary>
          <ul className={styles.termList}>
            {presets.map((t) => (
              <li key={t.id} className={styles.termPreset}>
                <span className={styles.termBody}>{t.body}</span>
                <NbButton variant="ghost" onClick={() => onChange([...lines, t.body])}>
                  {QUOTE_TERMS_EDIT.insert}
                </NbButton>
              </li>
            ))}
          </ul>
        </details>
      )}
    </QuoteFold>
  )
}
