# NEW RENT STORE 실제 운영 2.2.2 배포 — 2026-10-10

사용자가 NEW RENT STORE 실제 운영 앱을 2.2.2로 업데이트하도록 명시적으로 요청했다. 원래 RENT STORE와 2025 RENT STORE에는 쓰지 않았다.

## 배포 완료

- [운영 앱](https://script.google.com/macros/s/AKfycbzclS1FDsLvKEpojsGrQ9eh4dDrjpWP1OFeG2e4RG3LjmtVR7hQRCAutBoSMoXGmgae/exec): 기존 주소 유지, 앱 **2.2.2**, GAS 배포 **버전 6**.
- [GAS 프로젝트](https://script.google.com/u/0/home/projects/1n9IWX9Mzu30fZtm_DcMW5SRR69RqxH6BqOo8ydC4jcbPeTLP00UT-EQ4/edit): **NEW RENT STORE - GAS**.
- 배포 완료 시각: `2026-10-10T05:16:08.792Z` (한국시간 14:16).
- 검증된 제품 소스: `216ed176f52832252eaa5abe00ec1afd3adaf619`, [전체 CI 성공](https://github.com/ldjkorea/NEW-RENT-STORE/actions/runs/38025746326).
- 기존 독립 Sheet·저장 탭 ID·현재현황 Doc·계약 Calendar·브라우저 저장 접두사를 유지했다. Calendar는 기존 운영의 스크립트 속성과 새 소스의 고정 ID가 같음을 실제 Google 설정 화면에서 대조했다.
- OAuth 범위·소유자 전용 접근·배포 계정·웹앱 URL을 유지했다. 신규 권한 부여나 공유 확대 없이 기존 프로젝트를 업데이트했다.

## 배포 입력과 검증

[배포 ZIP](../releases/rental-independent-gas-2.2.2.zip)은 8개 파일·1,713,110 bytes이며 SHA-256은 `0d23ea2a8fec9b78905eafcbe6ab46b922afc44f331feda1fb5c3340924f31ae`다. ZIP은 로컬 보관하며 Git에서는 제외한다. [파일별 해시](../releases/gas-candidate-2.2.2.json), [제품 검증](../releases/development-2.2.2.json), [ZIP 실행 검증](../releases/validation-gas-candidate-2.2.2.json), [운영 반영 증거](../releases/operating-deployment-2.2.2.json)를 함께 보존한다.

1. 기존 전체 제품 검증: 단위 **192/192**, 브라우저 **14개 묶음**, 감사 **69/69**, PWA **5/5**, 익명 PDF **5종/18페이지**.
2. 이번 ZIP을 실제로 다시 읽어 실행: 서버 모의 **45/45**, 화면 **55/55**. ZIP 화면에서 생성한 익명 PDF **5종/18페이지**의 금액·A4 방향·빈 페이지·페이지 밖 텍스트·입금 기록 누락/중복 검사를 통과했다.
3. 현재 운영 버전 5의 Billing 소스와 2.2.2를 운영 원문에 읽기 전용으로 대조: **임차인 4명·고지서 38건·11개월**, 계산·수납·미납·분기 합계 차이 **0건**, 원문 정규화 변경 **0건**.
4. 업로드한 Google 소스와 불변 버전 6을 읽어 ZIP 파일 내용과 정확히 대조했다.
5. 로그인된 실제 운영 앱에서 페이지 제목·앱 메타 버전·사이드바 버전 **2.2.2**, 실제 Google 조회 완료와 배포 전 원문에 일치하는 revision을 확인했다. 월별 수입 추세 12개월과 수리·증빙 이력 화면도 확인했다.
6. native Sheets 읽기 값은 배포 직전·직후·실제 앱 화면 확인 후에도 배포 전과 동일했다.

## 데이터와 검증 경계

이번 작업은 운영 소스와 배포를 변경했다. 실제 임대 자료에 시험 입금·계약 변경·수리 기록을 저장하지 않았으며 Docs 재생성이나 Calendar 동기화도 실행하지 않았다. 실제 Google 저장 성공·문서/일정 갱신 완료·실물 휴대폰·실물 프린터까지 확인한 결과로 표시하지 않는다.

입금 원장 시작 뒤 청구 기준 변경 차단과 기존 이력 보존 규칙을 유지한다. 추정 표시가 있는 과거 기준 30건은 원문 고지서/계약 대조가 여전히 필요하며 이번 배포로 확정하지 않는다. 새 검증용 Google 프로젝트의 권한 대기와 실제 기기 검증은 별도 항목이다. 배포 완료는 이 조건들이 모두 해소되었다는 의미가 아니다.

## 복구와 보존

배포 전 버전 **5**와 작업 전 Google 전체 소스·배포 설정·운영 DB 원문을 `.private/operating-222/`에 비공개로 보관했다. Git checkpoint는 `checkpoint/before-operating-222`다. 버전 5는 삭제하지 않았다. 소스 복구가 필요하면 보존한 원문을 대조하고 같은 배포의 버전만 5로 되돌릴 수 있다. 이 절차는 DB 복원이나 과거 데이터 덮어쓰기를 포함하지 않는다.

실제 Google 화면 캡처는 Git 제외 `test-results/new-rent-store-operating-2.2.2.png`에 있다. 후보 생성 시점의 `productionReady:false`와 이전 릴리스 기록은 당시 검증 범위를 보존하며, 이번 실제 배포 완료 여부는 운영 반영 증거 파일을 따른다.
