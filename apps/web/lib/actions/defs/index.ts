// 기능 정의 전체, 영역별 파일을 모은다 (scripts/cli/gen.mjs 가 이 목록을 다시 씀)
import type { ActionDef } from '../types.ts'
import { WORK_DEFS } from './work.ts'
import { CRM_DEFS } from './crm.ts'
import { CI_DEFS } from './ci.ts'
import { STUDIO_DEFS } from './studio.ts'
import { RFP_DEFS } from './rfp.ts'
import { TRADING_DEFS } from './trading.ts'
import { GPU_DEFS } from './gpu.ts'
import { ADMIN_DEFS } from './admin.ts'
import { META_DEFS } from './meta.ts'

export const ALL_DEFS: ActionDef[] = [
  ...WORK_DEFS,
  ...CRM_DEFS,
  ...CI_DEFS,
  ...STUDIO_DEFS,
  ...RFP_DEFS,
  ...TRADING_DEFS,
  ...GPU_DEFS,
  ...ADMIN_DEFS,
  ...META_DEFS,
]
