# 4.2.0 운영 적용 승인 검토

이 문서는 실행 승인 대상과 복구 방법을 설명한다. 작성 자체는 운영 변경이나 APK 공개를 실행하지 않는다. 실제 실행 전 최종 성공 CI, source hash, APK hash와 사용자 승인을 확인한다.

## 대상과 영향

1. NEW RENT STORE 소유자 GAS / 라이브러리: 기존 version 14를 보존하고 검증된 후보의 새 version을 만든다. 기존 owner-only 배포 ID와 URL을 유지하며 새 버전에 연결한다.
2. NEW RENT STORE Android API: 기존 배포 version 7과 library version 설정을 보관한다. 검증된 새 라이브러리를 참조하는 API version을 배포한다. 기존 endpoint·기기 인증·권한 범위를 유지한다.
3. 독립 GitHub 개발 코드를 운영 기본 브랜치에 반영하고, 성공 CI와 연결된 v4.2.0 private release에 검증된 APK를 제공한다. 기존 v4.1.2 태그·파일은 보존한다.
4. Google Drive에 4.2.0 APK를 새 파일로 올리고 앱 내부 업데이트 manifest / APK 다운로드 청크를 같은 versionCode·해시로 교체한다. 기존 4.1.2 APK는 삭제하거나 덮어쓰지 않는다.

운영 Sheets 초기화·입금 시험 기록·계약 변경·데이터 마이그레이션·복원·Calendar 시험 일정·Docs 시험 쓰기는 이 코드 배포 승인에 포함하지 않는다. 별도 운영 데이터 쓰기 승인이 필요하다. 최초 배포 검증은 읽기 전용 비교와 인증 실패 차단으로 제한한다.

APK와 GAS는 같은 릴리스 증거를 기준으로 단계적으로 적용한다. API 기능과 APK 업데이트 manifest가 일치하는지 확인하고, 후보 파일의 package / signer / versionCode / size / SHA-256과 다운로드 청크 수를 재검증한다. 외부 접근 권한이나 연결 계정을 자동 변경하지 않는다.

## 복구 방법

- GAS owner 배포는 기존 version 14, Android API는 기존 version 7 및 이전 library 설정으로 되돌린다. JSON·계약·원장·Calendar 매핑은 이전 자료로 덮어쓰지 않는다.
- APK 배포·다운로드를 중단하거나 이전 manifest를 복구할 수 있다. 설치된 code 8을 code 7로 자동 다운그레이드할 수 있다고 가정하지 않는다. 앱 문제가 있으면 같은 서명과 더 높은 versionCode의 수정 APK를 준비한다. 앱 삭제로 자료를 복구하는 방식은 사용하지 않는다.
- 기존 release tag, Drive APK, 서명 인증서, 배포 URL과 버전을 보관한다. 사용자 데이터 롤백은 이 배포 복구와 분리하며 별도 승인을 받는다.

## 승인 전 남겨둘 상태

- 공실 비용은 검토 후보이며 부담 정책 미확정이면 확정 차단한다.
- 운영 자료는 읽기만 대조하며 청구 근거 30개를 자동 보정하지 않는다.
- 실제 휴대전화 및 공개 다운로드→설치 검증은 완료로 표시하지 않는다.
- 후보 소스·검사·APK를 검토한 뒤 사용자 지시서 J-3에 따른 별도 승인을 받는다.
