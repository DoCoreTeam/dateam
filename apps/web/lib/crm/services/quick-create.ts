/**
 * 원터치 생성 (dacrm T1-05, 구현명세 §3.1)
 *
 * 명함·서명·소개 문단을 붙여넣으면 회사·인물·딜을 한 번에 만든다.
 *
 * 이 서비스의 어려움은 추출이 아니라 **이미 있는 것과 부딪히는 처리**다.
 *
 *   · 같은 회사가 이미 있으면 새로 만들지 않고 **연결만** 한다(명세 3.1-5).
 *     안 그러면 명함 받을 때마다 같은 회사가 늘어나고, 그때부터 매출 합계가 거짓이 된다.
 *   · 판정 기준은 **정규화된 도메인·이메일**이다. 회사명은 표기가 흔들려서 기준이 못 된다.
 *   · 전부 한 트랜잭션이다. 회사만 생기고 인물이 실패하면 사용자는 절반만 남은 화면을 본다.
 *
 * 못 채운 필수 값은 `gaps` 로 돌려준다 — 화면이 그 자리를 사람에게 묻는다(갭필 모달 §6.4).
 * 지어내서 채우지 않는 이유: 지어낸 값은 나중에 진짜처럼 읽힌다.
 */

import { withCrmTx } from '../db/tx.ts'
import { writeAudit } from '../db/audit.ts'
import { CrmError } from '../domain/errors.ts'
import { normalizeDomain, normalizeEmail, normalizePhone, normalizeText } from '../domain/normalize.ts'
import { runAi } from '../ai/runner.ts'
import { QUICK_CREATE_V1 } from '../ai/prompts/quick-create.v1.ts'
import { parseQuickCreate, type QuickCreateOutput } from '../ai/schemas/quick-create.ts'
import { mockAdapter } from '../ai/adapters/mock.ts'
import type { AiAdapter } from '../ai/runner.ts'
import { getCrmDb } from '../db/client.ts'
import { resolveSetting } from './setting.ts'

/** 만들어졌거나 이어 붙은 레코드 하나 */
export interface TouchedRecord {
  type: 'company' | 'person' | 'deal'
  id: string
  name: string
}

/** 사람이 채워야 하는 자리 */
export interface Gap {
  target: 'company' | 'person' | 'deal'
  field: string
  /** 화면이 그대로 보여 주는 물음 — 화면이 문구를 또 만들지 않게 여기서 준다 */
  label: string
  /** 이 값이 없으면 레코드 자체를 만들 수 없었다 */
  blocking: boolean
}

export interface QuickCreateResult {
  created: TouchedRecord[]
  linked: TouchedRecord[]
  gaps: Gap[]
  runId: string
  /** 아무것도 못 만들었을 때 화면이 원문을 되살려 준다(명세 3.1-8) */
  text: string
}

export interface QuickCreateInput {
  text: string
  /** 딜까지 만들지 — 화면의 체크박스. 금액이 없으면 만들지 않는다 */
  createDeal?: boolean
  pipelineId?: string | null
  stageId?: string | null
}

const MAX_TEXT = 8000

export async function quickCreate(
  workspaceId: string,
  actorId: string | null,
  input: QuickCreateInput,
  /** 안 주면 설정(ai.model.extract)이 정한 어댑터를 쓴다 — 코드에 모델명을 박지 않는다(명세 4.4-1) */
  adapter?: AiAdapter,
): Promise<QuickCreateResult> {
  // 원문은 **줄 구조를 지킨 채** 다룬다.
  //
  // 처음엔 requireText 를 썼는데 그게 여러 줄을 한 줄로 접었다(이름·제목용 함수다).
  // 명함은 줄이 곧 구조라 — 회사 / 이름 직함 / 연락처 — 접히는 순간 이름을 못 찾고,
  // 타임라인에 남는 원문도 뭉개져서 "명함에 이런 말이 있었는데"를 확인할 수 없게 된다.
  const text = typeof input.text === 'string' ? input.text.trim() : ''
  if (!text) throw new CrmError('VALIDATION_FAILED', '붙여넣을 내용을 입력해 주세요.', { field: 'text' })
  if (text.length > MAX_TEXT) {
    throw new CrmError('VALIDATION_FAILED',
      `내용이 너무 깁니다. ${MAX_TEXT.toLocaleString('ko-KR')}자 이내로 나눠 넣어 주세요.`, { field: 'text' })
  }

  // 러너는 워크스페이스 스코프 db 를 쓴다 — ai_run 도 워크스페이스에 속한다
  const db = getCrmDb(workspaceId)
  const chosen = adapter ?? await adapterFromSetting(db)
  const { output, runId } = await runAi<QuickCreateOutput>({
    db, workspaceId, kind: 'QUICK_CREATE',
    prompt: QUICK_CREATE_V1, input: text,
    inputRef: { chars: text.length }, // 원문은 복제하지 않는다(명세 §492)
    parse: parseQuickCreate,
    adapter: chosen,
  })

  return applyQuickCreate(workspaceId, actorId, output, input, runId, text)
}

/**
 * 추출 결과를 실제 레코드로 만든다.
 *
 * AI 호출과 분리한 이유: **이 부분만 따로 검증할 수 있어야** 하기 때문이다.
 * 모델을 갈아 끼워도 여기 규칙(중복 판정·트랜잭션·갭)은 그대로여야 한다.
 */
export async function applyQuickCreate(
  workspaceId: string,
  actorId: string | null,
  output: QuickCreateOutput,
  input: QuickCreateInput,
  runId: string,
  originalText: string,
): Promise<QuickCreateResult> {
  const created: TouchedRecord[] = []
  const linked: TouchedRecord[] = []
  const gaps: Gap[] = []

  const companyName = normalizeText(output.company?.name)
  const domain = normalizeDomain(output.company?.domain)
  const personName = normalizeText(output.person?.name)
  const email = normalizeEmail(output.person?.email)
  const phone = normalizePhone(output.person?.phone)

  await withCrmTx(workspaceId, async (tx) => {
    // ── 회사 ──────────────────────────────────────────────
    let companyId: string | null = null

    if (domain) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const hit = await (tx as any).crmCompany.findFirst({
        where: { domain }, select: { id: true, name: true },
      })
      if (hit) {
        companyId = hit.id
        linked.push({ type: 'company', id: hit.id, name: hit.name })
      }
    }

    if (!companyId && companyName) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const created_ = await (tx as any).crmCompany.create({
        data: {
          name: companyName, domain,
          industry: normalizeText(output.company?.industry),
          region: normalizeText(output.company?.region),
        },
        select: { id: true, name: true },
      })
      companyId = created_.id
      created.push({ type: 'company', id: created_.id, name: created_.name })
      await writeAudit(tx, {
        actorType: 'AI', actorId, action: 'company.created',
        targetType: 'company', targetId: created_.id, afterJson: created_,
      })
    }

    if (!companyId && domain) {
      // 도메인은 찾았는데 회사명을 못 찾았다 — 이름 없이 회사를 만들 수는 없다
      gaps.push({ target: 'company', field: 'name', label: '회사 이름', blocking: true })
    }

    // ── 인물 ──────────────────────────────────────────────
    let personId: string | null = null

    if (email) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const hit = await (tx as any).crmPerson.findFirst({
        where: { email }, select: { id: true, name: true },
      })
      if (hit) {
        personId = hit.id
        linked.push({ type: 'person', id: hit.id, name: hit.name })
      }
    }

    if (!personId && personName) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const created_ = await (tx as any).crmPerson.create({
        data: {
          name: personName, email, phone, companyId,
          title: normalizeText(output.person?.title),
        },
        select: { id: true, name: true },
      })
      personId = created_.id
      created.push({ type: 'person', id: created_.id, name: created_.name })
      await writeAudit(tx, {
        actorType: 'AI', actorId, action: 'person.created',
        targetType: 'person', targetId: created_.id, afterJson: created_,
      })
    } else if (!personId && (email || phone)) {
      // 연락처는 있는데 이름이 없다 — 이름 없는 사람은 목록에서 못 찾는다
      gaps.push({ target: 'person', field: 'name', label: '담당자 이름', blocking: true })
    }

    // 기존 인물인데 회사가 비어 있으면 이어 붙인다(덮어쓰지는 않는다)
    if (personId && companyId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (tx as any).crmPerson.updateMany({
        where: { id: personId, companyId: null }, data: { companyId },
      })
    }

    // ── 딜 ────────────────────────────────────────────────
    if (input.createDeal) {
      const dealName = normalizeText(output.deal?.name)
      const amount = output.deal?.amountMinor ?? null

      if (!companyId) {
        gaps.push({ target: 'deal', field: 'companyId', label: '어느 회사의 딜인지', blocking: true })
      } else if (!input.pipelineId || !input.stageId) {
        gaps.push({ target: 'deal', field: 'stageId', label: '어느 단계에서 시작할지', blocking: true })
      } else if (!dealName) {
        // 딜 이름은 사람이 정한다 — "OO 도입 검토" 같은 이름을 AI 가 지어내면 목록이 비슷해진다
        gaps.push({ target: 'deal', field: 'name', label: '딜 이름', blocking: true })
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const created_ = await (tx as any).crmDeal.create({
          data: {
            name: dealName, companyId,
            pipelineId: input.pipelineId, stageId: input.stageId,
            amountMinor: amount === null ? null : BigInt(amount),
            currency: amount === null ? null : (normalizeText(output.deal?.currency)?.toUpperCase() ?? 'KRW'),
          },
          select: { id: true, name: true },
        })
        created.push({ type: 'deal', id: created_.id, name: created_.name })

        // 첫 진입도 이동이다 — 딜 서비스와 같은 규칙(DI-09)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (tx as any).crmStageHistory.create({
          data: {
            dealId: created_.id, fromStageId: null, toStageId: input.stageId,
            movedById: actorId, movedAt: new Date(), durationSec: null,
          },
        })
        await writeAudit(tx, {
          actorType: 'AI', actorId, action: 'deal.created',
          targetType: 'deal', targetId: created_.id, afterJson: created_,
        })

        if (amount === null) {
          gaps.push({ target: 'deal', field: 'amountMinor', label: '예상 금액', blocking: false })
        }
      }
    }

    // ── 붙여넣은 원문을 기록으로 남긴다 ─────────────────────
    // 왜: 추출이 놓친 문장이 반드시 있다. 원문이 어딘가 남아 있어야
    //     "명함에 이런 말이 있었는데"를 나중에 확인할 수 있다.
    const anchor = companyId ?? null
    if (anchor || personId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (tx as any).crmActivity.create({
        data: {
          type: 'NOTE', occurredAt: new Date(),
          title: '붙여넣기로 등록',
          body: originalText.slice(0, 4000),
          companyId: anchor, personId,
          source: 'AI', createdById: actorId,
        },
      })
    }
  })

  // 아무것도 못 만들고 이어 붙이지도 못했으면 그 사실을 분명히 말한다
  if (created.length === 0 && linked.length === 0) {
    gaps.push({ target: 'company', field: 'name', label: '회사 이름', blocking: true })
  }

  return { created, linked, gaps, runId, text: originalText }
}

/**
 * 설정이 정한 모델로 어댑터를 고른다.
 *
 * 실제 모델 어댑터는 T1-09(HUMAN GATE)에서 키와 함께 들어온다.
 * 그때까지 설정이 무엇을 가리키든 mock 으로 돈다 — **키 없이 도는 것이 기본값**이라
 * 설정을 잘못 만졌다고 조용히 유료 호출이 나가는 일이 없다.
 */
async function adapterFromSetting(db: ReturnType<typeof getCrmDb>): Promise<AiAdapter> {
  const model = await resolveSetting(db, 'ai.model.extract')
  const name = typeof model.value === 'string' ? model.value : 'mock'
  if (name === 'mock') return mockAdapter()

  // 아직 붙지 않은 모델을 가리키면 그 사실을 말한다 — 조용히 mock 으로 돌면
  // 사용자는 설정이 먹은 줄 알고 결과를 믿는다.
  throw new CrmError('VALIDATION_FAILED',
    `설정된 모델(${name})은 아직 연결되지 않았습니다. 설정에서 mock 으로 두거나 관리자에게 문의해 주세요.`)
}
