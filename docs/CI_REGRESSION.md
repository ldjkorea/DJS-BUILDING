# 독립앱 자동 회귀검사

`.github/workflows/regression.yml`에 Windows GitHub Actions 검사를 준비했다. 앱의 런타임 의존성과 고지서 계산은 변경하지 않는다. 기존 원본 원격 `source-readonly`의 push 주소는 `DISABLED`로 유지한다.

## 실행 범위

독립 저장소에 연결하면 push, pull request, 수동 실행에서 다음 검사를 수행한다.

1. Node 24, Python 3.12, Windows Edge, PowerShell 및 과거 계산 대조에 필요한 Git 이력을 확인한다. `fetch-depth: 0`을 사용한다.
2. Playwright 1.62.1을 `.private/ci-runtime`에 설치한다. 제품 `package.json`에 런타임 의존성을 추가하지 않는다.
3. `npm run test:all`로 빌드·생성 파일 일치·문법·단위 검사·14개 익명 브라우저 묶음을 실행한다. 운영 Google 프로필·인증 파일·자료를 사용하지 않는다.
4. pdfplumber 0.11.9로 실제 생성 PDF의 금액·본문·페이지 경계·중복/누락을 확인한다.
5. 검사 도중 생성된 `index.html`과 `server/Billing.gs`가 Git 소스와 달라지면 실패한다.
6. 익명 로그·검사 JSON·출력 PDF만 7일간 보관한다. `.private`, 자격증명, 운영 백업 및 과거 패키지를 업로드하지 않는다.

저장소 권한은 `contents: read`이며 저장된 Git 인증을 남기지 않는다. 모든 Action은 조회한 공식 릴리스의 40자리 커밋으로 고정했다. 근거는 [checkout](https://github.com/actions/checkout), [setup-node](https://github.com/actions/setup-node), [setup-python](https://github.com/actions/setup-python), [upload-artifact](https://github.com/actions/upload-artifact)이다. 배포·GAS 수정·예약 실행 단계는 없다.

## 현재 상태와 연결 조건

로컬에서는 CI와 같은 버전의 Playwright를 별도 폴더에 설치해 검사한다. 실제 GitHub 실행 완료는 별도의 Actions 실행 URL과 결과로 확인해야 한다. 현재 작업본은 원본의 읽기 전용 원격만 연결돼 있어 이 YAML만으로 GitHub 검사가 실행되지는 않는다.

사용자가 요청한 후속 CI 연결 범위에서 별도 **비공개 독립 저장소 생성과 코드 push**를 진행한다. 전체 이력 검사에서 과거 문서의 실제 사업장명 네 개를 발견했다. 원본 로컬 Git 이력은 보존하고, 원격으로 보낼 별도 사본의 해당 값을 익명화한 뒤 참조 커밋을 새 이력에 맞춰 연결한다. 기존 원본 저장소에는 push하지 않으며 실제 운영 백업은 포함하지 않는다. 익명화와 커밋 참조 변환 뒤 동일한 계산·보관 패키지 검사를 다시 통과해야 연결한다.

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
