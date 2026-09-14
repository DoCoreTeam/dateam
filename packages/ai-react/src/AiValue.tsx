/**
 * One AI value, drawn the same way everywhere.
 *
 * This file draws only. Every decision about what appears is in value.ts, because the test
 * runner cannot read .tsx and a rule it cannot read is a rule nobody keeps.
 */

import type { ReactNode } from 'react'
import type { AiValue as AiValueShape } from '@ax/ai-core'
import type { AiLabels } from './labels.ts'
import { confidenceView, statusText, isSettled, sourceView } from './value.ts'

export interface AiValueProps {
  value: AiValueShape
  labels: AiLabels
  /** How to draw the value itself. The caller knows whether it is money, a date or prose */
  render: (value: unknown) => ReactNode
  /** Written under an older contract than this build reads */
  older?: boolean
  className?: string
}

export function AiValue({ value, labels, render, older, className }: AiValueProps) {
  const conf = confidenceView(value.confidence, labels)
  const src = sourceView(value.source)
  return (
    <span
      className={className}
      data-ai-value="true"
      data-ai-status={value.status}
      data-ai-settled={isSettled(value.status) ? 'true' : 'false'}
    >
      <span data-ai-part="value">{render(value.value)}</span>
      <span data-ai-part="status">{statusText(value.status, labels)}</span>
      <span data-ai-part="confidence" data-low={conf.kind === 'known' && conf.low ? 'true' : 'false'}>
        {labels.confidence} {conf.text}
      </span>
      <span data-ai-part="source" title={src.at}>{src.text}</span>
      {older ? <span data-ai-part="older">{labels.olderContract}</span> : null}
    </span>
  )
}
