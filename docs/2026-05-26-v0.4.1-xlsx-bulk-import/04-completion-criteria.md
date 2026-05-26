# 04 — 완료 기준
프로젝트: newAX — 리드 인테이크 XLSX 대량 임포트
버전: v0.4.1
작성일: 2026-05-26

---

## 완료 판단 기준 (전체 충족 시 완료)

### 기능 완료
- [ ] C1: gcube_고객전수평가_378_v1.0.xlsx 업로드 시 에러 없이 처리 완료
- [ ] C2: lead_intakes에 각 행 결과 레코드 생성 (source='xlsx_bulk')
- [ ] C3: 회사명/담당자/Tier/딜밸류 컬럼이 올바르게 parsed_data에 저장
- [ ] C4: 진행률 SSE 실시간 표시 (프로그레스 바)
- [ ] C5: 처리 완료 후 성공/실패 요약 카드 표시
- [ ] C6: "CRM 등록" 버튼으로 accounts/contacts/deals 생성
- [ ] C7: 기존 SINGLE_MODE(명함/텍스트/단건) 회귀 없음

### 품질 완료
- [ ] C8: `pnpm build` 에러 없음
- [ ] C9: TypeScript 타입 에러 없음
- [ ] C10: BULK_MODE와 SINGLE_MODE 분기가 명확히 분리됨
- [ ] C11: 모바일 반응형 (결과 테이블 카드 레이아웃)

### 보안 완료
- [ ] C12: RLS — 본인 lead_intakes만 접근 가능
- [ ] C13: Gemini API 키 노출 없음
- [ ] C14: 파일 사이즈 제한(20MB) 유지

---

## 제외 범위 (이번 스프린트에서 하지 않는 것)

- bulk-confirm 이후 accounts/contacts/deals 편집 UI (기존 페이지 활용)
- 업로드 이력/재시도 관리 UI
- 파일 컬럼 자동 매핑 UI (수동 매핑 인터페이스)
- 대용량 파일(1000행 이상) 최적화 (378행 기준으로 구현)
- 진행 중 업로드 취소 기능
- 다국어(i18n) 지원 (한국어만)

---

## 검증 명령어

```bash
# 빌드 검증
cd apps/web && pnpm build

# 타입 검사
cd apps/web && pnpm tsc --noEmit

# 마이그레이션 검증 (Supabase CLI)
supabase db diff --schema public
```
