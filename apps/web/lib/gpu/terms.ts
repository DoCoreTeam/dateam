// GPU 가격 모듈 — 용어 SSOT (B2B 한국 시스템 표준 용어집)
//
// 목적: UI 라벨/메시지를 화면마다 그때그때 박지 않고 한 곳에서 통일 관리.
//   - 신규/변경 화면은 반드시 이 GPU_TERMS를 import 해서 라벨을 쓴다.
//   - 같은 개념은 같은 단어로(예: "공급원가"는 어디서든 "공급원가"). 임의 변형 금지.
//   - 전역 i18n 인프라가 없어 도메인 단위 SSOT로 운영(추후 i18n 전환 시 여기만 키매핑).
//
// 작성 원칙(B2B 한국식): 간결한 한자어 명사 위주, 동작은 "~ 등록/수정/삭제/지정/해제/승인",
//   상태는 "~ 대기/완료/만료/반려". 영문·구어체·이모지 라벨 지양.

export const GPU_TERMS = {
  // 주체(엔티티)
  supplier: '공급사',
  competitor: '경쟁사',
  product: '상품',
  model: '모델',

  // 가격 개념
  supplyCost: '공급원가',        // 우리가 매입하는 원가
  sellPrice: '판매가',           // 마진 적용 후 우리 판매가
  margin: '마진',
  marketPrice: '시장가',         // 경쟁사 시장 가격
  listPrice: '공시가',           // 경쟁사 공시 판매가(원가 아님)
  gcubeListPrice: 'gcube 홈페이지 금액',  // basis='list' — 매입원가 없이 gcube.ai 게시가를 그대로 쓰는 판매가
  followPrice: '추종가',         // 경쟁사 시장가를 추종해 형성한 공급원가
  realQuote: '실견적',           // 실제 공급사에서 받은 견적(추종가보다 우선)
  lowestSupplyCost: '기준 공급원가',  // 지정(is_selected) 시 지정가, 미지정 시 유효 최저가 — 실효 기준 원가
  designatedCost: '지정 공급가',   // basis='selected' — 사용자가 판매가 기준으로 직접 지정한 공급가(자동 최저가 override)
  designateCost: '공급가 지정',    // 지정 버튼 라벨
  undesignateCost: '지정 해제',    // 지정 해제 버튼 라벨

  // 상태
  statusPending: '검토 대기',
  statusConfirmed: '확정',
  statusExpired: '만료',
  statusRejected: '반려',
  statusSuperseded: '대체됨',
  dualRole: '경쟁사 겸업',       // 경쟁사이자 공급사
  linked: '공급사 연결',

  // 재고 상태(가용량)
  stockFull: '전량 가용',
  stockPartial: '일부 가용',
  stockOut: '품절',

  // Tier 명칭(기획서 표기)
  tier1: '전용 고성능',
  tier2: '점유형',
  tier3: '간헐 공급',

  // 동작(CRUD·액션) — B2B 표준 동사
  create: '등록',
  edit: '수정',
  remove: '삭제',
  save: '저장',
  cancel: '취소',
  confirm: '확인',
  approve: '승인',
  reject: '반려',
  assignSupplier: '공급사로 지정',
  unlink: '연결 해제',
  sync: '가격 동기화',           // 저장 출처 재수집→공급원가 반영
  refresh: '새로고침',
  search: '검색',
  bulk: '일괄',
  bulkDelete: '일괄 삭제',
  bulkAssignSupplier: '일괄 공급사 지정',
  selectAll: '전체 선택',
  selected: '선택됨',

  // 안내 메시지(공통 톤)
  confirmBulkDelete: (n: number) => `선택한 경쟁사 ${n}곳을 삭제할까요? (소프트 삭제 — 복구 가능)`,
  confirmBulkAssign: (n: number) => `선택한 경쟁사 ${n}곳을 공급사로 지정할까요? 회사 정보와 현재 시장가가 공급원가로 등록됩니다.`,
  syncDesc: '저장된 수집 출처로 경쟁사 가격을 다시 가져와 공급원가에 반영합니다. 값이 바뀐 항목은 검토 대기로 등록됩니다.',
  emptyList: '등록된 항목이 없습니다.',
  noSearchResult: '검색 결과가 없습니다.',
  loadFailed: '불러오기에 실패했습니다.',
} as const

export type GpuTermKey = keyof typeof GPU_TERMS
