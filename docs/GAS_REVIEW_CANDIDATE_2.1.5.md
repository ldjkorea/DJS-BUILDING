# GAS 2.1.5 검토 후보

고지서·분기 인쇄 보완을 포함한 웹 2.1.5를 GAS 검토 ZIP으로 준비했다. 제품 소스는 `4253948`, 후보 생성·검증 도구 소스는 `f426190`이다. 로컬 검토 후보이며 운영 배포와 실제 Google 저장을 수행하지 않았다.

- [GAS ZIP](../releases/rental-independent-gas-2.1.5.zip) — 1,704,320 bytes.
- SHA-256: `7feba52249ecde95ff9d657d8a6b54d6fe331ea01dff3c3528037aa65a3a0c49`.
- [파일별 해시와 생성 출처](../releases/gas-candidate-2.1.5.json).
- [압축본 검사 결과](../releases/validation-gas-candidate-2.1.5.json).

포함 파일은 `App.html`, `AuthorizeDocs.gs`, `Billing.gs`, `CalendarSync.gs`, `Code.gs`, `CurrentStatus.gs`, `IndependentApp.gs`, `appsscript.json`의 8개다. 파일별 바이트와 GAS 소스를 제품 검증 기록·커밋과 대조한 뒤 실행한다. 실제 임대 JSON·OAuth 설정·서명키와 `.private` 파일은 담지 않는다. 실제 저장된 임차인 필드 값이 압축 파일에 들어 있지 않은 것도 확인했다. ZIP은 로컬 산출물로 Git에서 제외하며 manifest·검증 도구·결과는 로컬 Git에 기록한다.

## ZIP에서 읽은 코드를 실행한 결과

2026-10-10T00:14:05.729Z–00:15:41.852Z(한국 시간 09:14–09:15)에 ZIP의 GAS 코드와 App.html을 별도 VM/Edge에서 검사했다. Google 서비스는 모의 객체이고 화면의 외부 요청을 차단했다.

| 검사 | 결과 |
|---|---:|
| 패키징·변조/덮어쓰기 차단 단위 검사 | 8 / 8 |
| 압축본 서버 모의 검사 | 42 / 42 |
| 입금 기록 화면 | 11 / 11 |
| 원장 개시 전 기준 대조 | 8 / 8 |
| 원장 전 청구 기준 정정 | 11 / 11 |
| 분기 집계·출력 | 8 / 8 |
| 백업 전체 복원·CSV·미작성 경계 | 6 / 6 |
| 실제 PDF 생성과 인쇄 상태 복구 | 5 / 5 |

화면 검사 총 49개를 통과했다. ZIP의 HTML로 생성한 PDF 5종·18페이지에서 금액·잔액·모든 입금 메모·정정 사유·36개 호실과 108건 표시, A4 방향·빈 페이지·페이지 밖 글자를 확인했다. Poppler로 모든 페이지를 렌더링해 앞서 직접 검토한 [제품 인쇄 출력](PRINT_OUTPUT.md)의 18개 이미지와 모두 같은 해시임을 확인했다. 압축본에서도 조작 버튼·포커스 이동 링크가 종이에 남지 않고 PDF 생성 후 화면 조작과 원문 저장 상태가 유지된다.

두 번째 패키징은 기존 ZIP·manifest를 검증해 재사용했다. 이전 2.1.4·2.1.3·2.0.6 후보는 같은 해시로 보존했다. 제품의 전체 단위 178개·브라우저 묶음 13개는 [앞선 제품 검증](../releases/development-2.1.5.json)의 결과다. 이번에는 동일 제품 파일의 해시를 확인하고 압축본을 검사했으며 전체 제품 회귀를 반복하지 않았다.

```powershell
npm run check:build
npm run package:gas
npm run test:gas-candidate
python tests/validate-print-pdf.py
```

## 실제 Google 확인으로 이어가기

이 ZIP은 현재 독립앱의 Google 대상 ID와 브라우저 저장 접두사를 유지한다. 새로운 검증앱에 그대로 업로드하면 기존 독립앱의 대상과 연결되므로, 별도 환경에는 시트·문서·Calendar·웹 주소·브라우저 저장 접두사를 새 것으로 바인딩해야 한다. [분리된 Google 검증앱 계획](GOOGLE_STAGING_REVIEW.md)에 변경 범위와 확인할 동작을 기록했다. 계획은 아직 실행하지 않았고 실제 Google 파일을 생성하지 않았다.

실제 iframe·소유자 권한·저장/재조회·Docs/Calendar와 휴대전화·프린터 확인은 로컬 검사로 완료 판정하지 않는다. PWA 정적 파일도 이 GAS ZIP에 포함하지 않는다. 운영 반영·원장 지원 없는 서버로의 롤백 경계는 [이관 기준](GAS_REVIEW_CANDIDATE_2.1.3.md#이관과-롤백-경계)을 유지한다. 과거 추정 기준의 원문 확인과 이미 시작한 원장 기준 변경 정책도 남아 있다. `productionReady`는 false이며, 이번 후보 작성에서 Google API 호출·실제 쓰기·업로드·배포·원격 push·Android 변경을 하지 않았다.
