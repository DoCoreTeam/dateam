// GPU 아키텍처 세대 SSOT — 가격표 "최신순" 정렬 기준.
//
// 왜 코드 딕셔너리인가: 영업/고객이 말하는 "최신"은 출시일이 아니라 아키텍처 세대다
//   (Blackwell > Hopper > Ada > Ampere > Turing > Volta > Pascal > Maxwell > Kepler).
//   세대는 ~10개뿐, 모델명으로 판정 가능, 분기 단위로만 바뀐다 → tier-dict.ts 선례처럼
//   lib 딕셔너리(코드 SSOT)가 실용적. DB 컬럼(백필·삽입 유지비)은 얻는 게 없어 미도입.
//   신모델은 아래 규칙 1줄만 추가하면 된다.
//
// 큰 값 = 최신. 판정은 정규화 키(normModelKey)에 규칙을 순서대로 적용 — 더 구체적인 규칙이 먼저.
// 표시 로직 SSOT: 가격표 등 모든 뷰가 generationRank를 import해 정렬(뷰마다 인라인 복붙 금지).

import { normModelKey } from './canonical-model.ts'

export const GENERATION_RANK = {
  blackwell: 90,
  hopper: 80,
  ada: 70,
  ampere: 60,
  turing: 50,
  volta: 40,
  pascal: 30,
  maxwell: 20,
  kepler: 10,
  unknown: 0,
} as const

export type GenerationId = keyof typeof GENERATION_RANK

/** 세대 판정 규칙 — 위에서부터 첫 매치. key = normModelKey(모델명)(소문자·공백/하이픈 제거). */
const RULES: Array<{ gen: GenerationId; test: (k: string) => boolean }> = [
  // ── Blackwell(2024~) ── B200/B300, GB200/GB300, 소비자 RTX 50xx, 워크스테이션 "RTX PRO nnnn"(Ada의 "... Ada"와 구분)
  { gen: 'blackwell', test: (k) => /(^|[^a-z])b[23]00([^0-9]|$)/.test(k) || /gb[23]00/.test(k) },
  { gen: 'blackwell', test: (k) => /rtx50[6-9]0/.test(k) }, // 5060/5070/5080/5090 (+ti/super는 숫자 뒤 접미)
  { gen: 'blackwell', test: (k) => /rtxpro\d{3,4}/.test(k) && !/ada/.test(k) }, // "RTX PRO 6000/5000/2000" (Blackwell 워크스테이션)
  // ── Hopper(2022~) ── H100/H200, GH200
  { gen: 'hopper', test: (k) => /(^|[^a-z])h[12]00/.test(k) || /gh200/.test(k) },
  // ── Ada Lovelace(2022~) ── 소비자 RTX 40xx, L4/L40/L40S, 워크스테이션 "... Ada"(6000/5000/4500/4000/2000 Ada)
  { gen: 'ada', test: (k) => /rtx40[6-9]0/.test(k) }, // 4060/4070/4080/4090
  { gen: 'ada', test: (k) => /ada/.test(k) },          // "RTX 6000 Ada" 등
  { gen: 'ada', test: (k) => /(^|[^a-z])l40s?([^0-9]|$)/.test(k) || /(^|[^a-z])l4([^0-9]|$)/.test(k) },
  // ── Ampere(2020~) ── 소비자 RTX 30xx, 데이터센터 A100/A40/A10/A16, 워크스테이션 "RTX Axxxx"/"Axxxx"
  { gen: 'ampere', test: (k) => /rtx30[5-9]0/.test(k) }, // 3050..3090
  { gen: 'ampere', test: (k) => /(^|[^a-z])a100/.test(k) || /(^|[^a-z])a40([^0-9]|$)/.test(k) || /(^|[^a-z])a10([^0-9]|$)/.test(k) || /(^|[^a-z])a16([^0-9]|$)/.test(k) },
  { gen: 'ampere', test: (k) => /rtxa\d{4}/.test(k) },  // RTX A6000/A5000/A4000/A2000...
  { gen: 'ampere', test: (k) => /(^|[^a-z])a[2-6]000([^0-9]|$)/.test(k) || /(^|[^a-z])a[45]500([^0-9]|$)/.test(k) }, // A6000/A5000/A4000/A2000/A4500/A5500 (RTX 접두 없는 표기)
  // ── Turing(2018~) ── 소비자 RTX 20xx, T4, Quadro RTX(6000/8000/5000...)
  { gen: 'turing', test: (k) => /rtx20[6-9]0/.test(k) },
  { gen: 'turing', test: (k) => /(^|[^a-z])t4([^0-9]|$)/.test(k) },
  { gen: 'turing', test: (k) => /quadrortx/.test(k) },
  // ── Volta(2017) ── V100
  { gen: 'volta', test: (k) => /(^|[^a-z])v100/.test(k) },
  // ── Pascal(2016) ── Tesla P100/P40/P4/P6
  { gen: 'pascal', test: (k) => /tesla?p(100|40|4|6)\b/.test(k) || /teslap(100|40|4|6)/.test(k) },
  // ── Maxwell(2015) ── Tesla M40/M60/M10
  { gen: 'maxwell', test: (k) => /teslam(40|60|10)/.test(k) },
  // ── Kepler(2012) ── Tesla K40/K80
  { gen: 'kepler', test: (k) => /teslak(40|80)/.test(k) },
]

/** 모델명 → 세대 ID. 미판정은 'unknown'. */
export function generationOf(modelName: string | null | undefined): GenerationId {
  const k = normModelKey(modelName)
  if (!k) return 'unknown'
  for (const r of RULES) {
    if (r.test(k)) return r.gen
  }
  return 'unknown'
}

/** 모델명 → 세대 랭크(큰 값=최신). 정렬 키. 미판정은 0(맨 뒤). */
export function generationRank(modelName: string | null | undefined): number {
  return GENERATION_RANK[generationOf(modelName)]
}

const GEN_LABEL: Record<GenerationId, string> = {
  blackwell: 'Blackwell',
  hopper: 'Hopper',
  ada: 'Ada Lovelace',
  ampere: 'Ampere',
  turing: 'Turing',
  volta: 'Volta',
  pascal: 'Pascal',
  maxwell: 'Maxwell',
  kepler: 'Kepler',
  unknown: '기타',
}

/** 모델명 → 세대 표시명. 미판정은 '기타'. */
export function generationName(modelName: string | null | undefined): string {
  return GEN_LABEL[generationOf(modelName)]
}
