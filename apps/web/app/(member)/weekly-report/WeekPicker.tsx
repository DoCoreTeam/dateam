'use client'

// 주간보고 공용 주차 표시·선택기 — 탭 옆 전역 노출(연속성 SSOT). 현재 주차를 항상 보여줘 헷갈림 방지,
// 변경 시 현재 탭을 유지한 채 ?week=만 갱신(각 뷰가 이 파라미터를 초기값으로 읽음).

import { useRouter } from 'next/navigation'

interface Props {
  weekOptions: string[]
  selectedWeek: string
  thisWeek: string
  activeTab: string
}

export default function WeekPicker({ weekOptions, selectedWeek, thisWeek, activeTab }: Props) {
  const router = useRouter()
  // 윈도우 밖(org 무제한 과거) 주차도 표시할 수 있도록 옵션에 없으면 앞에 추가.
  const options = weekOptions.includes(selectedWeek) ? weekOptions : [selectedWeek, ...weekOptions]

  function fmt(w: string): string {
    return new Date(w).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })
  }

  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
      <span style={{ fontWeight: 600 }}>주차</span>
      <select className="input-field"
        style={{ cursor: 'pointer', minHeight: 36, paddingTop: '0.25rem', paddingBottom: '0.25rem', maxWidth: 200 }}
        value={selectedWeek}
        onChange={(e) => router.push(`/weekly-report?tab=${activeTab}&week=${e.target.value}`, { scroll: false })}
        aria-label="주차 선택"
      >
        {options.map((w) => (
          <option key={w} value={w}>
            {fmt(w)} 주{w === thisWeek ? ' (이번 주)' : ''}
          </option>
        ))}
      </select>
    </label>
  )
}
