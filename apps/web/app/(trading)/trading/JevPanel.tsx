// Jev 판단 꺼짐 — **안 쌓이고 있다는 사실을 말한다**
//
// 켜져 있으면 이 자리는 **아예 안 그린다.** 늘 떠 있는 알림은 곧 배경이 되고,
// 정작 꺼진 날에도 안 읽힌다.
//
// 실측 2026-09-27: 판단 0건·Jev 꺼짐이었는데 화면 어디에도 그 사실이 없었다.
// 「아직 아무 일도 없다」와 「사람이 값을 넣어야 시작된다」가 같은 빈 화면으로 보였다.

import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'
import type { JevStatus } from '@/lib/trading/overview-shape'
import {
  JEV_OFF_TITLE, JEV_OFF_REASON_LABEL, JEV_OFF_REMEDY_LABEL, JEV_OFF_CONSEQUENCE,
} from '@/lib/trading/jev-labels'
import { TRADING_NAV_LABEL } from '@/lib/terms'

interface Props {
  jev: JevStatus
}

export default function JevPanel({ jev }: Props) {
  if (jev.on || !jev.reason) return null

  return (
    <section className="card" role="status" style={{ borderLeft: '3px solid var(--warning)' }}>
      <h2
        style={{
          display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
          fontSize: 'var(--fs-md)', fontWeight: 600, color: 'var(--text)',
          margin: 0, marginBottom: 'var(--space-2)',
        }}
      >
        <AlertTriangle size={16} /> {JEV_OFF_TITLE}
      </h2>
      <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text)', margin: 0, marginBottom: 'var(--space-2)' }}>
        {JEV_OFF_REASON_LABEL[jev.reason]}
      </p>
      <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', margin: 0, marginBottom: 'var(--space-2)' }}>
        {JEV_OFF_REMEDY_LABEL[jev.reason]}
      </p>
      <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', margin: 0, marginBottom: 'var(--space-3)' }}>
        {JEV_OFF_CONSEQUENCE}
      </p>

      {/*
        길은 모델이 비었을 때만 준다. 키는 시스템 설정에 있고 그 화면은 관리자 것이라,
        단추를 그려 두면 소유자가 눌러서 막히는 자리로 간다 — 그것은 길이 아니다
      */}
      {jev.reason === 'model_missing' && (
        <Link href="/trading/settings" className="btn btn-sm">
          {TRADING_NAV_LABEL.settings}
        </Link>
      )}
    </section>
  )
}
