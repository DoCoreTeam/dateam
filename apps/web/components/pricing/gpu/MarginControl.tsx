'use client'

// gcube 판매 마진(%) 설정 — 공용 컨트롤(SSOT).
//   - 저장 경로: PATCH /api/pricing/gpu/settings (margin_pct). 서버에서 관리자 게이트.
//   - 관리자: 프리셋 + −/+ + 직접 입력으로 변경. 비관리자: 읽기 전용 표시.
//   - 저장 성공 → onSaved() 로 관련 데이터 revalidate(자동가 재계산 반영)는 호출측 책임.

import { useCallback, useState } from 'react'

const PRESETS = [15, 18, 20, 25] as const

interface MarginControlProps {
  /** 현재 적용 마진(%) — 서버 설정값(pricing_settings.margin_pct). */
  marginPct: number
  /** 관리자만 편집 가능(서버도 동일 게이트). 비관리자는 읽기 전용. */
  isAdmin: boolean
  /** 저장 성공 후 콜백 — 가격 데이터 revalidate 용도. */
  onSaved?: () => void
}

export default function MarginControl({ marginPct, isAdmin, onSaved }: MarginControlProps) {
  // 낙관적 표시값: 저장 중 입력값을 유지하다 성공 시 서버값으로 복귀.
  const [override, setOverride] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)
  const value = override ?? marginPct

  const save = useCallback(async (val: number) => {
    if (!Number.isFinite(val) || val < 0 || val > 999) return
    setSaving(true)
    setFailed(false)
    try {
      const res = await fetch('/api/pricing/gpu/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ margin_pct: val }),
      })
      if (res.ok) {
        setOverride(null)
        onSaved?.()
      } else {
        setFailed(true) // 서버 거부(권한·검증) — 입력값 유지, 재시도 가능
      }
    } catch {
      setFailed(true) // 네트워크 오류 — 입력값 유지(사용자가 재시도)
    } finally {
      setSaving(false)
    }
  }, [onSaved])

  // 빈 입력/비수치는 NaN 대신 현재 서버값으로 폴백(NaN이 state에 들어가 UI 잠기는 것 방지).
  const handleInput = (raw: string) => {
    const n = raw === '' ? NaN : Number(raw)
    setOverride(Number.isFinite(n) ? n : marginPct)
  }

  if (!isAdmin) {
    return (
      <div className="gpu-margin-ctrl gpu-margin-ctrl--ro" title="gcube 판매 마진 (관리자만 변경)">
        <span className="gpu-margin-ctrl-lbl">마진</span>
        <strong className="gpu-mono">{value}%</strong>
      </div>
    )
  }

  return (
    <div className="gpu-margin-ctrl" role="group" aria-label="gcube 판매 마진 설정">
      <span className="gpu-margin-ctrl-lbl">마진</span>
      {PRESETS.map((p) => (
        <button
          key={p}
          type="button"
          className={`gpu-margin-preset${value === p ? ' on' : ''}`}
          onClick={() => { setOverride(p); save(p) }}
        >
          {p}%
        </button>
      ))}
      <div className="gpu-margin-stepper">
        <button type="button" aria-label="마진 1% 감소" onClick={() => { const v = Math.max(0, value - 1); setOverride(v); save(v) }}>−</button>
        <input className="input-field gpu-margin-input"
          type="number"
          value={value}
          min={0}
          max={999}
          onChange={(e) => handleInput(e.target.value)}
          onBlur={() => save(value)}
          aria-label="마진 퍼센트"
        />
        <span className="gpu-margin-pct">%</span>
        <button type="button" aria-label="마진 1% 증가" onClick={() => { const v = value + 1; setOverride(v); save(v) }}>+</button>
      </div>
      {saving && <span className="gpu-margin-saving">저장 중…</span>}
      {!saving && failed && <span className="gpu-margin-saving gpu-margin-saving--err" role="alert">저장 실패</span>}
    </div>
  )
}
