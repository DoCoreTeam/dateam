# 00 요구사항 — 모델명 공급사 오염 해결
## 문제
검토대기 확정 시 model_name="Nebius H100 SXM 80GB"(공급사명 오염)가 카탈로그 'H100 SXM'과 매칭 실패 → dead-end alert.
## 요구
1. 재발방지: intake에서 공급사 prefix 제거 + coreModelKey 방어.
2. 오류처리: 확정 실패 시 막다른 alert 대신 해소 흐름.
3. 등록절차: 기존 모델 매핑(1순위) + 신규 등록(2순위 prefill).
4. 기존 오염 행 일괄 정규화.
## 비범위
과병합/중복모델 양산 금지, push 금지.
