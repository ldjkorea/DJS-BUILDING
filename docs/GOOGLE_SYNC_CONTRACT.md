# Google 동기화 서버 계약

## 읽기

GET 성공 응답은 저장된 기존 JSON, 현재 원문의 SHA-256 revision, 지원 기능을 반환한다.

```json
{
  "status": "ok",
  "data": {"tenants": [], "bills": {}},
  "revision": "sha256-...",
  "protocol": "rental-sync-v2",
  "capabilities": {"conditionalWrite": true, "currentStatus": true, "contractCalendar": true}
}
```

클라이언트는 `conditionalWrite`와 revision이 없으면 불러오기만 허용하고 업로드를 차단한다.

## 조건부 저장

```json
{
  "protocol": "rental-sync-v2",
  "action": "save",
  "expectedRevision": "sha256-...",
  "requestId": "고유 요청 ID",
  "data": {"tenants": [], "bills": {}}
}
```

서버는 스크립트 잠금 안에서 revision을 비교하고, 전체 이전 원문을 `_RentalSyncRecovery`에 분할 백업해 재확인한 뒤 저장한다. 저장 결과도 다시 읽어 확인한다. 같은 request ID와 같은 내용의 재시도는 중복 쓰기 없이 성공하고, 오래된 revision은 `conflict`, 구형 무조건 쓰기는 `unsupported`로 거절한다.

DB 성공과 Google Docs 결과는 분리한다.

```json
{
  "status": "ok",
  "revision": "sha256-...",
  "requestId": "동일한 요청 ID",
  "capabilities": {"conditionalWrite": true, "currentStatus": true},
  "docs": {"status": "ok", "documentId": "...", "updatedAt": "..."}
}
```

문서 갱신 실패도 최상위 `status`는 `ok`이며, `docs.status`만 `error`가 된다. 클라이언트는 DB 저장 완료를 유지하고 문서 경고와 수동 재생성 동작을 제공한다.

## 현재현황 수동 재생성

```json
{
  "protocol": "rental-sync-v2",
  "action": "regenerateCurrentStatus",
  "expectedRevision": "sha256-...",
  "requestId": "고유 요청 ID"
}
```

이 요청에는 `data`를 보내지 않는다. 서버는 revision이 일치할 때 현재 저장 DB로만 문서를 갱신하며 DB 원문은 변경하지 않는다.

## 계약 Calendar 수동 동기화

```json
{
  "protocol": "rental-sync-v2",
  "action": "syncContractCalendar",
  "expectedRevision": "sha256-...",
  "requestId": "고유 요청 ID"
}
```

이 요청에도 `data`를 보내지 않는다. 서버는 revision이 일치하는 저장 DB의 현재 계약 종료일만 사용해 Google Calendar 일정을 생성하거나 기존 event를 갱신한다. Calendar event ID는 Script Properties에 보관하며 DB 원문은 변경하지 않는다. Calendar 실패 시 최상위 저장 계약은 `ok`, `calendar.status`만 `error`로 반환한다. 일정 자동 삭제와 Calendar에서 DB로 가져오는 역방향 동기화는 수행하지 않는다.

## 독립앱 2.0의 추가 안전 계약

임대 JSON schemaVersion 1과 rental-sync-v2를 유지한다. GET/저장 응답의 appVersion은 2.0.0이며 화면과 서버가 다르면 안내하고 자동 새로고침하지 않는다. JSON 중첩 null을 보존하기 위해 owner-only GAS의 independentRequest는 JSON 문자열로 반환한다.

서버는 저장 전 음수·소수·범위 초과 금액을 거부한다. verified recovery를 기록한 뒤 INDEPENDENT_SYNC_WRITE_JOURNAL에 이전 해시, 새 해시와 복구 배치를 남긴다. 활성 원문의 SHA-256이 이전 값 또는 새 값과 일치하지 않으면 파싱 가능한 JSON도 읽기/쓰기를 차단한다. 검증된 쓰기 후 journal을 제거한다. Sheets 전체 트랜잭션이나 자동 복원은 제공하지 않는다.

```json
{
  "protocol": "rental-sync-v2",
  "action": "inspectRecovery",
  "expectedRevision": "sha256-...",
  "requestId": "고유 요청 ID"
}
```

inspectRecovery는 data를 받지 않으며 최신 복구 배치의 순서·총 청크 수·해시·JSON/도메인을 읽어 확인한다. 성공 시 최상위 requestId와 recovery의 revision, batch, at, chunks, tenants, billMonths를 반환한다. 활성 자료가 손상돼도 점검할 수 있으나 원문을 응답에 노출하거나 활성 시트를 복원하지 않는다. 이 점검은 시트·문서·Calendar를 쓰지 않는다.

클라이언트는 POST 전에 후보 전체와 requestId/expectedRevision을 기기에 기록한다. 통신 응답이 유실되면 동일 후보는 동일 ID로 재시도한다. revision 충돌 또는 기준 없는 다른 데이터는 묵시적으로 덮어쓰지 않으며 백업과 차이 비교로 해결한다. 로컬 고지서/정산 초안은 별도 백업 메타데이터이고 임대 DB에 올리지 않는다.

Calendar의 독립 ID와 기존 event 매핑을 유지한다. 생성할 때 [RENTAL_INDEPENDENT_CONTRACT:<tenantId>] 마커를 설명에 함께 기록하고 매핑 응답 유실 시 동일 이벤트를 재식별한다. 다른 임차인의 마커가 붙은 이벤트로 잘못 연결되면 수정 전에 중단한다. 불명확한 과거 매핑과 중복은 수동 확인 대상이다.
