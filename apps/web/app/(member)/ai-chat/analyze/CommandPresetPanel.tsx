'use client'

import type { AnalysisLens } from './actions'

export interface LensPreset {
  id: AnalysisLens
  label: string
  instruction: string
}

export const LENS_PRESETS: LensPreset[] = [
  {
    id: 'summary',
    label: '요약',
    instruction: '핵심요지 / 배경·근거 / 리스크 / 다음 액션 섹션을 포함해 마크다운으로 핵심을 요약하라.',
  },
  {
    id: 'risk',
    label: '리스크',
    instruction: '리스크·우려사항 관점에서 잠재 위험, 발생 가능성·영향도, 완화 방안을 짚어라.',
  },
  {
    id: 'action-plan',
    label: '실행계획',
    instruction: '실행계획 관점에서 구체적인 다음 액션·담당·기한 후보를 단계별로 제시하라.',
  },
  {
    id: 'evidence',
    label: '근거',
    instruction: '근거·출처 점검 관점에서 주장의 근거가 충분한지, 확인이 필요한 부분을 짚어라.',
  },
  {
    id: 'compare',
    label: '비교',
    instruction: '비교·대안 검토 관점에서 대안들의 장단점을 표로 비교하고 권고안을 제시하라.',
  },
]

interface Props {
  lens: AnalysisLens
  command: string
  onSelectLens: (lens: AnalysisLens, instruction: string) => void
  onCommandChange: (v: string) => void
}

/** 목록 심층분석 v2 — lens 5종을 명령 프리셋 칩으로 노출(§ 자유 command가 상위). */
export default function CommandPresetPanel({ lens, command, onSelectLens, onCommandChange }: Props) {
  return (
    <div className="card" style={{ padding: 'var(--space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <span className="tape-title">분석 명령</span>
      <div role="group" aria-label="분석 관점 프리셋" style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
        {LENS_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            onClick={() => onSelectLens(preset.id, preset.instruction)}
            aria-pressed={lens === preset.id}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              minHeight: 32,
              fontSize: 'var(--fs-sm)',
              padding: '0.35rem 0.85rem',
              borderRadius: 'var(--radius)',
              border: `var(--border-w) solid ${lens === preset.id ? 'var(--brand)' : 'var(--border-color)'}`,
              background: lens === preset.id ? 'var(--surface-bg)' : 'transparent',
              cursor: 'pointer',
              color: 'var(--text)',
              fontWeight: lens === preset.id ? 700 : 500,
            }}
          >
            {preset.label}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
        <label className="label" htmlFor="analyze-command">
          자유 지시(위 칩을 눌러 채우거나 직접 입력 — 이 내용이 실제 분석을 지배합니다)
        </label>
        <textarea className="input-field"
          id="analyze-command"
          rows={3}
          value={command}
          onChange={(e) => onCommandChange(e.target.value)}
          placeholder="예: 비용 관점에서도 짚어줘, 경쟁사 대비 관점 추가해줘, 표로 정리해줘"
          style={{ resize: 'vertical', fontFamily: 'inherit' }}
        />
      </div>
    </div>
  )
}
