# 03 — 테스트 전략
프로젝트: newAX — 리드 인테이크 XLSX 대량 임포트
버전: v0.4.1
작성일: 2026-05-26

---

## 1. 핵심 검증 시나리오

### S1: BULK_MODE 감지 정확도
```
입력: ['회사명', 'GPU수요강도', 'Tier', ...]  → 결과: ColumnIndexMap 반환
입력: ['Company', 'Name', 'Email']            → 결과: null (SINGLE_MODE 유지)
입력: ['고객사명', '담당자', '이메일']          → 결과: null (회사명 없음)
```

### S2: gcube 378행 파일 처리
```
입력: gcube_고객전수평가_378_v1.0.xlsx
기대: 
  - 에러 없이 378행 처리 완료
  - lead_intakes에 378개 레코드 생성
  - 회사명이 있는 행: status='completed'
  - 회사명 없는 행: status='failed'
  - SSE 이벤트 정상 수신 (start → progress*N → done)
```

### S3: 컬럼 매핑 정확도
```
행 데이터: ['삼성전자', 'High', 'T1', '클라우드', '서울', '김철수', 'CTO', '010-1234-5678', 'cto@samsung.com', 'GPU 서버', '50', '95', '']
기대 ParsedLeadData:
  company_name: '삼성전자'
  gpu_demand_intensity: 'High'
  segment: 'Enterprise'  (T1 → Enterprise 변환)
  region: '서울'
  contact_name: '김철수'
  contact_title: 'CTO'
  contact_phone: '010-1234-5678'
  contact_email: 'cto@samsung.com'
  product_recommendation: 'GPU 서버'
  deal_value_billion: 50
  fit_score: 95
```

### S4: 기존 SINGLE_MODE 회귀 없음
```
명함 이미지 업로드 → 기존과 동일하게 단건 파싱
텍스트 입력 → 기존과 동일하게 단건 파싱
단건 XLSX (명함 정보 1행) → SINGLE_MODE로 처리
```

### S5: 중복 회사 처리
```
accounts에 '삼성전자' 이미 존재 → bulk-confirm 시 신규 생성 안 하고 기존 연결
contacts에 동일 이메일 존재 → 기존 Contact 연결
```

---

## 2. 수동 검증 체크리스트 (구현 완료 후)

- [ ] gcube 378행 파일 업로드 → 에러 없이 처리 완료
- [ ] 진행률 바가 실시간으로 업데이트됨
- [ ] 처리 완료 후 성공/실패 요약 표시
- [ ] 결과 테이블에 회사명/담당자/딜밸류 표시
- [ ] "CRM 등록" 버튼 → accounts/contacts/deals 생성 확인
- [ ] 기존 명함 업로드 여전히 정상 동작
- [ ] 모바일 뷰에서 결과 테이블 카드 레이아웃 정상
- [ ] SSE 연결 끊겼을 때 재연결 또는 에러 표시

---

## 3. 경계 케이스

| 케이스 | 기대 동작 |
|--------|-----------|
| 파일 크기 20MB 초과 | 기존 413 에러 유지 |
| 행 수 0 (헤더만) | "데이터 행이 없습니다" 에러 |
| 회사명 컬럼 있지만 모든 행이 빈 회사명 | 전체 failed, 사용자에게 경고 |
| Gemini API 타임아웃 | 해당 청크 재시도 1회, 실패 시 failed 처리 |
| 중간에 사용자가 페이지 이탈 | SSE 연결 종료, 이미 저장된 부분은 유지 |
| 동일 파일 재업로드 | 중복 lead_intakes 생성 허용 (사용자가 중복 정리) |
