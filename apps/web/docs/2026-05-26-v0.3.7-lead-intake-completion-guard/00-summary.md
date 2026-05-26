# FAST PATH Summary
작업: 리드 인테이크 API — company_name 없으면 completed 대신 failed로 저장
대상: app/api/leads/parse/route.ts
이유: Gemini가 실행은 됐지만 리드 핵심 데이터(company_name)를 추출 못한 경우에도 '완료'로 표시되어 사용자에게 정상인 것처럼 오해를 유발함
영향: page.tsx의 'failed' 배지는 이미 정의되어 있어 추가 수정 없음
