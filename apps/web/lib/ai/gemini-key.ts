// lib/ai/gemini-key.ts — Gemini 키를 읽는 한 가지 방법
//
// **왜 생겼나**(v0.7.584): 같은 조회가 저장소 안에 **42곳**에 인라인으로 흩어져 있다.
// 그중 하나라도 칼럼 이름을 틀리면 그 기능만 "키가 없다"고 말한다 —
// 실제로 이 판에서 `content` 로 적었다가 키가 멀쩡한데 "키가 없어 못 만들었습니다"가 떴다.
// (`org_content` 의 값 칼럼은 `content` 가 아니라 **`value`** 다.)
//
// 42곳 이관은 별건이라 여기서 하지 않는다. 새로 쓰는 코드부터 이 함수를 쓴다.

/** META에서 Gemini API 키를 읽는다. 없으면 빈 문자열 — 부르는 쪽이 "없다"고 말할 수 있게. */
export async function readGeminiKey(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
): Promise<string> {
  const { data } = await admin.from('org_content').select('value').eq('key', 'META').maybeSingle()
  const meta = (data?.value as Record<string, unknown>) ?? {}
  return typeof meta.gemini_api_key === 'string' ? meta.gemini_api_key : ''
}
