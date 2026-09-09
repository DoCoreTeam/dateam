// AI 응답에서 JSON을 건져내는 SSOT, 구현은 `@ax/ai-gateway` 로 옮겼다(v0.10.0).
//
// 이 파일은 기존 호출처 여섯 곳이 경로를 안 바꾸도록 남겨 둔 재수출이다.
// 새 코드는 `@ax/ai-gateway` 에서 직접 가져온다.
//
// 옮기면서 `JsonRecoverError` 의 메시지를 영어로 바꿨다. 패키지는 화면에 나갈 말을
// 가지지 않는다, 그 말은 쓰는 쪽이 정한다. 이 예외의 메시지는 화면에 나가지 않고
// 호출처가 `sample` 만 로그에 쓴다(lib/ai/gemini-call.ts:515).
export { JsonRecoverError, recoverJson, asJsonRecord } from '@ax/ai-gateway'
