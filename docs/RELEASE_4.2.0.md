# NEW RENT STORE 4.2.0 운영 코드 배포

2026-10-12 사용자가 GAS/API 배포와 GitHub·Drive APK 및 앱 내부 업데이트 제공을 명시적으로 승인했다. 운영 데이터 쓰기는 제외했다.

- Android 4.2.0 / code 8, 웹 2.4.0. 동일 패키지·서명·Pretendard·아이콘·암호화 저장소 유지.
- 소유자 GAS / library 15, Android API 8. 이전 owner 14 / API 7과 URL·접근·OAuth 범위 보존.
- 운영 시트 전후 원문 95,582 bytes 및 SHA-256 일치. 실제 Sheet·입금·계약·Calendar·Docs 쓰기·복원·마이그레이션 미실행.
- 실제 배포 GET으로 9청크 전체 재조합 및 로컬·Drive APK 바이트 일치 확인. 이전 버전 청크 요청 차단. 첫 배포 직후 오류 응답 후 후속 전체 다운로드는 41.871초에 통과. 모든 네트워크의 시간이나 실제 휴대전화 설치 성공을 의미하지 않는다.
- [Drive APK](https://drive.google.com/file/d/1FrDTkQiLCW8faCzBGZnlJtYUkIpNqhhh/view?usp=drivesdk). 비공유 상태 유지, 기존 4.1.2 파일 보존. GitHub release는 이 배포 기록 커밋의 CI 통과 후 공개한다.
- 사전 검증: Node 247, 브라우저 15 suites / audit 69, PDF 5개·18페이지, GAS ZIP mocks 45+37 / browsers 59. Android release/lint/unit 성공, lint 오류 0·기존 경고 7. 계측 22 성공·3 조건부 제외·실패 0. 별도 code7→8 암호화 자료 보존 probe 2회 성공.
- 실제 휴대전화·공개 다운로드→Android 설치 UI는 별도 확인. 운영 쓰기 검증도 별도 승인.
- 공실·월중 퇴거 비용 정책 미확정이면 정산 확정 차단. 과거 추정 청구 근거 30개 자동 수정 없음.

[수정 설명](BUILDING_STABILITY_4.2.0.md) · [검증 JSON](../releases/native-4.2.0-validation.json) · [APK manifest](../releases/android-4.2.0.json) · [실제 휴대전화 점검](PHYSICAL_DEVICE_STABILITY_CHECK.md)

복구: owner 14 / API 7로 코드 배포를 되돌린다. 운영 자료를 이전 백업으로 덮어쓰지 않는다. 설치된 APK는 자동 다운그레이드하지 않고 동일 서명의 높은 versionCode 수정본으로 대응한다.
