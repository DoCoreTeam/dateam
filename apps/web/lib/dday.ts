'use client'

import React from 'react'
import { toDateString } from './utils'

export type DdayStage = {
  label: string
  color: string
  bg: string
  border: string
}

export function getDdayStage(diff: number): DdayStage {
  if (diff < 0)   return { label: '기한 초과',  color: '#64748b', bg: '#f1f5f9', border: '#e2e8f0' }
  if (diff === 0) return { label: '오늘 마감',  color: '#dc2626', bg: '#fef2f2', border: '#fecaca' }
  if (diff === 1) return { label: '마무리 필요', color: '#ea580c', bg: '#fff7ed', border: '#fed7aa' }
  if (diff <= 3)  return { label: '마무리 준비', color: '#d97706', bg: '#fffbeb', border: '#fde68a' }
  if (diff <= 7)  return { label: '진행 중',    color: '#2563eb', bg: '#eff6ff', border: '#bfdbfe' }
  if (diff <= 14) return { label: '중반',       color: '#4f46e5', bg: '#eef2ff', border: '#c7d2fe' }
  return                 { label: '착수',       color: '#059669', bg: '#ecfdf5', border: '#a7f3d0' }
}

export function diffDays(targetDate: string, today: string): number {
  return Math.round(
    (new Date(targetDate + 'T00:00:00').getTime() - new Date(today + 'T00:00:00').getTime()) / 86400000
  )
}

export function todayLocal(): string {
  return toDateString(new Date())
}

export function DdayBadge({ targetDate, today, style }: {
  targetDate: string
  today: string
  style?: React.CSSProperties
}): React.ReactElement {
  const diff = diffDays(targetDate, today)
  const stage = getDdayStage(diff)
  const dLabel = diff < 0 ? `D+${Math.abs(diff)}` : diff === 0 ? 'D-day' : `D-${diff}`
  return React.createElement('span', {
    style: {
      fontSize: '0.68rem', fontWeight: 700,
      color: stage.color, background: stage.bg, border: `1px solid ${stage.border}`,
      borderRadius: '0.2rem', padding: '0.1rem 0.3rem',
      ...style,
    },
  }, `${dLabel} · ${stage.label}`)
}
