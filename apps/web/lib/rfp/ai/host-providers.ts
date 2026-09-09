/**
 * 호스트 AI 공급자를 그대로 쓴다 (사용자 개입 iv_0020)
 *
 * ## 왜 RFP 가 자기 키 설정을 안 갖나
 *
 * AI 공급자는 **이미 관리자 설정에 한 벌 있다**(`lib/ai-chat/registry`, `org_content.META`).
 * 거기 Gemini·Claude·OpenAI·Groq·Grok 키가 들어 있고 사내 전체가 그것을 쓴다.
 *
 * RFP 가 자기 키 폼을 또 만들면 ⓐ 같은 키를 두 군데 넣게 되고
 * ⓑ 한쪽만 바꿔 놓고 「왜 RFP 만 안 되지」를 겪는다.
 * 실제로 그렇게 만들었다가 사용자에게 지적받았다.
 *
 * ## 그럼 RFP 에만 있는 것은 무엇인가
 *
 * **문서 등급별 허용**이다. 「이 모델에 NDA 문서를 보내도 되나」는 RFP 만의 질문이고,
 * AI 채팅에는 그런 개념이 없다. 그래서 키는 호스트가, 등급 정책은 RFP 가 갖는다.
 */

import type { DocClass } from '../domain/doc-class.ts'
import type { AiModel } from './models.ts'

/** `lib/ai-chat/registry` 의 ProviderConfig 에서 우리가 쓰는 부분만 */
export interface HostProvider {
  id: string
  apiKey: string
  model: string
}

/**
 * RFP 가 갖는 유일한 벤더 설정 — 등급별 허용.
 *
 * DB(`rfp_ai_models.allowed_doc_classes`)에 있고 관리자가 화면에서 고친다.
 * 없으면 **가장 안전한 쪽**(공개만)으로 본다 — 모르는 모델에 NDA 를 보내지 않는다.
 */
export interface DocClassPolicyRow {
  providerId: string
  allowedDocClasses: DocClass[]
  /** 사내에서 직접 서빙하나 */
  internal: boolean
  noTraining: boolean
  zeroRetention: boolean
  inputKrwPerMTok: number
  outputKrwPerMTok: number
  multimodal: boolean
  sortOrder: number
}

/** 정책이 없는 공급자의 기본값 — 공개 문서만 */
export const SAFE_DEFAULT: Omit<DocClassPolicyRow, 'providerId'> = {
  allowedDocClasses: ['public'],
  internal: false,
  // 모르면 학습에 쓰인다고 본다 — 아니라고 가정하면 그 가정이 틀렸을 때 되돌릴 수 없다
  noTraining: false,
  zeroRetention: false,
  inputKrwPerMTok: 0,
  outputKrwPerMTok: 0,
  multimodal: false,
  sortOrder: 100,
}

/**
 * 호스트 공급자 + RFP 등급 정책 → 게이트웨이가 아는 모델.
 *
 * 키가 없는 공급자는 **아예 안 나온다** — 화면이 「쓸 수 있다」고 말해 놓고
 * 호출에서 터지는 것이 가장 나쁘다.
 */
export function toModels(
  providers: readonly HostProvider[],
  policies: readonly DocClassPolicyRow[],
): AiModel[] {
  const byId = new Map(policies.map((p) => [p.providerId, p]))

  return providers
    .filter((p) => p.apiKey && p.model)
    .map((p) => {
      const policy = byId.get(p.id) ?? { providerId: p.id, ...SAFE_DEFAULT }
      return {
        id: p.id,
        vendorId: p.id,
        modelName: p.model,
        displayName: p.id,
        allowedDocClasses: policy.allowedDocClasses,
        internal: policy.internal,
        retention: {
          noTraining: policy.noTraining,
          retentionDays: policy.zeroRetention ? 0 : 30,
          zeroRetention: policy.zeroRetention,
        },
        inputKrwPerMTok: policy.inputKrwPerMTok,
        outputKrwPerMTok: policy.outputKrwPerMTok,
        multimodal: policy.multimodal,
        enabled: true,
        sortOrder: policy.sortOrder,
      }
    })
    .sort((a, b) => a.sortOrder - b.sortOrder)
}

/** DB 행 → 등급 정책 */
export function toPolicy(row: Record<string, unknown>): DocClassPolicyRow {
  return {
    providerId: String(row.provider_id ?? row.vendor_id ?? ''),
    allowedDocClasses: (row.allowed_doc_classes as DocClass[] | null) ?? ['public'],
    internal: Boolean(row.is_internal),
    noTraining: Boolean(row.no_training),
    zeroRetention: Boolean(row.zero_retention),
    inputKrwPerMTok: Number(row.input_krw_per_mtok ?? 0),
    outputKrwPerMTok: Number(row.output_krw_per_mtok ?? 0),
    multimodal: Boolean(row.multimodal),
    sortOrder: Number(row.sort_order ?? 100),
  }
}

/** 관리자 설정으로 가는 길 — RFP 화면은 여기로 보낸다 */
export const HOST_AI_SETTINGS_HREF = '/admin/settings'
