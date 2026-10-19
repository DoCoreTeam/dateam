/**
 * 가져오기 시험이 같이 쓰는 입력 — 시험 파일끼리 import 하면 남의 시험까지 돌아서 따로 둔다
 */

import type { PriceSheetRead } from './import-draft.ts'

/** gcube edge 가격표 이미지를 AI 가 읽었다고 치는 모양 — 금액은 원문(만원) 숫자 그대로 */
export const RAW = `gcube edge 가격표 (단위: 만원)
라이선스 | STD 기본 금액 | 1,500 | ENT 기본 금액 | 5,100
GPU 라이선스 데이터센터용 | 730 | 워크스테이션용 데스크톱용 NPU | 220 | 지정 시간 제공 | 70
옵션 GPU 분할 400 | 사용자 포털 700 | 개인 스토리지 400 (ENT 기본 포함)
구축비 | STD 기본 구축 1,000 (노드 20대 포함) | ENT 기본 구축 2,000 (노드 50대 포함) | 추가 노드 편입 20 | 추가 교육 200
유지보수 표준 15% 확장 20% (라이선스 계약 금액 대비, 2년차부터)
계산 예시: 라이선스 7,400 구축비 1,000 초기 도입 8,400 연 유지보수 1,110 5년 총비용 12,840`

export function read(over: Partial<PriceSheetRead> = {}): PriceSheetRead {
  const it = (name: string, section: string, price: number | null, basis = 'FIXED', extra: Partial<PriceSheetRead['items'][number]> = {}) => ({
    name, section, price, basis, unit: basis === 'PER_UNIT' ? '장' : '식', billing: 'ONCE', ratioPct: null, ratioOfSection: null,
    discountable: section === '라이선스', remark: null, sourceText: null, ...extra,
  })
  return {
    unit: '만원',
    product: { name: 'gcube edge', businessType: 'SOLUTION' },
    sections: [{ name: '라이선스', roundingUnitWon: 10_000 }, { name: '구축비', roundingUnitWon: null }, { name: '유지보수', roundingUnitWon: 10_000 }],
    items: [
      it('STD 기본 금액', '라이선스', 1500),
      it('ENT 기본 금액', '라이선스', 5100),
      it('GPU 라이선스 데이터센터용', '라이선스', 730, 'PER_UNIT'),
      it('GPU 라이선스 워크스테이션용', '라이선스', 220, 'PER_UNIT'),
      it('GPU 라이선스 지정 시간 제공', '라이선스', 70, 'PER_UNIT'),
      it('옵션 GPU 분할', '라이선스', 400),
      it('옵션 사용자 포털', '라이선스', 700),
      it('STD 기본 구축', '구축비', 1000),
      it('유지보수 표준', '유지보수', null, 'RATIO', { ratioPct: 15, ratioOfSection: '라이선스', billing: 'ANNUAL' }),
    ],
    rules: [
      { kind: 'ONE_OF', items: ['STD 기본 금액', 'ENT 기본 금액'] },
      { kind: 'WITH', item: 'STD 기본 금액', with: ['STD 기본 구축'] },
      { kind: 'QTY_FROM', item: 'GPU 라이선스 데이터센터용', varKey: 'gpu.dc' },
      { kind: 'QTY_FROM', item: 'GPU 라이선스 워크스테이션용', varKey: 'gpu.ws' },
      { kind: 'QTY_FROM', item: 'GPU 라이선스 지정 시간 제공', varKey: 'gpu.timed' },
    ],
    discounts: [{ label: '교육기관', companyKind: 'school', pct: 10, confirmed: false }],
    examples: [{
      label: '가격표 예시', picked: ['STD 기본 금액', '옵션 GPU 분할', '옵션 사용자 포털', '유지보수 표준'],
      gpus: [{ model: 'H100', count: 4, timed: false }, { model: 'RTX 6000 Ada', count: 6, timed: false }, { model: 'RTX 5090', count: 8, timed: true }],
      nodes: 18, expectOnce: 8400, expectAnnual: 1110, expectTco: 12840,
    }],
    grades: [],
    unclear: [],
    ...over,
  }
}

