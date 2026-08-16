'use client'

// 갭필 모달 (dacrm T1-05, 구현명세 §6.4)
//
// 원칙(명세 그대로): **묻는 필드는 최대 3개**, 건너뛰기를 허용한다.
// 다 물으면 폼을 새로 채우는 것과 같아져서 "붙여넣기 한 번"의 뜻이 사라진다.
//
// 만들어진 것을 먼저 보여 주는 이유: 사용자가 알고 싶은 첫 번째는
// "그래서 뭐가 생겼나"이지 "무엇이 빠졌나"가 아니다.

import { useState } from 'react'
import Link from 'next/link'
import NbModal from '@/components/ui/nb/NbModal'
import NbButton from '@/components/ui/nb/NbButton'
import FormErrorBanner from '@/components/ui/FormErrorBanner'
import type { BoardPipeline } from './DealBoard'

export interface TouchedRecord {
  type: 'company' | 'person' | 'deal'
  id: string
  name: string
}

export interface Gap {
  target: 'company' | 'person' | 'deal'
  field: string
  label: string
  blocking: boolean
}

export interface QuickCreateResult {
  created: TouchedRecord[]
  linked: TouchedRecord[]
  gaps: Gap[]
  runId: string
  text: string
}

interface Props {
  result: QuickCreateResult
  pipelines: BoardPipeline[]
  onClose: () => void
  onFilled: () => void
}

const TYPE_LABEL: Record<TouchedRecord['type'], string> = {
  company: '회사', person: '인물', deal: '딜',
}

const HREF: Record<TouchedRecord['type'], string> = {
  company: '/crm/companies', person: '/crm/people', deal: '/crm/deals',
}

/** 명세 §6.4 "묻는 필드는 최대 3개" */
const MAX_ASK = 3

export default function GapFillModal({ result, pipelines, onClose, onFilled }: Props) {
  // 막는 것부터 묻는다 — 그게 없으면 레코드 자체가 안 만들어졌다
  const asks = [...result.gaps].sort((a, b) => Number(b.blocking) - Number(a.blocking)).slice(0, MAX_ASK)
  const company = [...result.created, ...result.linked].find((r) => r.type === 'company')

  const [values, setValues] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const key = (g: Gap) => `${g.target}.${g.field}`

  /**
   * 지금 채울 수 있는 것만 채운다.
   *
   * 회사 이름이 빠져 회사가 아예 안 만들어진 경우, 여기서 이름만 받아 회사를 만든다.
   * 나머지(딜 이름·금액 등)는 그 레코드가 있어야 채울 수 있으므로 안내만 하고 화면으로 보낸다 —
   * 여기서 다 처리하려 들면 이 모달이 곧 세 번째 폼이 된다.
   */
  async function submit() {
    const name = values['company.name']?.trim()
    if (!name) { onClose(); return }

    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/crm/companies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const body = await res.json()
      if (!res.ok) { setError(body?.error?.message ?? '저장하지 못했습니다.'); return }
      onFilled()
      onClose()
    } catch {
      setError('저장하지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setBusy(false)
    }
  }

  const fillable = asks.filter((g) => g.target === 'company' && g.field === 'name')
  const notice = asks.filter((g) => !fillable.includes(g))

  // 아무것도 안 만들어졌는데 "등록했어요"라고 하면 거짓말이다(실브라우저에서 잡음)
  const madeSomething = result.created.length > 0 || result.linked.length > 0

  return (
    <NbModal
      title={madeSomething ? '등록했어요' : '조금 더 알려 주세요'}
      onClose={onClose}
      maxWidth={520}
      footer={
        <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
          {/* 건너뛰기 허용(명세 §6.4) — 지금 모르는 것을 강제로 채우게 하지 않는다 */}
          <NbButton variant="ghost" onClick={onClose} disabled={busy}>나중에</NbButton>
          {fillable.length > 0 && (
            <NbButton onClick={() => void submit()} disabled={busy || !values['company.name']?.trim()}>
              {busy ? '저장 중…' : '저장'}
            </NbButton>
          )}
        </div>
      }
    >
      <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
        <FormErrorBanner message={error} />

        {result.created.length > 0 && (
          <div>
            <span className="label">새로 만든 것</span>
            <ul style={{ margin: 0, paddingLeft: '1.1em', display: 'grid', gap: 2 }}>
              {result.created.map((r) => (
                <li key={r.id} style={{ fontSize: 'var(--fs-sm)' }}>
                  {TYPE_LABEL[r.type]} · <Link href={`${HREF[r.type]}/${r.id}`}>{r.name}</Link>
                </li>
              ))}
            </ul>
          </div>
        )}

        {result.linked.length > 0 && (
          <div>
            <span className="label">이미 있어서 이어 붙인 것</span>
            <ul style={{ margin: 0, paddingLeft: '1.1em', display: 'grid', gap: 2 }}>
              {result.linked.map((r) => (
                <li key={r.id} style={{ fontSize: 'var(--fs-sm)' }}>
                  {TYPE_LABEL[r.type]} · <Link href={`${HREF[r.type]}/${r.id}`}>{r.name}</Link>
                </li>
              ))}
            </ul>
          </div>
        )}

        {fillable.map((g) => (
          <div key={key(g)}>
            <label className="label" htmlFor={`gap-${key(g)}`}>{g.label}</label>
            <input
              id={`gap-${key(g)}`} className="input-field"
              value={values[key(g)] ?? ''}
              onChange={(e) => setValues((v) => ({ ...v, [key(g)]: e.target.value }))}
              placeholder="붙여넣은 글에서 찾지 못했어요"
              autoFocus
            />
          </div>
        ))}

        {notice.length > 0 && (
          <div>
            <span className="label">아직 비어 있는 것</span>
            <ul style={{ margin: 0, paddingLeft: '1.1em', display: 'grid', gap: 2 }}>
              {notice.map((g) => (
                <li key={key(g)} style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-muted)' }}>
                  {g.label}
                  {company && g.target === 'deal' && (
                    <> — <Link href={`/crm/companies/${company.id}`}>{company.name}</Link> 에서 딜을 만들 때 채우면 됩니다</>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {result.created.length === 0 && result.linked.length === 0 && (
          <p style={{ margin: 0, fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
            붙여넣은 글에서 회사나 담당자를 찾지 못했어요. 회사 이름을 알려 주시면 그것부터 만들어 둘게요.
          </p>
        )}

        {pipelines.length === 0 && (
          <p style={{ margin: 0, fontSize: 'var(--fs-2xs)', color: 'var(--text-muted)' }}>
            파이프라인이 없어 딜은 만들지 않았습니다.
          </p>
        )}
      </div>
    </NbModal>
  )
}
