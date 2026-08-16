// GET  /api/crm/automations — 자동화 규칙과 단계 목록
// PUT  /api/crm/automations — 규칙 통째 저장 (관리자만)
//
// 규칙은 **새 테이블이 아니라** 워크스페이스 설정에 JSON 으로 담는다(lib/crm/services/automation.ts).
// 통째 저장인 이유: 규칙은 스무 개 이하의 짧은 목록이라 부분 갱신이 오히려 어긋남을 만든다.
import { withCrmApi, readJson } from '@/lib/crm/api/handler'
import { getCrmDb } from '@/lib/crm/db/client'
import { withCrmTx } from '@/lib/crm/db/tx'
import { writeAudit } from '@/lib/crm/db/audit'
import {
  loadRules, validateRules, AUTOMATION_SETTING_KEY,
} from '@/lib/crm/services/automation'

export async function GET() {
  return withCrmApi('READONLY', async ({ session }) => {
    const db = getCrmDb(session.workspaceId)
    const rules = await loadRules(db)

    // 단계를 함께 준다 — 관리자가 단계 id 를 외워서 넣을 수는 없다
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stages = await (db as any).crmStage.findMany({
      select: { id: true, name: true, pipeline: { select: { name: true } } },
      orderBy: [{ pipelineId: 'asc' }, { position: 'asc' }],
    }) as { id: string; name: string; pipeline: { name: string } | null }[]

    return {
      rules,
      stages: stages.map((s) => ({ id: s.id, name: s.name, pipelineName: s.pipeline?.name ?? '' })),
    }
  })
}

export async function PUT(req: Request) {
  return withCrmApi('ADMIN', async ({ session }) => {
    const actorId = session.memberId
    const body = await readJson(req)
    const rules = validateRules(body.rules ?? [])

    return withCrmTx(session.workspaceId, async (tx) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const existing = await (tx as any).crmAppSetting.findFirst({
        where: { key: AUTOMATION_SETTING_KEY },
        select: { id: true, valueJson: true },
      })

      if (existing) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (tx as any).crmAppSetting.update({
          where: { id: existing.id },
          data: { valueJson: rules, updatedById: actorId },
        })
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (tx as any).crmAppSetting.create({
          data: {
            scope: 'WORKSPACE', key: AUTOMATION_SETTING_KEY,
            valueJson: rules, updatedById: actorId,
            description: '자동화 규칙 (딜 단계 이동 등에서 할 일을 만든다)',
          },
        })
      }

      // 규칙이 바뀌면 그 뒤 만들어지는 할 일이 달라진다 — 누가 언제 바꿨는지 남긴다
      await writeAudit(tx, {
        actorType: 'HUMAN', actorId,
        action: 'automation.rules_updated',
        targetType: 'setting', targetId: AUTOMATION_SETTING_KEY,
        beforeJson: { count: Array.isArray(existing?.valueJson) ? existing.valueJson.length : 0 },
        afterJson: { count: rules.length, enabled: rules.filter((r) => r.enabled).length },
      })

      return { rules }
    })
  })
}
