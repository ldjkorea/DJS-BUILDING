# Android와 업데이트 전략

현재 운영은 **웹 2.3.0 / GAS 버전 8**, Android 설치본은 **네이티브 3.0.0 / versionCode 3**다. [현재 설치·업데이트·연결 안내](ANDROID_NATIVE_3.0.0.md)를 따른다. 아래 2.x 실행기 구조는 과거 기록이며 현재 Android 화면은 Kotlin 네이티브 Views로 대체했다. 웹 버전 확인·적용 버튼과 비공개 GitHub 최신 APK 다운로드는 유지한다.

## 선택한 구조

Android 앱은 Kotlin/AndroidX Custom Tabs를 사용하는 경량 실행기다. 고유 패키지는 **kr.henry.rental.independent**, 앱 이름은 **임대관리 독립앱**, 버전은 **2.0.0 / versionCode 1**, 최소 지원은 Android 6(API 23), target/compile SDK는 37이다. 아이콘은 밝은 배경의 파란 건물 벡터다.

GAS HTML Service의 google.script.run을 그대로 실행하는 브라우저를 사용한다. APK는 Google 비밀번호·쿠키·임대 JSON·연동 비밀키를 보관하지 않는다. 브라우저의 기존 소유자 Google 로그인 상태를 존중한다. 일반 WebView에서 Google OAuth를 강제하지 않는다. 외부 Intent의 URL로 목적지를 바꾸지 않고 현재 독립 GAS 주소를 코드에 고정했다.

권한은 네트워크 상태 확인만 사용한다. 실제 네트워크와 로그인은 브라우저가 담당하므로 실행기 자체에는 Internet·저장소·계정 읽기·설치 권한을 추가하지 않았다. 브라우저가 없거나 오프라인이면 안내한다. Custom Tabs가 없을 때 기본 HTTPS 브라우저로 열 수 있다. 앱 내부에는 자동 설치기나 브라우저 인증 우회가 없다.

공식 근거: [Android Custom Tabs 개요](https://developer.android.com/develop/ui/views/layout/webapps/overview-of-android-custom-tabs), [Chrome Custom Tabs 시작 가이드](https://developer.chrome.com/docs/android/custom-tabs/guide-get-started), [AndroidX Browser 릴리스](https://developer.android.com/jetpack/androidx/releases/browser).

## A. 웹 화면 업데이트

승인 후 기존 독립 GAS 배포 ID에 새 코드 버전을 연결하면 같은 URL과 같은 APK에서 새 웹 화면을 연다. APK 재설치가 필수인 구조가 아니다. 소스 편집과 로컬 빌드만으로 운영 화면이 자동 갱신되는 것은 아니다.

서버 appVersion과 열린 화면 APPLICATION_VERSION을 비교하여 차이가 있으면 안내한다. 자동 새로고침은 하지 않는다. 고지서·정산 초안은 기기에 보관하고 기준 자료가 달라지면 자동 적용하지 않는다. 사용자는 저장/백업 후 다시 열어 새 화면을 적용한다. 장시간 열어둔 페이지가 새 코드로 즉시 바뀐다고 보장하지 않는다.

정적 호스팅의 PWA는 새 worker를 waiting 상태로 유지한다. 열린 모든 창을 닫은 후 다음 실행에서 새 worker가 활성화된다. 캐시 정리는 독립앱의 현재 scope 접두사에만 한정한다. GAS iframe에서는 정적 PWA의 서비스 워커가 등록되지 않으며 온라인 접근이 필요하다.

## B. APK 자체 업데이트

현재 배포 채널은 **비공개 로컬 파일 전달 + 사용자 직접 설치**다. Play 계정 생성, Play 업로드, 원격 APK 호스팅은 수행하지 않았다. releases/rental-independent-2.0.0.apk를 휴대전화에 옮겨 설치한다. Android의 설치 확인을 사용자가 진행한다.

업데이트 시 패키지 이름과 서명키를 유지하고 versionCode를 증가시킨다. 다른 서명의 APK로 기존 설치를 교체할 수 없다. 서명키를 잃으면 정상적인 동일 앱 업데이트를 보장할 수 없으므로 비공개 백업이 필요하다. 개인 release 키와 비밀번호는 .private/에 보관하며 Git에서 제외한다. 공개 인증서 지문과 APK SHA-256만 릴리스 기록에 남긴다.

다음 배포 채널을 승인할 때 아래 선택 중 하나를 구체화한다.

| 채널 | 버전 확인 / 다운로드 / 승인 | 비용·제약 |
|---|---|---|
| 현재 수동 전달 | RELEASE_CANDIDATE_V2.md와 SHA256SUMS.txt 대조 → 동일 서명 APK 전달 → 사용자 설치 확인 | 고정 플랫폼 비용 없음; 신규 버전 전달은 운영자가 수행 |
| Play 내부 테스트 | 승인된 계정·테스터 관리 → Play 버전 확인/업데이트 | 등록·검수 정책과 계정 비용 확인 필요; 현재 미등록 |
| 자체 HTTPS 채널 | 사용자 소유 도메인에 private 배포 manifest·APK 게시 → 버전 비교·승인 호스트·SHA256·패키지/서명 검증 → 사용자 설치 | 도메인/호스팅·운영 책임; 인증과 접근 제한 설계 필요 |

release-manifest.json은 배포를 검토할 수 있는 로컬 manifest다. 다운로드 URL은 아직 지정하지 않았다. 사용자가 승인한 실제 채널이 없으므로 앱에서 자동 신규 버전 조회/다운로드가 작동한다고 주장하지 않는다. 직접 설치 APK의 무인 자동 업데이트는 제공하지 않는다. 현재 앱의 설치·업데이트 안내 버튼은 이 범위를 설명한다.

## C. 데이터 스키마 업데이트

이번 버전은 임대 데이터 schemaVersion 1을 유지한다. UI 복귀 상태, 초안, 저장 요청 기록은 독립 로컬 메타데이터다. 서버 쓰기 journal과 Calendar event marker는 GAS Properties/일정 설명에만 추가한다. 운영 반영 전에는 기존 시트와 Script Properties를 비공개로 백업해야 한다.

부분입금 원장 등 데이터 구조를 바꾸는 개발에는 별도 schemaVersion, snapshot/완납 자료 변환 규칙, 사전 백업, 전체 도메인 대조, 실패 시 롤백 설계가 필요하다. 앱 UI나 APK 업데이트만으로 이를 실행하지 않는다.

## 빌드와 서명

android/는 Gradle Wrapper 및 AGP 기반 프로젝트다. 기존 로컬 JDK 21, SDK 37/Build Tools 36을 사용했다. 새 웹 프레임워크나 유료 API를 추가하지 않았다. 재빌드에는 환경 변수 JAVA_HOME/ANDROID_HOME과 android/local.properties의 실제 SDK 경로가 필요하다.

```powershell
cd android
.\gradlew.bat :app:assembleRelease :app:lintRelease :app:testDebugUnitTest
```

release 서명은 ../.private/android-signing.properties에서 읽는다. storeFile, keyAlias, storePassword, keyPassword를 비공개로 설정하며 서명키/비밀번호를 출력하거나 커밋하지 않는다. 새 컴퓨터에서는 키를 새로 만들지 말고 기존 키를 안전하게 복원한다. SDK 설치 위치는 환경에 맞게 변경한다.

apksigner verify와 SHA-256으로 실제 APK를 검증한다. 최종 APK 해시와 인증서 지문은 RELEASE_CANDIDATE_V2.md 및 releases/의 manifest가 권위다. Gradle lint 경고와 실제 실행 검사 범위도 함께 기록한다.

## 기기 검증의 한계

기존 다른 프로젝트의 에뮬레이터는 오프라인이어서 브라우저 실행 검사가 실패했다. 그 기기의 네트워크 설정을 변경하지 않고 rental-independent-v2 전용 API 35 에뮬레이터를 만들었다. 이 기기에서 Custom Tabs 실행, 화면 회전, 뒤로가기, launcher 재생성, 기본 브라우저 진입, 안내 버튼의 instrumentation 검사 한 건이 통과했다.

이는 Google 소유자 계정 로그인이나 임대 저장의 실제 Android 종단 검증을 의미하지 않는다. 계정 비밀번호나 OTP는 입력하지 않았다. 소유자 인증은 데스크톱의 기존 운영 1.0 웹앱에서 확인되어 있으며, 2.0은 아직 미배포다. 실제 휴대전화 로그인·저장·외부 문서 링크 및 APK의 새 versionCode 업데이트는 승인된 운영 배포 후 확인할 항목이다.

## PWA/TWA 후속

script.google.com은 사용자가 소유한 도메인이 아니므로 Digital Asset Links를 설정하거나 TWA 검증이 된 것처럼 사용할 수 없다. 후속 전환에는 사용자 소유 HTTPS 도메인, 실제 PWA 설치/worker, DAL 검증, 브라우저 인증/권한 모델, google.script.run 대체 API가 필요하다. 현재 사용자 계정 전용 도구에는 Custom Tabs의 유지비와 인증 안정성이 더 적절하다.
