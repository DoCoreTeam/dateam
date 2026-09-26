// app/(trading)/trading/settings/page.tsx — 설정
//
// **왜 자기 화면인가** (사용자 지적 2026-09-27: 「설정하는 것 자체가 없네」):
// 값 88개가 묶음 15개로 현황 화면 **맨 아래**에 붙어 있었다. 매일 보는 신호 세 줄 뒤에
// 88줄이 따라오니 현황이 설정 목록에 파묻혔고, 정작 설정을 찾는 사람은 그 아래까지
// 스크롤해야 했다. 매일 여는 것과 처음 한 번 정하는 것은 같은 화면에 두지 않는다.
//
// 이 판에서는 **자리만** 만든다. 고치는 일은 다음 항목에서 붙는다 —
// 옮기는 일과 고치는 일을 한 커밋에 섞으면 어느 쪽이 깨졌는지 못 가린다.

import { Settings } from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'
import { TRADING_SETTINGS, type TradingSettingGroup } from '@/lib/trading/settings/registry'
import {
  TRADING_GROUP_LABEL,
  TRADING_USED_FROM_LABEL,
  formatTradingSettingValue,
} from '@/lib/trading/settings/labels'
import { loadTradingSettings } from '@/lib/trading/settings/store'
import { kstTodayKey } from '@/lib/datetime/kst'
import { TRADING_NAV_LABEL } from '@/lib/terms'

export const dynamic = 'force-dynamic'

export default async function TradingSettingsPage() {
  const { values, version } = await loadTradingSettings(kstTodayKey())
  const groups = Object.keys(TRADING_GROUP_LABEL) as TradingSettingGroup[]

  return (
    <>
      <PageHeader
        title={TRADING_NAV_LABEL.settings}
        icon={<Settings size={22} />}
        description={`지금 쓰는 값입니다. 판 ${version}`}
      />

      <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
        {groups.map((group) => {
          const rows = TRADING_SETTINGS.filter((s) => s.group === group)
          if (rows.length === 0) return null
          return (
            <section key={group} className="card">
              <h2
                style={{
                  fontSize: 'var(--fs-md)', fontWeight: 600, color: 'var(--text)',
                  margin: 0, marginBottom: 'var(--space-3)',
                }}
              >
                {TRADING_GROUP_LABEL[group]}
              </h2>
              <dl style={{ display: 'grid', gap: 'var(--space-3)', margin: 0 }}>
                {rows.map((s) => (
                  <div
                    key={s.key}
                    style={{
                      display: 'flex', gap: 'var(--space-3)', alignItems: 'baseline',
                      flexWrap: 'wrap', justifyContent: 'space-between',
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <dt style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text)' }}>
                        {s.label}
                      </dt>
                      <dd style={{ margin: 0, fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
                        {s.help}
                      </dd>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>
                        {formatTradingSettingValue(values[s.key])}
                        {s.unit ? <span style={{ color: 'var(--text-muted)' }}> {s.unit}</span> : null}
                      </div>
                      <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
                        {TRADING_USED_FROM_LABEL[s.usedFrom]}
                      </div>
                    </div>
                  </div>
                ))}
              </dl>
            </section>
          )
        })}
      </div>
    </>
  )
}
