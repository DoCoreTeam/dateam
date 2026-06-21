'use client'

// 통합 표 상세 — '가격 결정' 탭 본문 (P1: 콕핏 가격 결정 기능 이식).
//   - 추천 판매가: 공급원가 × 마진 근거 한 줄 (계산 없음 — cockpit 값 표시만, R1).
//   - 전략가(우리 판매가): 인라인 수정(reason) + [추천가로 반영]. PATCH /strategic-price 기존 API 호출만.
//   - gcube 홈페이지 파싱가: GET /gcube-check 재사용 + GcubeSyncBadge.
// 쓰기는 admin API(requireAdminApi)가 막음 — 실패 시 사용자 메시지. 저장 성공 시 cockpit mutate.

import { useState } from 'react'
import useSWR, { useSWRConfig } from 'swr'
import { fetcher } from '@/lib/swr-config'
import { GPU_TERMS } from '@/lib/gpu/terms'
import { fmtMoneyFromKrw } from '@/lib/gpu/format-price'
import type { CurrencyCtx, UnifiedRow } from '@/lib/gpu/unified-row'
import { GcubeSyncBadge } from '@/components/pricing/gpu/cockpit/GcubeSyncBadge'
import type { GcubeCheckItem } from '@/app/api/pricing/gpu/gcube-check/route'
import { basisSourceLabel } from './DetailPanel'

const COCKPIT_KEY = '/api/pricing/gpu/cockpit'

interface PricingDecisionSectionProps {
  row: UnifiedRow
  currency: CurrencyCtx
}

function formatDate(ts: string): string {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ts
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export default function PricingDecisionSection({ row, currency }: PricingDecisionSectionProps) {
  const mKrw = (krw: number | null) => fmtMoneyFromKrw(krw, currency.mode, currency.usdKrw)
  const { mutate } = useSWRConfig()

  const [editing, setEditing] = useState(false)
  const [priceInput, setPriceInput] = useState('')
  const [reasonInput, setReasonInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [reflecting, setReflecting] = useState(false)
  const [reflectMsg, setReflectMsg] = useState<string | null>(null)

  // gcube 파싱가 — 이 탭에서만 fetch(상세 패널이 가격 결정 탭일 때 마운트됨).
  const { data: gcubeData } = useSWR<{ items: GcubeCheckItem[] }>(
    '/api/pricing/gpu/gcube-check',
    fetcher,
  )
  const gcubeItem = gcubeData?.items?.find((it) => it.product_id === row.id)

  function startEdit() {
    setPriceInput(row.strategic_price_krw != null ? String(row.strategic_price_krw) : '')
    setReasonInput('')
    setMsg(null)
    setEditing(true)
  }

  async function patchStrategic(strategicPriceKrw: number | null, reason: string | null) {
    setSaving(true)
    setMsg(null)
    try {
      const res = await fetch('/api/pricing/gpu/strategic-price', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: row.id,
          strategic_price_krw: strategicPriceKrw,
          ...(reason ? { reason } : {}),
        }),
      })
      const j = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        setMsg(j.error ?? '저장에 실패했습니다. 권한을 확인하세요.')
        return false
      }
      setEditing(false)
      await mutate(COCKPIT_KEY)
      return true
    } catch {
      setMsg('저장 중 오류가 발생했습니다.')
      return false
    } finally {
      setSaving(false)
    }
  }

  async function saveEdit() {
    const n = Number(priceInput)
    if (!Number.isFinite(n) || n <= 0) {
      setMsg('판매가는 0보다 큰 숫자여야 합니다.')
      return
    }
    await patchStrategic(Math.round(n), reasonInput.trim() || null)
  }

  async function promoteAuto() {
    if (row.auto_price_krw == null) return
    await patchStrategic(row.auto_price_krw, '추천가 반영')
  }

  async function markReflected() {
    setReflecting(true)
    setReflectMsg(null)
    try {
      const res = await fetch('/api/pricing/gpu/gcube-reflected', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_ids: [row.id] }),
      })
      const j = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        setReflectMsg(j.error ?? '반영 완료 마킹에 실패했습니다. 권한을 확인하세요.')
        return
      }
      await mutate(COCKPIT_KEY)
    } catch {
      setReflectMsg('반영 완료 마킹 중 오류가 발생했습니다.')
    } finally {
      setReflecting(false)
    }
  }

  const strategicLabel = row.is_strategic_set ? '설정됨' : '자동(추천가)'

  // 추천 근거 줄 마진 = (추천가 − 공급원가)/공급원가. row.margin_pct(전략가 설정 시 실효마진)와 다름:
  //   이 줄은 "공급원가 × (1+마진) = 추천가"를 설명하므로 추천가와 정합하는 마진을 표시해야 한다.
  //   (전략가 실효마진은 패널 상단 요약·전략가 옆에 별도 표시됨)
  const recoMarginPct =
    row.auto_price_krw != null && row.supply_cost_krw != null && row.supply_cost_krw > 0
      ? ((row.auto_price_krw - row.supply_cost_krw) / row.supply_cost_krw) * 100
      : null

  return (
    <div className="gpu-udetail-pricing">
      {/* 추천 판매가 + 근거 한 줄 */}
      <div className="gpu-udetail-kv">
        <span className="gpu-udetail-kv-k">{GPU_TERMS.sellPrice} 추천</span>
        <span className="gpu-udetail-kv-v gpu-udetail-price-lg">{mKrw(row.auto_price_krw)}</span>
      </div>
      <p className="gpu-udetail-basis">
        {GPU_TERMS.supplyCost} {mKrw(row.supply_cost_krw)} · {GPU_TERMS.margin}{' '}
        {recoMarginPct == null ? '측정불가' : `+${recoMarginPct.toFixed(0)}%`} · 출처 {basisSourceLabel(row)}
      </p>

      {/* 전략가(우리 판매가) */}
      <div className="gpu-udetail-kv">
        <span className="gpu-udetail-kv-k">전략가({GPU_TERMS.sellPrice})</span>
        <span className="gpu-udetail-kv-v gpu-udetail-price-lg">
          {mKrw(row.strategic_price_krw)}
          <span className={`gpu-ubadge gpu-ubadge--${row.is_strategic_set ? 'sell' : 'muted'} gpu-udetail-strat-tag`}>
            {strategicLabel}
          </span>
        </span>
      </div>

      {editing ? (
        <div className="gpu-udetail-pricing-edit">
          <label className="label" htmlFor="strat-price">전략가(원)</label>
          <input className="input-field" id="strat-price"
            type="number" inputMode="numeric" min={1}
            value={priceInput}
            onChange={(e) => setPriceInput(e.target.value)}
            placeholder="예: 12000000"
          />
          <label className="label" htmlFor="strat-reason">사유(선택)</label>
          <input className="input-field" id="strat-reason"
            type="text" maxLength={500}
            value={reasonInput}
            onChange={(e) => setReasonInput(e.target.value)}
            placeholder="변경 사유"
          />
          <div className="gpu-udetail-acts">
            <button type="button" className="gpu-udetail-rowbtn" disabled={saving} onClick={saveEdit}>
              {saving ? '저장 중…' : '저장'}
            </button>
            <button type="button" className="gpu-udetail-rowbtn" disabled={saving} onClick={() => { setEditing(false); setMsg(null) }}>
              취소
            </button>
          </div>
        </div>
      ) : (
        <div className="gpu-udetail-acts">
          <button type="button" className="gpu-udetail-rowbtn" onClick={startEdit}>{GPU_TERMS.edit}</button>
          <button
            type="button"
            className="gpu-udetail-rowbtn"
            disabled={saving || row.auto_price_krw == null}
            onClick={promoteAuto}
          >
            추천가로 반영
          </button>
        </div>
      )}

      {/* gcube 홈페이지 파싱가 */}
      <div className="gpu-udetail-kv gpu-udetail-pricing-gcube">
        <span className="gpu-udetail-kv-k">gcube 홈페이지 파싱가</span>
        <span className="gpu-udetail-kv-v">
          {gcubeItem && (gcubeItem.gcube_low_krw != null || gcubeItem.gcube_high_krw != null)
            ? `${mKrw(gcubeItem.gcube_low_krw)} ~ ${mKrw(gcubeItem.gcube_high_krw)}`
            : '—'}
        </span>
      </div>
      <div className="gpu-udetail-pricing-sync">
        <GcubeSyncBadge item={gcubeItem} />
        {gcubeItem?.checked_at && (
          <span className="gpu-udetail-basis">수집일 {formatDate(gcubeItem.checked_at)} · 출처 gcube.ai</span>
        )}
      </div>

      {/* 홈페이지 반영 완료 추적 (P2) */}
      <div className="gpu-udetail-kv gpu-udetail-pricing-gcube">
        <span className="gpu-udetail-kv-k">홈페이지 반영</span>
        <span className="gpu-udetail-kv-v">
          {row.reflected_at ? (
            <span className="gpu-ubadge gpu-ubadge--ok gpu-udetail-strat-tag">
              반영 완료 · {formatDate(row.reflected_at)}
              {row.reflected_by ? ` (${row.reflected_by})` : ''}
              {row.reflected_price_krw != null ? ` · ${mKrw(row.reflected_price_krw)} 스냅샷` : ''}
            </span>
          ) : (
            <span className="gpu-ubadge gpu-ubadge--muted gpu-udetail-strat-tag">미반영</span>
          )}
        </span>
      </div>
      <div className="gpu-udetail-acts">
        <button type="button" className="gpu-udetail-rowbtn" disabled={reflecting} onClick={markReflected}>
          {reflecting ? '처리 중…' : '홈페이지 반영 완료'}
        </button>
      </div>
      {reflectMsg && <p className="gpu-udetail-pending">{reflectMsg}</p>}

      {msg && <p className="gpu-udetail-pending">{msg}</p>}
    </div>
  )
}
