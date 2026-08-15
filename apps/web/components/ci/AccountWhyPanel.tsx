// components/ci/AccountWhyPanel.tsx — "이 계정에서 왜 이게 잘 됐나"
//
// 사용자가 시스템에 기대한 답이 이것이다. 배수는 **얼마나** 잘 됐는지고,
// 여기는 **왜**다 — 잘된 것들이 가졌고 평소 것들이 안 가진 특징.
//
// 근거가 없으면 빈 화면을 두지 않고 **왜 아직 말할 수 없는지**를 그대로 보여준다.
// 그래야 사용자가 "고장인가?"가 아니라 "게시물이 더 모이면 되겠구나"로 읽는다.

import type { ReactNode } from 'react'
import type { AccountContrast } from '@/lib/ci/analysis/account-contrast'
import EmptyState from '@/components/ui/EmptyState'

interface AccountWhyPanelProps {
  contrast: AccountContrast
  /** 제목. 시장 단위로도 같은 대조를 쓰므로 문구만 갈아 끼운다(부품은 하나다). */
  title?: string
  /**
   * 표본이 어떻게 구성됐는지. 시장 단위에서는 **반드시** 넘긴다 —
   * "채널 4곳 중 한 곳이 99%"를 숨기면 한 계정의 습관이 법칙처럼 읽힌다.
   */
  composition?: ReactNode
}

export default function AccountWhyPanel({
  contrast, title = '이 계정에서 왜 잘 됐나', composition,
}: AccountWhyPanelProps) {
  return (
    <section style={{ marginBottom: 'var(--space-6)' }}>
      <div style={{
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
        gap: 'var(--space-3)', marginBottom: 'var(--space-3)',
      }}>
        <h2 style={{ fontSize: 'var(--fs-md)', fontWeight: 700 }}>{title}</h2>
        {/* 근거는 항상 붙인다 — 표본 수를 숨기면 3건짜리 발견이 법칙처럼 읽힌다 */}
        <span className="ci-basis">{contrast.basisText}</span>
      </div>

      {/* 발견이 있든 없든 표본 구성은 먼저 보여준다 */}
      {composition && (
        <p className="ci-basis" style={{ marginBottom: 'var(--space-3)' }}>{composition}</p>
      )}

      {contrast.findings.length === 0 ? (
        <EmptyState
          title="아직 이유를 말할 근거가 부족합니다"
          description={contrast.insufficientReason ?? '게시물이 더 모이면 비교를 시작합니다.'}
        />
      ) : (
        <div className="card" style={{ padding: 'var(--space-3)' }}>
          <ul style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', margin: 0, paddingLeft: '1.1em' }}>
            {contrast.findings.map((f) => (
              <li key={`${f.dimension}:${f.text}`}>
                <span>{f.text}</span>
                {' '}
                <span className="ci-basis ci-num">근거 {f.winnerCount}건</span>
              </li>
            ))}
          </ul>
          {/* 무엇을 안 봤는지 밝힌다. 안 본 것을 침묵하면 "다 봤다"로 읽힌다. */}
          <p className="ci-basis" style={{ marginTop: 'var(--space-3)' }}>
            게시 형식·요일·시간대·소재·길이·제목만 비교했습니다. 영상 내용과 썸네일 구성은 이 비교에 들어가지 않았습니다.
          </p>
        </div>
      )}
    </section>
  )
}
