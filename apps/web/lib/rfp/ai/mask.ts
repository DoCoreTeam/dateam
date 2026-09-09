// 개인정보 마스킹 SSOT, 구현은 `@ax/ai-gateway` 로 옮겼다(v0.10.0).
//
// 자리표 규칙은 지역(한국) 사실이라 패키지 안에 있고, 우리 회사 사실이 아니다.
// 이 파일은 기존 호출처가 경로를 안 바꾸도록 남겨 둔 재수출이다.
export {
  type PiiKind,
  type PiiHit,
  type MaskResult,
  tokenFor,
  maskPii,
  unmaskPii,
  roundTrips,
  hasUnmaskedPii,
  countByKind,
} from '@ax/ai-gateway'
