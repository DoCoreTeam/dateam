# 테스트
- 단위: parse-quantity (8GPU/x8/box(8)→8), tier 사전, per-GPU 환산
- 통합: confirm 멱등(같은 공급사 2회→1활성+1superseded)
- 브라우저: 견적입력→4탭 동시반영, B300 x1/x4/x8, 모델 그룹 드롭다운
- 회귀: 기존 A100 등 가격 정확성, RLS
