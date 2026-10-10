# 독립앱 자동 회귀검사

`.github/workflows/regression.yml`의 Windows GitHub Actions 검사를 별도 비공개 저장소에 연결하고 실제 실행까지 통과했다. 앱의 런타임 의존성과 고지서 계산은 변경하지 않는다. 기존 원본 원격 `source-readonly`의 push 주소는 `DISABLED`로 유지한다.

## 실행 범위

독립 저장소의 push, pull request, 수동 실행에서 다음 검사를 수행한다.

1. Node 24, Python 3.12, Windows Edge, PowerShell 및 과거 계산 대조에 필요한 Git 이력을 확인한다. `fetch-depth: 0`을 사용한다.
2. Playwright 1.62.1을 `.private/ci-runtime`에 설치한다. 제품 `package.json`에 런타임 의존성을 추가하지 않는다.
3. `npm run test:all`로 빌드·생성 파일 일치·문법·단위 검사·14개 익명 브라우저 묶음을 실행한다. 운영 Google 프로필·인증 파일·자료를 사용하지 않는다.
4. pdfplumber 0.11.9로 실제 생성 PDF의 금액·본문·페이지 경계·중복/누락을 확인한다.
5. 검사 도중 생성된 `index.html`과 `server/Billing.gs`가 Git 소스와 달라지면 실패한다.
6. 익명 로그·검사 JSON·출력 PDF만 7일간 보관한다. `.private`, 자격증명, 운영 백업 및 과거 패키지를 업로드하지 않는다.

저장소 권한은 `contents: read`이며 저장된 Git 인증을 남기지 않는다. 모든 Action은 조회한 공식 릴리스의 40자리 커밋으로 고정했다. 근거는 [checkout](https://github.com/actions/checkout), [setup-node](https://github.com/actions/setup-node), [setup-python](https://github.com/actions/setup-python), [upload-artifact](https://github.com/actions/upload-artifact)이다. 배포·GAS 수정·예약 실행 단계는 없다.

## 실제 연결과 첫 성공

- [비공개 독립 저장소](https://github.com/ldjkorea/rental-app-independent-private), 기본 브랜치 `work/independent-v2`.
- [성공한 실행](https://github.com/ldjkorea/rental-app-independent-private/actions/runs/38015818749) — 소스 `3768dd12e239f7ec9a414c5b93366ee78d436de2`, 2026-10-10T02:07:51Z–2026-10-10T02:17:14Z.
- 단위 **192/192**, 브라우저 **14개 묶음 전체**, PWA **5/5**, PDF **5종·18페이지**, 생성 파일 일치 확인을 모두 통과했다. 원격 Node는 `v24.21.0`다. [실행 증거](../releases/ci-regression-2.2.0.json)를 보관한다.

전체 이력 검사에서 과거 문서의 실제 사업장명 네 개를 발견했다. 원본 로컬 Git 이력은 보존하고, 별도 사본에서 해당 값과 참조 커밋을 변환했다. 이력 71개 커밋·726개 파일 객체를 검사한 뒤 생성물·환경·단위 192개를 다시 통과했다. 제품 파일의 바이트는 로컬 GAS 후보와 같다. 기존 원본 저장소에는 push하지 않는다.

Git 연결 개발 폴더는 `../rental-app-independent-github`다. 기존 `rental-app-independent`에는 전체 원본 이력·비공개 운영 검토 자료·이전 ZIP을 유지한다. 현재 Git 연결 폴더에도 검증한 GAS 2.2.0 ZIP을 동일한 해시로 복사했다. ZIP은 Git에서 제외되므로 다른 기기의 새 clone에서는 해당 검증 ZIP을 별도로 복구해야 하며, manifest만 있는 상태에서 같은 버전의 ZIP을 다시 만들거나 덮어쓰지 않는다.

최초 실행은 PWA 창을 다시 여는 중 `load` 대기 시간 초과로 실패했다. 앱 범위 밖의 관찰 페이지에서 서비스 워커의 실제 활성화를 확인한 뒤 열고, 복원된 마지막 섹션의 준비 상태를 검사하도록 고쳤다. 캐시 정리·초안 유지·오프라인 조건과 시간 제한은 유지했다. 근거는 [등록 조회](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerContainer/getRegistration)와 [서비스 워커 생명주기](https://web.dev/articles/service-worker-lifecycle)다. 제품 코드·GAS ZIP을 바꾸지 않고 로컬 PWA 5개와 원격 전체 검사를 통과했다.

검증 결과·문서만 정리하는 마지막 커밋은 `[skip ci]`로 중복 실행을 생략한다. 제품·검사·workflow 소스는 성공한 실행과 같다. 이후 일반 코드 push에서는 자동 검사를 실행한다. 이 생략 동작은 [GitHub 공식 문서](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/skip-workflow-runs)를 따른다.

## 로컬 재실행

```powershell
npm install --prefix .private/ci-runtime --no-save --package-lock=false --ignore-scripts playwright@1.62.1
$env:NODE_PATH=(Resolve-Path -LiteralPath '.private/ci-runtime/node_modules').Path
npm run check:ci
npm run test:all
python tests/validate-print-pdf.py
git diff --exit-code -- index.html server/Billing.gs
```

PDF 검사에는 Python의 pdfplumber 0.11.9가 필요하다. 위 검사는 익명 로컬 자료를 사용하며 휴대폰·실물 인쇄·Google 실제 저장의 증거를 대신하지 않는다.
