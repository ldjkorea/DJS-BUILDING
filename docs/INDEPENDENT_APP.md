# 임대관리 독립앱 — 연결 대상과 검증 기록

2026-10-09 생성. 임대관리 1.4 저장소의 현재 `main` 커밋 `2b01a2e`를 전체 Git 이력과 함께 별도 폴더에 복제했다. 계산 규칙과 화면, 백업 JSON 형식은 이어받고 저장 경로와 Google 연결 대상을 분리했다.

## 바로 사용하기

주 사용 주소: [임대관리 독립앱](https://script.google.com/macros/s/AKfycbzclS1FDsLvKEpojsGrQ9eh4dDrjpWP1OFeG2e4RG3LjmtVR7hQRCAutBoSMoXGmgae/exec).

해당 Google 소유자 계정으로 로그인해야 한다. 사용자 승인 후 시트·문서·Calendar 권한 부여를 완료했다. GAS 내부에서 앱을 제공하며, `google.script.run`을 통해 동일한 독립 프로젝트의 API를 호출한다. 초기 실행은 복제한 시트 자료를 가져오며, 설정의 **구글에 지금 저장**과 운영현황의 **Google Calendar 동기화**를 사용할 수 있다.

현재 독립 배포 버전은 4다. 서버와 `App` HTML을 포함한 8개 파일의 업로드 후 원격 내용을 재조회해 로컬 소스와 동일한 것을 확인했다.

| 구분 | 독립앱의 연결 대상 |
|---|---|
| 자료 폴더 | [임대관리 독립앱 - 2026-10-09](https://drive.google.com/drive/folders/1W1s4IzT4sBDymE7xK-KKvEiE0424SbxC) |
| 데이터베이스 | [임대관리 독립앱 - 데이터베이스](https://docs.google.com/spreadsheets/d/1E9YcSQSNTLTC41fqWBYHMNpSRKQrDlvAXeF9AxdDFb8/edit) |
| 현재현황 문서 | [임대관리 독립앱 - 현재현황](https://docs.google.com/document/d/1YjTZPiRA2vnfAuWp1UTBci8F4yUNozQjYhE9QwMdtuQ/edit) |
| GAS 프로젝트 | [임대관리 독립앱 - GAS](https://script.google.com/u/0/home/projects/1n9IWX9Mzu30fZtm_DcMW5SRR69RqxH6BqOo8ydC4jcbPeTLP00UT-EQ4/edit) |
| Calendar | `임대관리 독립앱 - 계약 일정` |

독립 Calendar ID: `46b18e877a67e561142297edc9ea44486c33f728809f327cd35e339a8e491c9f@group.calendar.google.com`.

## 분리한 범위

- Google Drive의 원본 시트를 파일 단위로 복제했다. 데이터 시트와 `_RentalSyncRecovery` 복구 시트를 포함한다. 연결된 GAS도 새 바인딩 프로젝트가 생성되는 것을 확인했다.
- 실제 원본 GAS의 소스를 조회하고 Git의 서버 코드와 대조했다. 기존 문서 권한 확인 도우미도 `server/AuthorizeDocs.gs`로 보존했다.
- 독립 시트 ID를 서버에 고정했다. 활성 시트나 원본 저장소로 돌아가는 경로를 사용하지 않는다.
- 현황 문서를 복제하고 새 문서 ID에 고정했다. Script Properties에 다른 문서 ID가 들어 있으면 오류로 중단한다.
- 기본 Calendar 대신 새 계약 일정 Calendar를 만들었다. 일정 ID 매핑도 새 프로젝트의 `INDEPENDENT_CONTRACT_CALENDAR_EVENTS_V1`에만 저장한다. 개인 캘린더의 업무 외 일정은 이 앱의 복제 범위가 아니다.
- 새 GAS 프로젝트에서 새로운 소유자 전용 웹앱 배포를 만들었다. 원본 배포 ID와 프로젝트는 그대로 두었다.
- 브라우저의 데이터·설정·테마·동기화 상태·탭 간 잠금 키에 `rentalIndependent20261009.`를 붙였다. 예시 모드에는 추가로 `rentalDemo.`를 붙인다. JSON 백업 형식과 논리 저장 키는 유지한다.
- PWA 캐시 이름과 앱 ID도 독립 이름으로 바꿨다. 캐시 정리는 독립앱 접두사에만 적용한다.
- 로컬 포트는 `4274`로 분리했다. `source-readonly` 원격은 복제 출처 확인용이며 push URL을 `DISABLED`로 설정했다. 원격 push와 별도 GitHub 저장소 생성은 수행하지 않았다.

조건부 저장의 `expectedRevision`, 고유 `requestId`, `LockService`, 복구 시트와 저장 후 재조회 검증을 보존했다. Google 문서 갱신 상태는 DB 저장 결과와 별도로 처리한다.

## 확인한 결과

### 실제 새 Google 환경

- 초기 복제본 시트의 전체 활성 JSON은 원본과 동일했다.
- 새 웹앱에서 세입자 4명과 고지서 11개월 자료를 불러왔다.
- 새 앱의 수동 저장을 실행하고 서버 revision 변경과 저장 확인 표시를 확인했다.
- 저장 후 전체 도메인 데이터가 복제 전과 일치했다. Apps Script 객체 전송이 중첩 `null`을 누락하는 문제를 발견해 JSON 문자열 전송으로 수정했고, 변경 이력의 `null`까지 보존되는 것을 재검증했다.
- 새 현재현황 문서 생성과 새 문서 링크를 확인했다.
- 새 Calendar 최초 동기화에서 생성 4건, 재동기화에서 생성 0건·갱신 4건을 확인했다.
- 실제 독립앱 저장 후 원본 활성 시트 A1:A3의 문자열 전체가 처음 읽은 값과 일치했다.
- 원본 GAS 소스와 원본 배포 설정을 최초 조회 내용과 대조했다. 이번 작업은 원본 프로젝트를 갱신하지 않는다.
- 원본 문서의 최종 수정일은 2026-10-04로 유지됐고, 복제 문서만 2026-10-09에 갱신됐다.

### 로컬 검사

- `npm run build`, `npm run check:build`, `npm run check` 통과.
- `npm test`: 85개 통과.
- `npm run test:independent`: 독립성 관련 브라우저 시나리오 7개 통과. 원본 로컬 데이터 보존, 저장·재실행, 원본 storage 이벤트 격리, 테마 격리, 예시 모드 격리, PC·모바일 7개 메뉴의 가로 넘침 없음, GAS JSON 문자열 전송과 `null` 보존을 검증했다. 외부 요청은 차단한 별도 브라우저 프로필을 사용했다.
- 원본에서 이어받은 브라우저 전체 묶음은 7개 실패가 남았다. 수정 전 Git `2b01a2e`의 깨끗한 별도 복제본에서도 같은 실패를 재현했다. 기존 수정 버튼 선택자, 카카오 문구, 엘리베이터 VAT 기대값, 수동 배분 버튼, 수동 덮어쓰기 충돌 시나리오, 과거 PWA 캐시 버전 기대값, 기존 터치 영역 기준에 해당한다. 이 묶음 전체가 통과했다고 보고하지 않는다.

화면과 JSON 결과는 Git에서 제외되는 `test-results/`에 있다. 원본·복제본 소스 조회와 데이터 대조 자료는 Git에서 제외되는 `.private/`에 보관하며 실제 운영 데이터를 소스 저장소에 추가하지 않는다.

## 로컬 실행과 후속 개발

```powershell
npm start
# http://127.0.0.1:4274/
```

로컬 실행본은 브라우저 저장소가 별도이며 클라우드 연결은 기본적으로 꺼져 있다. 현재 Google 데이터와 연동해서 사용할 주소는 위의 GAS 웹앱이다. 로컬·단일 HTML 실행본에는 필요하면 JSON 백업을 가져온다.

GAS가 제공하는 웹앱은 로그인된 온라인 이용을 기준으로 한다. GAS iframe에서 상대 경로 PWA 서비스 워커를 등록하지 않는다. 정적 소스의 PWA·오프라인 기능은 보존했으며, 모바일 홈 화면 설치와 실제 기기의 오프라인 동작은 이번 작업에서 검증하지 않았다.

`src/index.template.html`, `assets/`를 수정한 뒤 `npm run build`로 `index.html`과 공유 계산 코드 `server/Billing.gs`를 생성한다. `index.html`은 GAS의 `App` HTML 파일에 대응하며 `server/*.gs`와 `server/appsscript.json`은 독립 GAS 프로젝트에 대응한다. Google 서버 파일을 바꾸면 새 버전을 만들어 **독립 배포만** 갱신해야 한다. 로컬 편집만으로 Google 배포가 자동 갱신되지는 않는다.

Playwright가 설치된 환경에서 `npm run test:independent`를 실행한다. 이번 작업은 Codex의 기존 번들 Playwright와 Windows Edge를 사용했으며 새 런타임 의존성을 추가하지 않았다.

원본 연결 ID를 다시 넣거나 원본 원격에 push하지 않는다. 별도의 GitHub 저장소나 정적 PWA 호스팅은 요청에 따라 추가할 수 있다.
