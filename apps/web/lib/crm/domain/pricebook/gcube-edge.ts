/**
 * gcube edge 가격표를 가격 기준의 말로 옮긴 것
 *
 * 원본은 만원 단위 가격표 이미지다. 여기 값은 원 단위다.
 * 시험(정답 견적)과 첫 채움(seed)이 이 한 벌을 같이 쓴다. 둘이 따로 적으면 언젠가 갈린다.
 */

import type { PriceProduct } from './types.ts'

const M = (manwon: number) => BigInt(manwon) * BigInt(10_000)

export const GCUBE_EDGE: PriceProduct = {
  id: 'gcube-edge',
  name: 'gcube edge',
  businessTypeKey: 'SOLUTION',
  tcoYears: 5,
  freeYears: 1,
  sections: [
    { name: '라이선스', roundingUnit: 10_000 },
    { name: '구축비', roundingUnit: 0 },
    { name: '유지보수', roundingUnit: 10_000 },
  ],
  items: [
    { id: 'edge-std', name: 'STD 기본 금액', section: '라이선스', listPriceMinor: M(1500), basis: 'FIXED', unit: '식', billing: 'ONCE', discountable: true, taxRate: 10 },
    { id: 'edge-ent', name: 'ENT 기본 금액', section: '라이선스', listPriceMinor: M(5100), basis: 'FIXED', unit: '식', billing: 'ONCE', discountable: true, taxRate: 10 },
    { id: 'edge-gpu-dc', name: 'GPU 라이선스 데이터센터용', section: '라이선스', listPriceMinor: M(730), basis: 'PER_UNIT', unit: '장', billing: 'ONCE', discountable: true, taxRate: 10 },
    { id: 'edge-gpu-ws', name: 'GPU 라이선스 워크스테이션용', section: '라이선스', listPriceMinor: M(220), basis: 'PER_UNIT', unit: '장', billing: 'ONCE', discountable: true, taxRate: 10, remark: '워크스테이션, 데스크톱, NPU' },
    { id: 'edge-gpu-timed', name: 'GPU 라이선스 지정 시간 제공', section: '라이선스', listPriceMinor: M(70), basis: 'PER_UNIT', unit: '장', billing: 'ONCE', discountable: true, taxRate: 10 },
    { id: 'edge-opt-split', name: '옵션 GPU 분할', section: '라이선스', listPriceMinor: M(400), basis: 'FIXED', unit: '식', billing: 'ONCE', discountable: true, taxRate: 10 },
    { id: 'edge-opt-portal', name: '옵션 사용자 포털', section: '라이선스', listPriceMinor: M(700), basis: 'FIXED', unit: '식', billing: 'ONCE', discountable: true, taxRate: 10 },
    { id: 'edge-opt-storage', name: '옵션 개인 스토리지', section: '라이선스', listPriceMinor: M(400), basis: 'FIXED', unit: '식', billing: 'ONCE', discountable: true, taxRate: 10 },
    { id: 'edge-build-std', name: 'STD 기본 구축', section: '구축비', listPriceMinor: M(1000), basis: 'FIXED', unit: '식', billing: 'ONCE', discountable: false, taxRate: 10, remark: '노드 20대 포함' },
    { id: 'edge-build-ent', name: 'ENT 기본 구축', section: '구축비', listPriceMinor: M(2000), basis: 'FIXED', unit: '식', billing: 'ONCE', discountable: false, taxRate: 10, remark: '노드 50대 포함' },
    { id: 'edge-node', name: '추가 노드 편입', section: '구축비', listPriceMinor: M(20), basis: 'PER_UNIT', unit: '대', billing: 'ONCE', discountable: false, taxRate: 10 },
    { id: 'edge-training', name: '추가 교육', section: '구축비', listPriceMinor: M(200), basis: 'PER_UNIT', unit: '회', billing: 'ONCE', discountable: false, taxRate: 10 },
    { id: 'edge-ent-switch', name: 'ENT 전환 구축', section: '구축비', listPriceMinor: M(1200), basis: 'FIXED', unit: '식', billing: 'ONCE', discountable: false, taxRate: 10, remark: '기존 STD 고객이 ENT 로 바꿀 때' },
    { id: 'edge-infra', name: '저장소, 네트워크, 보안 구성', section: '구축비', listPriceMinor: null, basis: 'SURVEY', unit: '식', billing: 'ONCE', discountable: false, taxRate: 10 },
    { id: 'edge-maint-std', name: '유지보수 표준', section: '유지보수', listPriceMinor: null, basis: 'RATIO', unit: '연', billing: 'ANNUAL', ratioPct: 15, ratioOfSection: '라이선스', discountable: false, taxRate: 10, remark: '도입 첫해 무상, 2년차부터 매년' },
    { id: 'edge-maint-ext', name: '유지보수 확장', section: '유지보수', listPriceMinor: null, basis: 'RATIO', unit: '연', billing: 'ANNUAL', ratioPct: 20, ratioOfSection: '라이선스', discountable: false, taxRate: 10, remark: '도입 첫해 무상, 2년차부터 매년' },
  ],
  rules: [
    { kind: 'ONE_OF', items: ['edge-std', 'edge-ent'] },
    { kind: 'ONE_OF', items: ['edge-maint-std', 'edge-maint-ext'] },
    { kind: 'WITH', item: 'edge-std', with: ['edge-build-std'] },
    { kind: 'WITH', item: 'edge-ent', with: ['edge-build-ent'] },
    { kind: 'INCLUDES', item: 'edge-ent', items: ['edge-opt-split', 'edge-opt-portal', 'edge-opt-storage'] },
    { kind: 'INCLUDES', item: 'edge-build-std', varKey: 'nodes', qty: 20 },
    { kind: 'INCLUDES', item: 'edge-build-ent', varKey: 'nodes', qty: 50 },
    { kind: 'QTY_FROM', item: 'edge-gpu-dc', varKey: 'gpu.dc' },
    { kind: 'QTY_FROM', item: 'edge-gpu-ws', varKey: 'gpu.ws' },
    { kind: 'QTY_FROM', item: 'edge-gpu-timed', varKey: 'gpu.timed' },
    { kind: 'QTY_FROM', item: 'edge-node', varKey: 'nodes', minusIncluded: true },
    { kind: 'QTY_FROM', item: 'edge-training', varKey: 'training' },
    { kind: 'CAP', item: 'edge-std', varKey: 'gpu.total', max: 300 },
    { kind: 'CAP', item: 'edge-ent', varKey: 'gpu.total', max: 1200 },
    { kind: 'ELIGIBLE', item: 'edge-gpu-timed', classes: ['WS', 'CONSUMER', 'NPU'] },
    { kind: 'DISCOUNT', companyKind: 'school', pct: 10, confirmed: false, label: '교육기관' },
    { kind: 'DISCOUNT', companyKind: 'public', pct: 0, confirmed: false, label: '공공기관' },
    { kind: 'DISCOUNT', companyKind: 'partner', pct: 20, confirmed: false, label: '파트너 공급' },
  ],
  examples: [
    {
      label: '가격표 계산 예시: STD, H100 4장, RTX 6000 Ada 6장, 데스크톱 8장 지정 시간, 옵션 분할과 포털',
      conditions: {
        picked: ['edge-std', 'edge-opt-split', 'edge-opt-portal', 'edge-maint-std'],
        gpus: [
          { model: 'H100 SXM', count: 4, timed: false },
          { model: 'RTX 6000 Ada', count: 6, timed: false },
          { model: 'RTX 5090', count: 8, timed: true },
        ],
        nodes: 18,
        training: null,
        companyKind: null,
        discount: 'none',
      },
      expectOnceMinor: M(8400),
      expectAnnualMinor: M(1110),
      expectTcoMinor: M(12840),
    },
  ],
}
