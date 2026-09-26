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
import { loadTradingSettings, loadAllSettingVersions } from '@/lib/trading/settings/store'
import { pendingByKey, editingValue, type PendingChange } from '@/lib/trading/settings/pending'
import { whyElsewhere } from '@/lib/trading/settings/editable'
import { kstTodayKey } from '@/lib/datetime/kst'
import { TRADING_NAV_LABEL } from '@/lib/terms'
import { type SettingRow } from './SettingsForm'
import SettingsGroups, { type SettingGroupBlock } from './SettingsGroups'
import CredentialPanel, { type CredentialStatusRow } from './CredentialPanel'
import { getTradingCredentialStatus } from '@/lib/trading/broker/credentials'

export const dynamic = 'force-dynamic'

export default async function TradingSettingsPage() {
  const today = kstTodayKey()
  const { values, version } = await loadTradingSettings(today)
  /**
   * 예약된 판까지 읽는다. 안 읽으면 방금 저장한 값이 **사라진 것처럼** 보인다 —
   * 전략 변경은 다음 거래일부터라 오늘 값에 안 섞이기 때문이다.
   */
  const pending = pendingByKey(await loadAllSettingVersions(), today)
  const groups = Object.keys(TRADING_GROUP_LABEL) as TradingSettingGroup[]

  /**
   * 자격증명 상태. **비밀은 안 읽는다** — 넣었는지와 가린 계좌번호뿐이다.
   * 못 읽어도 설정 화면 전체가 죽지는 않게 한다: 곁가지가 본 일을 죽이지 않는다.
   */
  const credentials: CredentialStatusRow[] = await Promise.all(
    ([
      { env: 'paper' as const, label: '모의' },
      { env: 'real' as const, label: '실전' },
    ]).map(async ({ env, label }) => {
      try {
        const st = await getTradingCredentialStatus(env)
        return { env, label, configured: st.configured, accountMask: st.accountMask, updatedAt: st.updatedAt }
      } catch {
        return { env, label, configured: false, accountMask: null, updatedAt: null }
      }
    }),
  )

  /**
   * 묶음마다 줄을 만들어 둔다. 비어 있는 묶음은 안 세운다 —
   * 펼쳐 봐야 아무것도 없는 칸은 눌러 놓고 아무 일도 안 난다.
   */
  const blocks: SettingGroupBlock[] = groups
    .map((group) => ({
      key: group,
      label: TRADING_GROUP_LABEL[group],
      rows: TRADING_SETTINGS
        .filter((s) => s.group === group)
        .map((s) => toRow(s, values[s.key], pending.get(s.key))),
    }))
    .filter((b) => b.rows.length > 0)

  return (
    <>
      <PageHeader
        title={TRADING_NAV_LABEL.settings}
        icon={<Settings size={22} />}
        description={`지금 쓰는 값 ${TRADING_SETTINGS.length}개입니다. 고치면 다음 거래일부터 적용됩니다. 판 ${version}`}
      />

      <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
        {/* 처음 한 번 넣는 것이라 맨 위다 — 이게 없으면 나머지 값이 다 있어도 아무것도 안 돈다 */}
        <CredentialPanel rows={credentials} />

        <SettingsGroups groups={blocks} />
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
function toRow(
  spec: (typeof TRADING_SETTINGS)[number],
  value: unknown,
  pending: PendingChange | undefined,
): SettingRow {
  /** 고치는 대상은 **다음에 쓸 값**이다. 오늘 값은 그 옆에서 따로 말한다 */
  const editing = editingValue(pending) ?? value
  return {
    key: spec.key,
    label: spec.label,
    help: spec.help,
    type: spec.type,
    ...(spec.choices ? { choices: spec.choices } : {}),
    ...(spec.unit ? { unit: spec.unit } : {}),
    value: spec.type === 'boolean' ? String(editing === true) : String(editing ?? ''),
    // 예약이 있으면 「지금 X · 언제부터 Y」를 말한다. 안 말하면 저장이 안 된 줄 안다
    ...(pending?.next !== null && pending?.from
      ? { today: spec.type === 'boolean' ? String(value === true) : String(value ?? ''), from: pending.from }
      : {}),
    elsewhere: whyElsewhere(spec.key),
    usedFrom: TRADING_USED_FROM_LABEL[spec.usedFrom],
  }
}
