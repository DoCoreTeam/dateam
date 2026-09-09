/**
 * 모델 등록부와 폴백 순서 (설계서 3.6.1)
 *
 * ## 모델을 코드에 박지 않는 이유
 *
 * 모델은 **한 달에 한 번씩 바뀐다.** 코드에 박으면 바꿀 때마다 배포해야 하고,
 * 배포 권한이 없는 사람은 자기 조직 모델을 못 고른다.
 * 그래서 등록부는 DB(`rfp_ai_models`)에 있고, 여기는 **그 행을 다루는 타입과 규칙**만 둔다.
 *
 * ## 폴백은 «되는 것 아무거나» 가 아니다
 *
 * 문서 등급이 허용하지 않는 모델로 넘어가면 폴백이 곧 유출이다.
 * 순서를 훑되 **등급 관문을 매번 다시 통과**해야 한다.
 */

import type { DocClass } from '../domain/doc-class.ts'
import type { VendorRetention } from '../domain/doc-class.ts'

export interface AiModel {
  id: string
  vendorId: string
  /** 벤더가 아는 이름. 호출할 때 이 값을 보낸다 */
  modelName: string
  displayName: string
  /** 이 모델로 보내도 되는 문서 등급 */
  allowedDocClasses: DocClass[]
  /** 사내 서빙인가 — 그렇다면 외부 전송이 아니다 */
  internal: boolean
  retention: VendorRetention
  /** 백만 토큰당 원. 비용 기록에 쓴다 */
  inputKrwPerMTok: number
  outputKrwPerMTok: number
  /** 그림을 읽을 수 있나 */
  multimodal: boolean
  enabled: boolean
  /** 작을수록 먼저 시도한다 */
  sortOrder: number
}

/** DB 행 → 우리 모양. 칸 이름이 바뀌면 여기 한 곳만 고친다 */
export function toModel(row: Record<string, unknown>): AiModel {
  return {
    id: String(row.id),
    vendorId: String(row.vendor_id),
    modelName: String(row.model_name),
    displayName: String(row.display_name ?? row.model_name),
    allowedDocClasses: (row.allowed_doc_classes as DocClass[] | null) ?? [],
    internal: Boolean(row.is_internal),
    retention: {
      noTraining: Boolean(row.no_training),
      retentionDays: Number(row.retention_days ?? 30),
      zeroRetention: Boolean(row.zero_retention),
    },
    inputKrwPerMTok: Number(row.input_krw_per_mtok ?? 0),
    outputKrwPerMTok: Number(row.output_krw_per_mtok ?? 0),
    multimodal: Boolean(row.multimodal),
    enabled: row.enabled === undefined ? true : Boolean(row.enabled),
    sortOrder: Number(row.sort_order ?? 100),
  }
}

export interface ModelPick {
  /** 이 등급으로 쓸 수 있는 모델들. 앞이 1순위 */
  chain: AiModel[]
  /** 등급 때문에 빠진 모델들 — 화면이 「왜 없나」를 설명할 수 있게 */
  excluded: { model: AiModel; reason: 'doc_class' | 'disabled' | 'not_multimodal' }[]
}

export interface PickOptions {
  docClass: DocClass
  /** 그림을 읽어야 하나 */
  needMultimodal?: boolean
  /** 사내 서빙만 쓰고 싶은가 */
  internalOnly?: boolean
}

/**
 * 이 문서에 쓸 수 있는 모델 사슬을 만든다.
 *
 * 빠진 것을 **버리지 않고 사유와 함께 돌려준다** — 「쓸 모델이 없습니다」만 뜨면
 * 관리자가 무엇을 고쳐야 하는지 모른다.
 */
export function pickModels(models: readonly AiModel[], opts: PickOptions): ModelPick {
  const chain: AiModel[] = []
  const excluded: ModelPick['excluded'] = []

  for (const m of Array.from(models).sort((a, b) => a.sortOrder - b.sortOrder)) {
    if (!m.enabled) { excluded.push({ model: m, reason: 'disabled' }); continue }
    if (opts.needMultimodal && !m.multimodal) {
      excluded.push({ model: m, reason: 'not_multimodal' }); continue
    }
    if (opts.internalOnly && !m.internal) {
      excluded.push({ model: m, reason: 'doc_class' }); continue
    }
    // 등급을 여기서 한 번 거르고, 게이트웨이가 호출 직전에 한 번 더 본다.
    // 두 번 보는 이유: 사슬을 만든 뒤 등급이 바뀔 수 있다
    if (!m.allowedDocClasses.includes(opts.docClass)) {
      excluded.push({ model: m, reason: 'doc_class' }); continue
    }
    chain.push(m)
  }

  return { chain, excluded }
}

/** 이 호출의 비용 — 백만 토큰 단위 요금을 실제 토큰으로 환산 */
export function costKrw(model: AiModel, inputTokens: number, outputTokens: number): number {
  const cost = (inputTokens / 1_000_000) * model.inputKrwPerMTok
    + (outputTokens / 1_000_000) * model.outputKrwPerMTok
  return Math.round(cost * 100) / 100
}
