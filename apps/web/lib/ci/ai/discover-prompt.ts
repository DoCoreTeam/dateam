// lib/ci/ai/discover-prompt.ts — 발견이 벤더에 보내는 글 (순수)
//
// ## 왜 따로 뒀나
//
// 이 글의 길이가 곧 값이다. 실측 2026-09-20: 사흘 50,243건 중 97.6% 가 발견 호출이었고
// 입력 한 건이 평균 770토큰이었다. 그런데 길이를 재는 시험을 쓸 수가 없었다 —
// discover-server 가 앱 별칭(@/lib)을 쓰는 모듈을 끌어와서 시험이 그 파일을
// **글자로만** 읽었다. 정규식으로 상한 숫자가 적혀 있나만 보고 실제 길이는 못 쟀다.
//
// 글을 만드는 일은 바깥이 필요 없다. 떼어 두면 진짜로 만들어 보고 길이를 잴 수 있다.

import type { ContrastSet } from '../analysis/discovery.ts'

/** 대조쌍 하나에 콘텐츠가 넷이므로 이 값의 네 배가 프롬프트에 들어간다 */
export const CAPTION_CHARS = 120

/** 한 콘텐츠를 AI가 읽을 수 있게 편다. 없는 값은 "미확인"이라고 밝힌다 — 빈칸은 지어내기를 부른다. */
function describe(c: {
  title: string | null; caption: string | null
  durationSec: number | null; publishedAt: string | null; outlierIndex: number | null
}): string {
  const lines = [
    `제목: ${c.title?.trim() || '(미확인)'}`,
    /*
      설명은 120자까지만 보낸다.

      400자였다. 대조쌍 하나에 콘텐츠가 넷이니 설명만 최대 1,600자, 입력 한 건 평균
      770토큰의 절반 가까이를 설명이 차지했다. 그런데 찾는 것은 «잘된 하나에만 있는 차이»고,
      그 차이는 앞머리에서 드러난다 — 유튜브 설명은 뒤쪽이 해시태그와 링크와 정형 문구다.
      뒤를 더 보낸다고 차이가 더 보이지 않는다.
    */
    `설명: ${c.caption?.trim().slice(0, CAPTION_CHARS) || '(없음)'}`,
    `길이: ${c.durationSec != null ? `${c.durationSec}초` : '(미확인)'}`,
    `게시: ${c.publishedAt?.slice(0, 10) ?? '(미확인)'}`,
  ]
  if (c.outlierIndex != null) lines.push(`평소 대비: ${c.outlierIndex.toFixed(1)}배`)
  return lines.join('\n')
}

/**
 * 1차 프롬프트 — 대조쌍 하나를 읽고 차이를 쓴다.
 *
 * 프롬프트가 지켜야 하는 것 셋:
 *   ① 보기를 주지 않는다 (주면 그 순간 다시 채점기가 된다)
 *   ② 원문에서 확인되는 것만 (모르면 없다고 쓰게 한다)
 *   ③ 이 1건에만 있는 것 (넷 다 가진 특징은 차이가 아니다)
 */
export function buildFindingPrompt(set: ContrastSet): string {
  const peers = set.peers
    .map((p, i) => `[평범 ${i + 1}]\n${describe(p)}`)
    .join('\n\n')

  return [
    '같은 채널의 게시물 4건이다. 하나만 유난히 잘됐고 나머지 셋은 이 채널의 보통 수준이다.',
    '잘된 하나가 **나머지 셋과 다른 점**을 찾아라.',
    '',
    `[잘된 것]\n${describe(set.winner)}`,
    '',
    peers,
    '',
    '규칙:',
    '- 위 정보에서 실제로 확인되는 것만 써라. 확인 안 되면 found:false 로 답하라.',
    '- 넷이 공통으로 가진 특징은 차이가 아니다. 잘된 하나에만 있는 것을 써라.',
    '- 보기에서 고르는 것이 아니다. 무엇이든 네가 본 것을 네 말로 써라.',
    '- statement 는 다른 콘텐츠에도 적용할 수 있는 한 문장으로. ("실패담으로 시작한다")',
    '- observation 은 그렇게 본 근거를 원문에서 인용하거나 짚어라.',
    '- 채널 이름·조회수·운(알고리즘)은 따라 할 수 없으므로 쓰지 마라.',
    '',
    'JSON만 출력:',
    '{"found":true,"statement":"한 문장","observation":"근거","kind":"hook|subject|format|timing|presentation|other"}',
    '찾지 못했으면: {"found":false}',
  ].join('\n')
}

/** 2차 프롬프트 — 같은 뜻의 문장을 묶는다. 한국어 동의 판정은 문자열 정규화로 안 된다. */
export function buildClusterPrompt(statements: readonly { id: number; text: string }[]): string {
  return [
    '아래는 서로 다른 콘텐츠를 분석해 나온 문장들이다. **같은 뜻인 것끼리 묶어라.**',
    '',
    ...statements.map((s) => `${s.id}. ${s.text}`),
    '',
    '규칙:',
    '- 글자가 달라도 뜻이 같으면 한 묶음이다. ("실패담으로 시작한다" = "처음에 망한 얘기를 꺼낸다")',
    '- 뜻이 다르면 억지로 묶지 마라. 혼자인 문장은 혼자 두어라.',
    '- statement 는 그 묶음을 가장 잘 나타내는 한 문장으로 새로 써라.',
    '- 모든 번호가 정확히 한 묶음에 들어가야 한다. 빠뜨리지 마라.',
    '',
    'JSON만 출력:',
    '{"groups":[{"statement":"대표 문장","ids":[1,3,7],"kind":"hook|subject|format|timing|presentation|other"}]}',
  ].join('\n')
}
