// 표준 구성 사다리(×1/×2/×4/×8) 자동 적재 — v0.7.240부터 무력화(no-op).
//
// [정책 변경] 이 함수가 만들던 "견적 없는 ×N 파생 행"이 중복·전파 오가격(+355%)의 근본 원인이었음
// (실측: 2026-06-10 하루에 219행 일괄 생성, 마이그 129로 정리). "모델 유니크 + 세부데이터로 구분 +
// 중복 0" 정책에 따라 DB엔 실제 견적/스펙이 있는 구성만 존치하고, 파생 ×N은 표시계층(pricing.ts
// 1장당 전파)에서만 다룬다. 호출부 호환을 위해 시그니처는 유지하되 행을 생성하지 않는다.
//
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
export async function ensureStandardConfigs(_adminDb: any, _modelName: string): Promise<void> {
  // intentionally no-op — 유령 구성 자동생성 금지(중복 0). 파생 구성은 화면에서 파생.
  return
}
