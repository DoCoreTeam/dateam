'use client'

// CSV 가져오기 — **못 읽은 줄을 보여 준다** (§6.1)
//
// KIS 분봉 조회는 과거로 한없이 가지 않는다. 모자란 구간은 증권사 프로그램에서
// 내보낸 CSV 로 채운다.
//
// 조용히 버리면 채운 줄 알고 넘어간다. 1-B 검증은 봉이 있는 만큼만 돌고,
// 없는 구간은 「그 구간에 신호가 없었다」로 보인다 — 결측과 무신호는 다른 사실이다.

import { useRef, useState, useTransition } from 'react'
import { FileUp } from 'lucide-react'
import { importTradingBarCsv } from './actions'

interface Props {
  contractCode: string | null
}

const TIMEFRAMES = [
  { value: '1m', label: '1분' },
  { value: '5m', label: '5분' },
  { value: '15m', label: '15분' },
] as const

export default function CsvImportPanel({ contractCode }: Props) {
  const [code, setCode] = useState(contractCode ?? '')
  const [tf, setTf] = useState<string>('1m')
  const [message, setMessage] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [pending, startTransition] = useTransition()
  const fileRef = useRef<HTMLInputElement>(null)

  function pick(file: File | undefined) {
    if (!file) return
    startTransition(async () => {
      const text = await file.text()
      const result = await importTradingBarCsv(code, tf, text)
      setFailed(!result.ok)
      setMessage(result.userMessage)
      if (fileRef.current) fileRef.current.value = ''
    })
  }

  return (
    <section className="card">
      <h2 style={{ fontSize: 'var(--fs-md)', fontWeight: 600, color: 'var(--text)', margin: 0, marginBottom: 'var(--space-2)' }}>
        <FileUp size={16} style={{ verticalAlign: '-2px', marginRight: 6 }} />
        CSV 로 봉 채우기
      </h2>
      <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', margin: 0, marginBottom: 'var(--space-3)' }}>
        증권사 프로그램에서 내보낸 봉을 올립니다. 머리글에 시각·시가·고가·저가·종가가 있으면
        이름이 달라도 읽습니다. 이미 모은 봉은 덮지 않습니다.
      </p>

      <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
        <div>
          <label className="label" htmlFor="csv-contract">월물 코드</label>
          <input
            id="csv-contract"
            className="input-field"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="101W10"
          />
        </div>
        <div>
          <label className="label" htmlFor="csv-tf">봉 종류</label>
          <select id="csv-tf" className="input-field" value={tf} onChange={(e) => setTf(e.target.value)}>
            {TIMEFRAMES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="csv-file">CSV 파일</label>
          <input
            id="csv-file"
            ref={fileRef}
            className="input-field"
            type="file"
            accept=".csv,text/csv"
            disabled={pending || code.trim() === ''}
            onChange={(e) => pick(e.target.files?.[0])}
          />
        </div>
      </div>

      {pending && (
        <p role="status" style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', margin: 'var(--space-2) 0 0' }}>
          읽고 저장하는 중입니다. 줄 수에 따라 시간이 걸립니다
        </p>
      )}
      {message && !pending && (
        <p
          role="status"
          style={{
            fontSize: 'var(--fs-sm)',
            color: failed ? 'var(--nb-danger)' : 'var(--text)',
            margin: 'var(--space-2) 0 0',
          }}
        >
          {message}
        </p>
      )}
    </section>
  )
}
