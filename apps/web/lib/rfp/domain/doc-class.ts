/**
 * 문서 등급 — 이 문서를 어디까지 내보낼 수 있나 (설계서 3.13.1)
 *
 * ## 왜 등급이 먼저인가
 *
 * RFP 는 「공개된 공고 첨부」와 「NDA 걸린 대기업 제안요청서」가 **같은 화면에 섞여 들어온다.**
 * 둘을 같은 경로로 처리하면 언젠가 반드시 NDA 문서가 외부 벤더로 나간다.
 * 그래서 등급은 인입 시점에 정해지고, 그 뒤 모든 외부 호출이 이 표를 먼저 본다.
 *
 * ## 여기 없는 것
 *
 * **화면에 뜨는 말은 여기 없다** — `lib/rfp/terms.ts` 한 곳이다.
 * 이 파일은 «무엇이 허용되는가»만 정한다. 그 판정을 사람에게 어떻게 설명할지는 말의 문제다.
 *
 * ## 섞이면 높은 쪽이 이긴다
 *
 * 케이스 하나에 공개 공고문과 NDA 과업내용서가 함께 있으면 그 케이스는 NDA 다.
 * 「대부분 공개니까 공개」로 처리하면 가장 위험한 한 건이 가장 약한 규칙을 탄다.
 */

/** 등급 3종 — 이 밖은 없다 */
export type DocClass = 'public' | 'restricted' | 'nda'

/** 낮은 것부터. 섞였을 때 어느 쪽이 이기는지를 이 순서가 정한다 */
export const DOC_CLASS_ORDER: readonly DocClass[] = ['public', 'restricted', 'nda']

/** 외부 전송 허용 방식 */
export type TransferRule =
  /** 승인된 벤더면 보낸다 */
  | 'allowed'
  /** 학습 미사용이면서 무보존 또는 ZDR 계약 벤더만 */
  | 'zero_retention_only'
  /** 기본 차단. 관리자 예외 승인 + ZDR 벤더일 때만 */
  | 'blocked_unless_approved'

export interface DocClassPolicy {
  /** 외부 벤더로 원문이나 청크를 보낼 수 있나 */
  externalVendor: TransferRule
  /** 교차검증으로 같은 문서를 여러 벤더에 보낼 수 있나 */
  crossVerify: TransferRule
  /** 상용 파서와 상용 이미지 텍스트화 엔진을 쓸 수 있나 */
  commercialParser: TransferRule
  /**
   * 프롬프트 캐시를 켤 수 있나.
   * Anthropic 의 명시적 캐시는 ZDR 예외라 조건부 공개 이상에서는 끈다(설계서 5장 7).
   */
  promptCache: boolean
  /** 개인정보 마스킹 — 세 등급 모두 필수라 값이 하나뿐이지만 표에서 빼지 않는다 */
  masking: true
  /** 원본 파일 자동 삭제까지의 일수. null 이면 케이스를 지울 때까지 보관 */
  originRetentionDays: number | null
  /** 감사 로그에 무엇까지 남기나 */
  auditDetail: 'transfer' | 'transfer_approver' | 'transfer_approver_reason'
}

/**
 * 설계서 3.13.1 정책 매트릭스를 코드로 옮긴 것.
 * 표를 고칠 일이 생기면 **설계서와 이 표를 같이 고친다** — 한쪽만 고치면 어느 쪽이 진실인지 알 수 없다.
 */
export const DOC_CLASS_POLICY: Record<DocClass, DocClassPolicy> = {
  public: {
    externalVendor: 'allowed',
    crossVerify: 'allowed',
    commercialParser: 'allowed',
    promptCache: true,
    masking: true,
    originRetentionDays: null,
    auditDetail: 'transfer',
  },
  restricted: {
    externalVendor: 'zero_retention_only',
    crossVerify: 'zero_retention_only',
    commercialParser: 'zero_retention_only',
    promptCache: false,
    masking: true,
    originRetentionDays: 90,
    auditDetail: 'transfer_approver',
  },
  nda: {
    externalVendor: 'blocked_unless_approved',
    crossVerify: 'blocked_unless_approved',
    commercialParser: 'blocked_unless_approved',
    promptCache: false,
    masking: true,
    originRetentionDays: 30,
    auditDetail: 'transfer_approver_reason',
  },
}

/** 등급 값인가 — DB 와 요청 본문에서 들어오는 값을 경계에서 검사한다 */
export function isDocClass(v: unknown): v is DocClass {
  return typeof v === 'string' && (DOC_CLASS_ORDER as readonly string[]).includes(v)
}

/** 섞였을 때 이기는 등급. 빈 목록은 가장 안전한 쪽으로 본다 */
export function maxDocClass(list: readonly DocClass[]): DocClass {
  if (list.length === 0) return 'nda'
  return list.reduce((a, b) => (DOC_CLASS_ORDER.indexOf(b) > DOC_CLASS_ORDER.indexOf(a) ? b : a))
}

/** 벤더 보존 정책 — ai_vendors.retention_policy 가 이 모양으로 저장된다 */
export interface VendorRetention {
  /** 입출력을 학습에 쓰지 않는다고 약관에 명시돼 있나 */
  noTraining: boolean
  /** 기본 보존 일수. 0 이면 미보존 */
  retentionDays: number
  /** 조직 단위 ZDR(무보존) 계약이 적용돼 있나 */
  zeroRetention: boolean
}

export interface VendorTransferInput {
  docClass: DocClass
  /** 이 모델이 허용한다고 등록된 등급 목록(ai_models.allowed_doc_classes) */
  allowedDocClasses: readonly DocClass[]
  retention: VendorRetention
  /** 관리자 예외 승인이 이 케이스에 걸려 있나 */
  adminApproved?: boolean
  /** 사내에서 직접 서빙하는 벤더인가. 그렇다면 외부 전송이 아니다 */
  internal?: boolean
}

export type TransferDenyReason =
  | 'model_not_allowed_for_class'
  | 'training_not_excluded'
  | 'retention_not_zero'
  | 'admin_approval_required'

export type TransferDecision =
  | { allowed: true; internal: boolean }
  | { allowed: false; reason: TransferDenyReason }

/**
 * 이 문서를 이 모델로 보내도 되나 — **외부 호출 직전에 반드시 통과해야 하는 관문**
 *
 * 게이트웨이 한 곳에서만 부른다. 화면이나 다른 모듈이 각자 판단하기 시작하면
 * 판단이 여러 벌이 되고, 그중 하나만 느슨해도 그 길로 문서가 나간다.
 */
export function decideTransfer(input: VendorTransferInput): TransferDecision {
  const { docClass, allowedDocClasses, retention } = input

  // 사내 서빙은 외부 전송이 아니다 — 등급 제한의 대상이 아니라 등급 제한의 해답이다
  if (input.internal) return { allowed: true, internal: true }

  if (!allowedDocClasses.includes(docClass)) {
    return { allowed: false, reason: 'model_not_allowed_for_class' }
  }

  const rule = DOC_CLASS_POLICY[docClass].externalVendor
  if (rule === 'allowed') return { allowed: true, internal: false }

  if (!retention.noTraining) return { allowed: false, reason: 'training_not_excluded' }

  const zero = retention.zeroRetention || retention.retentionDays === 0
  if (!zero) return { allowed: false, reason: 'retention_not_zero' }

  if (rule === 'blocked_unless_approved' && !input.adminApproved) {
    return { allowed: false, reason: 'admin_approval_required' }
  }

  return { allowed: true, internal: false }
}
