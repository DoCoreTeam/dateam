'use client'

// 통합 입력(멀티모달) — CSV/표 붙여넣기 경로
//   텍스트/이미지/URL의 AI 추출은 기존 통합입력(QuoteRegisterTab)이 담당.
//   본 컴포넌트는 새 역량인 "CSV/표 붙여넣기"를 csv-intake(파서·헤더 매핑·수식 인젝션 무력화)로 처리하고
//   sanitize된 미리보기 그리드를 보여준 뒤, 검토 대기로 보낼 행을 부모에 콜백.
// CSV 행은 AI 신뢰도가 없으므로 전량 "검토 필요"(사람 확정) — 자동 확정 안 함(§5-3 준수).

import { useState } from 'react'
import { GPU_TERMS } from '@/lib/gpu/terms'
import { csvToIntakeRows } from '@/lib/gpu/csv-intake'
import type { CsvFieldKey, CsvIntakeResult } from '@/lib/gpu/csv-intake'

const FIELD_LABEL: Record<CsvFieldKey, string> = {
  model_name: GPU_TERMS.model,
  memory: '메모리',
  supplier: GPU_TERMS.supplier,
  unit_price_usd: GPU_TERMS.supplyCost,
  term: '약정',
  min_qty: '최소수량',
  valid_until: '유효기간',
  quantity: '수량',
}
const FIELD_ORDER: CsvFieldKey[] = ['model_name', 'memory', 'supplier', 'unit_price_usd', 'term', 'min_qty', 'valid_until', 'quantity']

interface MultimodalIntakeProps {
  /** 검토 대기로 보낼 행(매핑된 표준 필드). 저장은 부모(통합입력 라우팅)에서 수행. */
  onRows?: (rows: Partial<Record<CsvFieldKey, string>>[]) => void
}

export default function MultimodalIntake({ onRows }: MultimodalIntakeProps) {
  const [text, setText] = useState('')
  const [result, setResult] = useState<CsvIntakeResult | null>(null)

  const analyze = () => {
    const r = csvToIntakeRows(text)
    setResult(r)
  }

  const usedFields = result
    ? FIELD_ORDER.filter((f) => result.mapping.includes(f))
    : []

  return (
    <div className="gpu-mmi">
      <label className="gpu-mmi-label" htmlFor="gpu-mmi-textarea">
        CSV·표 붙여넣기 <span className="gpu-mmi-hint">헤더 포함</span>
      </label>
      <textarea className="input-field gpu-mmi-textarea" id="gpu-mmi-textarea"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={'모델,메모리,공급사,단가\nH100 80GB,80GB,RunPod,2.35'}
        rows={5}
      />
      <div className="gpu-mmi-actions">
        <button type="button" className="gpu-btn gpu-btn-primary" onClick={analyze} disabled={!text.trim()}>
          분석
        </button>
        {result && result.rows.length > 0 && onRows && (
          <button type="button" className="gpu-btn" onClick={() => onRows(result.rows)}>
            검토 대기로 보내기 ({result.rows.length})
          </button>
        )}
      </div>

      {result && (
        <div className="gpu-mmi-result">
          {result.unmappedHeaders.length > 0 && (
            <p className="gpu-udetail-pending">
              매핑되지 않은 열: {result.unmappedHeaders.join(', ')} (무시됨)
            </p>
          )}
          {result.rows.length === 0 ? (
            <p className="gpu-udetail-pending">인식된 행이 없습니다. 헤더와 구분자를 확인하세요.</p>
          ) : (
            <table className="gpu-udetail-tbl">
              <thead>
                <tr>{usedFields.map((f) => <th key={f}>{FIELD_LABEL[f]}</th>)}</tr>
              </thead>
              <tbody>
                {result.rows.map((row, i) => (
                  <tr key={i}>
                    {usedFields.map((f) => <td key={f}>{row[f] ?? '—'}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}
