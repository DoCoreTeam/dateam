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
import {
  pickModels as corePickModels,
  type ModelPick as CoreModelPick,
  type PickOptions as CorePickOptions,
} from '@ax/ai-providers'
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
  /**
   * 한 번에 받을 수 있는 입력 토큰. 모르면 null.
   *
   * 이 값을 안 보고 상수로 보내면 **작은 모델에서만 413 이 난다** —
   * 실측 2026-09-09: Groq 무료 티어가 분당 7,000 인데 46,671 을 보내 8/9 태스크가 죽었다.
   */
  maxInputTokens: number | null
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
    maxInputTokens: row.max_input_tokens === null || row.max_input_tokens === undefined
      ? null : Number(row.max_input_tokens),
  }
}

// 모델 고르기 규칙은 `@ax/ai-providers` 에 있다. 「켜져 있나, 그림을 읽나, 등급이 맞나」는
// 모델 고르기의 일반 문제이고, 우리 등급 어휘만 여기서 끼워 넣는다.
// 빠진 것을 사유와 함께 돌려주는 것도 거기서 한다. 「쓸 모델이 없습니다」만 뜨면
// 관리자가 무엇을 고쳐야 하는지 모르기 때문이다
export type ModelPick = CoreModelPick<AiModel>
export type PickOptions = CorePickOptions<DocClass>

export function pickModels(models: readonly AiModel[], opts: PickOptions): ModelPick {
  return corePickModels<DocClass, AiModel>(models, opts)
}

/** 이 호출의 비용 — 백만 토큰 단위 요금을 실제 토큰으로 환산 */
// 비용 계산은 관문이 기록할 때 쓰는 것과 같은 식이어야 한다 —
// 두 벌로 두면 장부와 화면의 금액이 갈린다. 그래서 패키지 한 곳에 두고 여기서는 다시 내보낸다
export { costKrw } from '@ax/ai-gateway'
