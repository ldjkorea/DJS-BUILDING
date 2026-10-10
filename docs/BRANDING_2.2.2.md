# NEW RENT STORE 이름 통일 — 2026-10-10

앱 표시 이름과 연결된 독립 GAS 프로젝트 이름을 사용자 요청에 따라 통일했다.

| 표시 위치 | 현재 이름 |
|---|---|
| 브라우저 탭·GAS 웹앱 페이지 제목 | NEW RENT STORE |
| PC 사이드바·PC/모바일 상단 브랜드 | NEW RENT STORE |
| PWA name·short_name·Apple 홈 화면 제목 | NEW RENT STORE |
| 연결된 독립 GAS 프로젝트 | NEW RENT STORE - GAS |

## 개발 소스

웹 개발 소스는 2.2.2이다. PWA 캐시의 버전만 함께 갱신했고, manifest id·scope·start_url·아이콘과 실제 저장 접두사 `rentalIndependent20261009.`를 유지했다. 긴 이름이 PC 사이드바에서 넘치지 않도록 브랜드 글자 크기를 조정했다.

생성 HTML 일치·JavaScript 문법·단위 192/192·독립 저장소 브라우저 7/7·PWA 브라우저 5/5를 통과했다. 1366px·390px에서 이름·설치 정보·화면 너비를 확인했다. 최초 단위 검사는 패키지 검사의 실행이 중단되어 완료되지 않았고, 다시 실행한 전체 단위 검사는 취소·실패 없이 192개를 통과했다. 서비스 워커가 허용된 익명 예시에서도 오프라인 준비 오류 없이 화면을 캡처했다.

기존 2.2.0 GAS ZIP과 검증 기록은 이전 후보로 보존한다. 이번 이름 변경 소스가 들어간 2.2.2 전체 GAS ZIP은 새로 만들지 않았다.

## 실제 Google 반영

연결된 [GAS 프로젝트](https://script.google.com/u/0/home/projects/1n9IWX9Mzu30fZtm_DcMW5SRR69RqxH6BqOo8ydC4jcbPeTLP00UT-EQ4/edit)를 **NEW RENT STORE - GAS**로 변경하고 편집기와 Apps Script API에서 확인했다.

[기존 운영 웹앱](https://script.google.com/macros/s/AKfycbzclS1FDsLvKEpojsGrQ9eh4dDrjpWP1OFeG2e4RG3LjmtVR7hQRCAutBoSMoXGmgae/exec)의 표시 이름은 기존 1.0 앱 소스에 한정해 반영했다. 배포 버전은 4에서 5로 갱신했고 웹앱 URL·소유자 전용 접근·실행 계정·OAuth 범위는 동일하다. API 응답·업로드 소스·불변 버전의 읽기 대조와 실제 로그인된 웹앱의 탭 제목·보이는 상단 브랜드·Apple 설치 제목을 확인했다.

- 변경한 운영 파일은 `App`과 `Code` 두 개다. `App`의 변경은 HTML·브랜드 CSS·내장 manifest의 표시 문구이며, 모든 inline JavaScript는 바이트가 같다. `Code`의 변경은 `HtmlService.setTitle` 인자 하나다.
- 나머지 6개 운영 파일과 계산·저장 함수·Google 연결 ID는 변경하지 않았다.
- 운영 DB A1:A1000은 배포 전후 및 실제 웹앱 접속 후 native Sheets 읽기 값이 동일했다. 임대 자료 저장·Docs 재생성·Calendar 동기화는 실행하지 않았다.
- 기존 배포 버전 4와 작업 전 전체 소스는 복구용으로 보존했다. 원문과 배포 도구·실제 화면은 비공개 `.private` 및 Git 제외 `test-results`에 있다.

개발 2.2.2의 계약/입금/수리 기능을 운영 GAS에 올린 결과로 해석하지 않는다. 별도 2.1.5 검증용 Google 프로젝트의 OAuth 승인 대기 상태도 이번 이름 변경과 별개다.

## Git

[NEW RENT STORE 저장소](https://github.com/ldjkorea/NEW-RENT-STORE)에 소스 변경을 반영했다. 원본 저장소와 오래된 저장소의 제품 소스에는 쓰지 않았다.

[최초 원격 전체 검사](https://github.com/ldjkorea/NEW-RENT-STORE/actions/runs/38023739148)는 감사 묶음 69개를 단일 프로세스에서 검사하던 중 180초 제한에 도달했다. 나머지 13개 묶음과 단위 192개는 통과했다. 감사 묶음을 35개·34개로 나눠 로컬 69/69를 확인했다. 추가 검증에서 새 이름과 200% 글자가 PC 사이드바 아래 메뉴를 밀어내는 문제를 확인하고 PC 범위의 스크롤과 이름 줄바꿈을 보완했다. 해당 6개 화면 크기·100%/200% 글자 검사 재현을 통과했다. PWA 캐시 버전을 2.2.2로 갱신해 보완 전 개발본과 구분한다.

[두 번째 원격 검사](https://github.com/ldjkorea/NEW-RENT-STORE/actions/runs/38025070400)에서도 나머지 13개 묶음과 단위 192개는 통과했지만 감사 검사는 완료되지 않았다. 한 프로세스는 180초를 넘겼고, 다른 프로세스에서는 재검증 중 다른 탭을 여는 테스트의 보류된 모의 fetch 응답이 JSON 파싱 오류가 되어 예상한 동시 편집 경고와 달랐다. 이 테스트의 응답 대기를 페이지 내부에서 제어하고 다른 탭 저장과 원문 보존 검증은 유지했다. 전송 실패는 별도의 기존 시나리오가 계속 검사한다.

현재 감사 묶음은 18개·17개·17개·17개의 네 부분으로 나누고 한 번에 최대 두 브라우저만 실행한다. 각 프로세스의 기존 180초 제한과 전체 69개 누락·중복·실패 검증을 유지하며, 개별 결과도 CI artifact에 보존한다. 제품 소스는 이 추가 테스트 보완에서 변경하지 않았다.

최종 로컬 전체 검사 `npm run test:all`은 단위 192/192와 브라우저 14개 묶음을 모두 통과했다. 합친 감사 결과는 69/69·고유 이름 69개다. 익명 PDF 5종·18페이지의 텍스트·금액·A4 방향·페이지 밖 텍스트·빈 페이지·입금 기록 누락/중복 검사도 통과했다. 생성 소스 `index.html`과 `server/Billing.gs`는 커밋과 같다.

[최종 전체 자동 검사](https://github.com/ldjkorea/NEW-RENT-STORE/actions/runs/38025746326)는 **성공**했다. 검증 소스는 `216ed176f52832252eaa5abe00ec1afd3adaf619`다. 원격 로그와 내려받은 artifact에서 단위 192/192·취소 0·브라우저 14개 묶음·감사 69/69·고유 이름 69개·PWA 5/5·익명 PDF 5종/18페이지를 대조했다. 감사 네 부분은 18개·17개·17개·17개로 모두 통과했고 생성 소스 일치 검사도 성공했다. 최종 검증 기록 커밋은 문서와 증거 JSON만 변경하며 `[skip ci]`로 제품 소스의 중복 검사를 생략한다.
