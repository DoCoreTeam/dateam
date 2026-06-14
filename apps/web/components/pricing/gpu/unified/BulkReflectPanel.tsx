'use client'

// 일괄 반영 리스트 (P3) — 통합표 툴바 '일괄 반영' 버튼으로 진입하는 모달.
//
// "미반영 제품"만 모아 보여주고 일괄 처리:
//   - 미반영 판정(둘 중 하나): gcube 동기화 'mismatch' (전략가 ≠ 파싱가 범위 밖)
//                           또는 전략가 설정됨(is_strategic_set) && 홈페이지 반영 미마킹(reflected_at == null)
//   - [선택 추천가로 전략가 확정] → POST /strategic-price/bulk (각 행 추천가를 전략가로)
//   - [선택 홈페이지 반영 완료]   → POST /gcube-reflected {product_ids}
//
// 계산 없음(R1): 추천가/전략가/파싱가는 cockpit·gcube-check 응답값 그대로 사용.
// 성공 시 cockpit + gcube-check mutate. 쓰기는 admin API가 막음 — 실패 시 사용자 메시지.

import { useMemo, useState } from 'react'
import useSWR, { useSWRConfig } from 'swr'
import { X, CheckCircle2, Globe } from 'lucide-react'
import { fetcher } from '@/lib/swr-config'
import { useEscClose } from '@/lib/use-esc-close'
import { fmtMoneyFromKrw } from '@/lib/gpu/format-price'
import { GcubeSyncBadge } from '@/components/pricing/gpu/cockpit/GcubeSyncBadge'
import type { GcubeCheckItem } from '@/app/api/pricing/gpu/gcube-check/route'
import type { CurrencyCtx, UnifiedRow } from '@/lib/gpu/unified-row'

const COCKPIT_KEY = '/api/pricing/gpu/cockpit'
const GCUBE_KEY = '/api/pricing/gpu/gcube-check'

interface BulkReflectPanelProps {
  rows: UnifiedRow[]
  currency: CurrencyCtx
  onClose: () => void
}

/** 미반영으로 모아볼 한 행 + 동기화 상태. */
interface PendingRow {
  row: UnifiedRow
  gcube: GcubeCheckItem | undefined
}

export default function BulkReflectPanel({ rows, currency, onClose }: BulkReflectPanelProps) {
  useEscClose(onClose)
  const { mutate } = useSWRConfig()
  const mKrw = (krw: number | null) => fmtMoneyFromKrw(krw, currency.mode, currency.usdKrw)

  const { data: gcubeData } = useSWR<{ items: GcubeCheckItem[] }>(GCUBE_KEY, fetcher)

  // gcube-check를 product_id로 인덱싱
  const gcubeMap = useMemo(() => {
    const m = new Map<string, GcubeCheckItem>()
    for (const it of gcubeData?.items ?? []) m.set(it.product_id, it)
    return m
  }, [gcubeData])

  // 미반영 행: 동기화 mismatch 이거나 (전략가 설정됨 && 홈페이지 반영 미마킹)
  const pending = useMemo<PendingRow[]>(() => {
    return rows
      .map((row) => ({ row, gcube: gcubeMap.get(row.id) }))
      .filter(({ row, gcube }) => {
        const mismatch = gcube?.status === 'mismatch'
        const setButUnreflected = row.is_strategic_set && row.reflected_at == null
        return mismatch || setButUnreflected
      })
  }, [rows, gcubeMap])

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<null | 'strategic' | 'reflect'>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [msgTone, setMsgTone] = useState<'ok' | 'err'>('ok')

  const selectedRows = useMemo(
    () => pending.filter((p) => selected.has(p.row.id)),
    [pending, selected],
  )
  const allChecked = pending.length > 0 && selected.size === pending.length

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    setSelected(allChecked ? new Set() : new Set(pending.map((p) => p.row.id)))
  }

  function showMsg(tone: 'ok' | 'err', text: string) {
    setMsgTone(tone)
    setMsg(text)
  }

  // 선택 행을 추천가(auto_price_krw)로 일괄 전략가 확정
  async function bulkSetStrategic() {
    const items = selectedRows
      .filter((p) => p.row.auto_price_krw != null && p.row.auto_price_krw > 0)
      .map((p) => ({ product_id: p.row.id, strategic_price_krw: p.row.auto_price_krw as number }))

    if (items.length === 0) {
      showMsg('err', '추천가가 있는 선택 항목이 없습니다.')
      return
    }

    setBusy('strategic')
    setMsg(null)
    try {
      const res = await fetch('/api/pricing/gpu/strategic-price/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      })
      const j = (await res.json().catch(() => ({}))) as { error?: string; updated?: number; failed?: number }
      if (!res.ok) {
        showMsg('err', j.error ?? '전략가 일괄 확정에 실패했습니다. 권한을 확인하세요.')
        return
      }
      const failTxt = j.failed ? ` (실패 ${j.failed}건)` : ''
      showMsg(j.failed ? 'err' : 'ok', `${j.updated ?? items.length}건 전략가를 추천가로 확정했습니다.${failTxt}`)
      setSelected(new Set())
      await Promise.all([mutate(COCKPIT_KEY), mutate(GCUBE_KEY)])
    } catch {
      showMsg('err', '전략가 일괄 확정 중 오류가 발생했습니다.')
    } finally {
      setBusy(null)
    }
  }

  // 선택 행 홈페이지 반영 완료 일괄 마킹
  async function bulkMarkReflected() {
    const productIds = selectedRows.map((p) => p.row.id)
    if (productIds.length === 0) {
      showMsg('err', '선택된 항목이 없습니다.')
      return
    }

    setBusy('reflect')
    setMsg(null)
    try {
      const res = await fetch('/api/pricing/gpu/gcube-reflected', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_ids: productIds }),
      })
      const j = (await res.json().catch(() => ({}))) as { error?: string; marked?: number; failed?: number }
      if (!res.ok) {
        showMsg('err', j.error ?? '반영 완료 마킹에 실패했습니다. 권한을 확인하세요.')
        return
      }
      const failTxt = j.failed ? ` (실패 ${j.failed}건)` : ''
      showMsg(j.failed ? 'err' : 'ok', `${j.marked ?? productIds.length}건 홈페이지 반영 완료로 마킹했습니다.${failTxt}`)
      setSelected(new Set())
      await Promise.all([mutate(COCKPIT_KEY), mutate(GCUBE_KEY)])
    } catch {
      showMsg('err', '반영 완료 마킹 중 오류가 발생했습니다.')
    } finally {
      setBusy(null)
    }
  }

  const disabled = busy !== null || selected.size === 0

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="bulk-reflect-title"
      className="gpu-modal-backdrop"
      onClick={onClose}
    >
      <div
        className="gpu-modal-card gpu-modal-card--bulk gpu-modal-card--scroll"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="gpu-modal-header">
          <span className="gpu-modal-header-icon">
            <Globe size={14} />
          </span>
          <div style={{ flex: 1 }}>
            <strong id="bulk-reflect-title" className="gpu-modal-title tape-title">일괄 반영</strong>
            <span className="gpu-modal-subtitle">
              미반영 {pending.length}개 · 선택 {selected.size}개 — 추천가 확정 또는 홈페이지 반영 완료를 한 번에
            </span>
          </div>
          <button type="button" onClick={onClose} aria-label="닫기" className="gpu-modal-close">
            <X size={16} />
          </button>
        </div>

        {/* 바디 */}
        <div className="gpu-modal-body">
          {msg && (
            <p className={`gpu-bulk-msg ${msgTone === 'ok' ? 'gpu-bulk-msg--ok' : 'gpu-bulk-msg--err'}`}>
              {msg}
            </p>
          )}

          {pending.length === 0 ? (
            <div className="gpu-bulk-empty">
              <CheckCircle2 size={24} aria-hidden />
              <p>미반영 제품이 없습니다. 전략가와 gcube 파싱가가 모두 동기화되어 있습니다.</p>
            </div>
          ) : (
            <div className="gpu-bulk-tablewrap">
              <table className="gpu-bulk-table">
                <thead>
                  <tr>
                    <th className="gpu-bulk-th-check">
                      <input type="checkbox"
                        checked={allChecked}
                        onChange={toggleAll}
                        aria-label="전체 선택"
                      />
                    </th>
                    <th>모델</th>
                    <th className="gpu-bulk-num">전략가</th>
                    <th className="gpu-bulk-num">추천가</th>
                    <th className="gpu-bulk-num">gcube 파싱가</th>
                    <th>동기화</th>
                    <th>반영상태</th>
                  </tr>
                </thead>
                <tbody>
                  {pending.map(({ row, gcube }) => {
                    const checked = selected.has(row.id)
                    const lo = gcube?.gcube_low_krw ?? null
                    const hi = gcube?.gcube_high_krw ?? null
                    return (
                      <tr
                        key={row.id}
                        className={checked ? 'gpu-bulk-tr--sel' : undefined}
                        onClick={() => toggle(row.id)}
                      >
                        <td className="gpu-bulk-th-check" onClick={(e) => e.stopPropagation()}>
                          <input type="checkbox"
                            checked={checked}
                            onChange={() => toggle(row.id)}
                            aria-label={`${row.model_name} 선택`}
                          />
                        </td>
                        <td>
                          <span className="gpu-bulk-model">{row.model_name}</span>
                          {row.memory && <small className="gpu-bulk-mem">{row.memory}</small>}
                        </td>
                        <td className="gpu-bulk-num gpu-mono">{mKrw(row.strategic_price_krw)}</td>
                        <td className="gpu-bulk-num gpu-mono">{mKrw(row.auto_price_krw)}</td>
                        <td className="gpu-bulk-num gpu-mono">
                          {lo != null || hi != null ? `${mKrw(lo)} ~ ${mKrw(hi)}` : '—'}
                        </td>
                        <td>
                          <GcubeSyncBadge item={gcube} />
                        </td>
                        <td>
                          {row.reflected_at ? (
                            <span className="gpu-ubadge gpu-ubadge--ok">반영 완료</span>
                          ) : (
                            <span className="gpu-ubadge gpu-ubadge--muted">미반영</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* 푸터 — 일괄 액션 */}
        {pending.length > 0 && (
          <div className="gpu-modal-footer gpu-bulk-footer">
            <button
              type="button"
              className="gpu-btn"
              onClick={bulkSetStrategic}
              disabled={disabled}
            >
              {busy === 'strategic' ? '확정 중…' : '선택 추천가로 전략가 확정'}
            </button>
            <button
              type="button"
              className="gpu-btn-primary"
              onClick={bulkMarkReflected}
              disabled={disabled}
            >
              {busy === 'reflect' ? '처리 중…' : '선택 홈페이지 반영 완료'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
