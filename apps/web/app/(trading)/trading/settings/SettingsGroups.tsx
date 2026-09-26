'use client'

// app/(trading)/trading/settings/SettingsGroups.tsx — 묶음을 접는다
//
// **왜 접나** (실브라우저 실측 2026-09-27): 화면을 일곱으로 나눈 뒤에도 설정 화면만
// **8445px** 였다. 다른 화면은 720~1722px 다. 값이 88개라 화면을 더 나눠도 안 줄고,
// 「판단」 한 값을 고치러 와서 「수집」·「검증」·「신호 규칙」을 전부 지나야 했다.
//
// **`<details>` 로 접는다.** 키보드·스크린리더 규약이 브라우저에 이미 있고,
// **닫혀 있으면 본문을 아예 안 그린다** — 88개의 입력칸을 문서에 들고 있지 않게 된다
// (접근권한 화면이 표면 26개를 같은 방식으로 다룬다).
//
// **머리에 값 개수를 적는다.** 이름만 있으면 어느 묶음을 펼칠지 고를 수가 없다.

import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import SettingsForm, { type SettingRow } from './SettingsForm'

export interface SettingGroupBlock {
  key: string
  label: string
  rows: SettingRow[]
}

export default function SettingsGroups({ groups }: { groups: readonly SettingGroupBlock[] }) {
  /** 한 번에 하나만 편다 — 여럿을 펴 두면 접은 뜻이 없어진다 */
  const [openKey, setOpenKey] = useState<string | null>(null)

  return (
    <div className="card">
      {groups.map((g) => {
        const open = openKey === g.key
        return (
          <details
            key={g.key}
            open={open}
            style={{ borderTop: 'var(--hairline) solid var(--border-color)' }}
          >
            <summary
              onClick={(e) => { e.preventDefault(); setOpenKey(open ? null : g.key) }}
              style={{
                display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                cursor: 'pointer', padding: 'var(--space-3) 0', listStyle: 'none',
              }}
            >
              {open
                ? <ChevronDown size={14} color="var(--text-muted)" />
                : <ChevronRight size={14} color="var(--text-muted)" />}
              <span style={{ fontWeight: 700, color: 'var(--text)' }}>{g.label}</span>
              {/* 개수가 없으면 어느 묶음에 무엇이 들었는지 펼쳐 봐야만 안다 */}
              <span style={{ marginLeft: 'auto', fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
                {`${g.rows.length}개`}
              </span>
            </summary>

            {/* 닫혀 있으면 안 그린다 — <details> 는 닫아도 자식을 문서에 둔다 */}
            {open && (
              <div style={{ display: 'grid', gap: 'var(--space-4)', padding: '0 0 var(--space-4)' }}>
                {g.rows.map((row) => <SettingsForm key={row.key} row={row} />)}
              </div>
            )}
          </details>
        )
      })}
    </div>
  )
}
