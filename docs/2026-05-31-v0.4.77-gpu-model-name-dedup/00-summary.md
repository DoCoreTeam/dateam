# FAST PATH Summary (MEDIUM 경량)
작업: GPU 모델명 중복 표시 문제 해결 — MarketTab 표시 개선 + 자동생성 중복 방지
대상: MarketTab.tsx, review/[id]/route.ts
이유: gpu_products에 "A100" model_name 행이 6개 존재(40/80/160/320/640GB + PCIe).
      화면에서 모두 "A100"으로만 표시되어 구분 불가.
      자동생성 시 memory 조건 없이 토큰 매칭 → 동일 제품 재생성 위험.
영향: MarketTab 행 표시 (메모리 병기) + auto-create 로직 (memory eq 조건 추가)
DB변경: 없음
