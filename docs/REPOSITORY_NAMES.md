# RENT STORE 프로젝트 이름과 GitHub 주소

2026-10-10 사용자가 지정한 세 프로젝트 이름으로 GitHub 저장소를 변경했다. 공백 대신 하이픈을 사용하며 앱을 구분하는 공식 명칭은 아래 표를 따른다.

| 프로젝트 명칭 | 변경 전 저장소 | 현재 저장소 | 공개 상태 |
|---|---|---|---|
| NEW RENT STORE | `rental-app-independent-private` | [ldjkorea/NEW-RENT-STORE](https://github.com/ldjkorea/NEW-RENT-STORE) | 비공개 |
| RENT STORE | `rental-app-v1.4.0-private` | [ldjkorea/RENT-STORE](https://github.com/ldjkorea/RENT-STORE) | 공개 |
| 2025 RENT STORE | `-past-rental-app` | [ldjkorea/2025-RENT-STORE](https://github.com/ldjkorea/2025-RENT-STORE) | 공개·보관 |

`rental-app-v1.4.0-private`는 이름에 private가 있었지만 변경 전 실제 GitHub 설정은 공개였다. 공개/비공개 설정은 변경하지 않았다. 오래된 저장소는 이름 변경을 위해 잠시 보관을 해제한 뒤 다시 보관했다.

## 연결 주소

- 최신 개발 저장소: `https://github.com/ldjkorea/NEW-RENT-STORE.git`.
- 기존 1.4 웹앱: [RENT STORE](https://ldjkorea.github.io/RENT-STORE/).
- 오래된 웹앱: [2025 RENT STORE](https://ldjkorea.github.io/2025-RENT-STORE/).
- 최신 독립앱의 기존 Google Apps Script 운영 주소와 실제 Google 파일은 이름 변경으로 수정하지 않았다. 최신 Git 저장소와 실제 운영 GAS 버전의 구분은 [후속 마무리 상태](FOLLOWUP_FINISH.md)를 따른다.

GitHub 저장소의 이전 주소는 현재 저장소로 연결되는 것을 API에서 확인했다. GitHub Pages의 이전 경로는 자동 리디렉션을 보장하지 않으므로 위의 새 웹 주소를 사용한다. 근거는 [GitHub 저장소 이름 변경 안내](https://docs.github.com/en/repositories/creating-and-managing-repositories/renaming-a-repository)다.

## 로컬 작업과 검증

- Git 연결 폴더 `../rental-app-independent-github`의 `independent` fetch/push 주소를 `NEW-RENT-STORE.git`로 변경했다.
- 전체 원본 이력을 보존한 `../rental-app-independent`의 `source-readonly` fetch 주소를 `RENT-STORE.git`로 변경했다. push 주소는 계속 `DISABLED`다.
- 폴더명·브랜치·제품 파일·Google 연결·브라우저 저장 키는 기존 값을 유지한다. 이름 변경 때문에 앱 데이터를 옮기거나 Google 제품 배포를 실행하지 않는다.
- 저장소 ID 세 개와 이름 변경 전후 기본 브랜치의 커밋이 동일함을 확인했다.
- 두 Pages의 `index.html`, `manifest.json`, `sw.js`, `icon.svg`가 모두 HTTP 200이고, 변경 전 소스 커밋의 해당 파일과 SHA-256이 같음을 확인했다.
- [기존 성공한 자동 검사](https://github.com/ldjkorea/NEW-RENT-STORE/actions/runs/38015818749)가 새 저장소에서 그대로 성공 상태로 조회되며 `regression.yml` workflow는 active다. 이름 변경으로 전체 제품 검사를 새로 수행했다는 의미는 아니다.
- 이번 Git 변경은 이름 안내·현재 링크를 정리하는 문서에 한정한다. `[skip ci]` 커밋으로 중복 검사를 생략하고 제품·검사·workflow 파일의 변경이 없는지 Git diff로 확인한다.

과거 릴리스 증거·기록의 저장소 이름과 URL은 당시 값을 보존한다. 새 개발 작업에서는 위의 현재 이름과 주소를 사용한다.

## Pages 갱신 완료 기록

`RENT STORE`의 Pages 상태는 `built`이며 빌드 커밋은 이름 변경 전과 같은 `2b01a2ead927221a27322bba5290754b5db18969`다.

오래된 저장소를 보관 상태로 복원하는 시점에 최초 자동 Pages 배포가 보관 제한으로 중단되었다. 제품 소스를 변경하지 않고 GitHub 공식 Pages 빌드 API로 새 실행을 요청했다. [새 주소의 Pages 빌드·배포](https://github.com/ldjkorea/2025-RENT-STORE/actions/runs/38022724704)가 성공했고, 빌드 커밋은 기존 `dd6800f418f45482453fa2bc7fe42ac16e60a53d`와 같다. 최종 HTML의 HTTP 200과 SHA-256 일치, Pages 상태 `built`를 확인한 뒤 `2025 RENT STORE`를 다시 보관 상태로 복원했다.
