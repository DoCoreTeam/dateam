// app/(trading)/trading/settings/page.tsx — 설정
//
// **왜 자기 화면인가** (사용자 지적 2026-09-27: 「설정하는 것 자체가 없네」):
// 값 88개가 묶음 15개로 현황 화면 **맨 아래**에 붙어 있었다. 매일 보는 신호 세 줄 뒤에
// 88줄이 따라오니 현황이 설정 목록에 파묻혔고, 정작 설정을 찾는 사람은 그 아래까지
// 스크롤해야 했다. 매일 여는 것과 처음 한 번 정하는 것은 같은 화면에 두지 않는다.
//
// **값마다 저장한다.** 88개를 한 단추로 저장하면 하나가 거절될 때 나머지가 어떻게 됐는지
// 화면이 말할 수 없다. 저장기가 값 하나를 한 판으로 쌓으므로 화면도 같은 단위로 둔다.

import { Settings } from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'
import { TRADING_SETTINGS, type TradingSettingGroup } from '@/lib/trading/settings/registry'
import { TRADING_GROUP_LABEL, TRADING_USED_FROM_LABEL } from '@/lib/trading/settings/labels'
import { loadTradingSettings } from '@/lib/trading/settings/store'
import { whyElsewhere } from '@/lib/trading/settings/editable'
import { kstTodayKey } from '@/lib/datetime/kst'
import { TRADING_NAV_LABEL } from '@/lib/terms'
import SettingsForm, { type SettingRow } from './SettingsForm'

export const dynamic = 'force-dynamic'

export default async function TradingSettingsPage() {
  const { values, version } = await loadTradingSettings(kstTodayKey())
  const groups = Object.keys(TRADING_GROUP_LABEL) as TradingSettingGroup[]

  return (
    <>
      <PageHeader
        title={TRADING_NAV_LABEL.settings}
        icon={<Settings size={22} />}
        description={`지금 쓰는 값 ${TRADING_SETTINGS.length}개입니다. 고치면 다음 거래일부터 적용됩니다. 판 ${version}`}
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
              <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
                {rows.map((s) => (
                  <SettingsForm key={s.key} row={toRow(s, values[s.key])} />
                ))}
              </div>
            </section>
          )
        })}
      </div>
    </>
  )
}

/**
 * 레지스트리 한 줄을 화면이 그릴 꼴로.
 *
 * 지금 값을 **글자로** 넘긴다 — 입력칸이 다루는 것은 언제나 글자이고,
 * 형으로 되돌리는 일은 저장 창구가 레지스트리를 보고 한다(두 곳이 각자 읽으면 갈린다).
 */
function toRow(spec: (typeof TRADING_SETTINGS)[number], value: unknown): SettingRow {
  return {
    key: spec.key,
    label: spec.label,
    help: spec.help,
    type: spec.type,
    ...(spec.choices ? { choices: spec.choices } : {}),
    ...(spec.unit ? { unit: spec.unit } : {}),
    value: spec.type === 'boolean' ? String(value === true) : String(value ?? ''),
    elsewhere: whyElsewhere(spec.key),
    usedFrom: TRADING_USED_FROM_LABEL[spec.usedFrom],
  }
}
