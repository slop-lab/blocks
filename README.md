# 문서 작업실

React와 ProseMirror를 사용하는 블록 편집기 및 선택 가능한 연결 모듈입니다. 기본 편집기는 저장소·도메인 서비스·협업 서버 없이 사용할 수 있습니다.

## 실행

```sh
corepack pnpm install
corepack pnpm build
corepack pnpm start
```

기본 주소는 `http://localhost:3000`입니다. `PORT=4174 corepack pnpm start`로 포트를 바꿀 수 있습니다. 개발할 때는 서버와 `corepack pnpm dev`를 함께 실행합니다.

개발 서버는 `/api`와 협업 WebSocket을 기본적으로 3000 포트에 전달합니다. 백엔드 포트를 바꾸었다면 `BACKEND_URL=http://127.0.0.1:4174 corepack pnpm dev`를 사용합니다.

## 사용 예제

- **로컬 노트**: 수동 저장, 입력 후 자동 저장, 주기적 자동 저장, 포커스 이탈 저장 중 선택합니다. 데이터는 localStorage에 저장됩니다.
- **작업 브리핑 / 읽기 전용 안내**: 외부 일감 상태와 문서의 캡션·배치를 분리합니다. 일감 상태 변경은 콘텐츠 수정이 아닙니다.
- **Markdown 파일**: 서버 파일을 읽고 편집합니다. `MARKDOWN_ROOT`로 폴더를 지정하며 기본 폴더는 `.runtime/markdown`입니다. 파일 해시를 기준으로 저장 충돌을 검사하고, 블록 ID와 1-based 원본 줄 범위는 서버 메모리에서 임시로 추적합니다. 파일에는 에디터 ID를 삽입하지 않습니다.
- **함께 쓰기**: 두 편집 창 또는 여러 브라우저에서 같은 방을 편집합니다. Yjs의 선택적 Undo가 로컬 편집을 관리하고 WebSocket이 변경 및 presence를 전달합니다.
- **표와 코드**: 셀 선택, 붙여넣기, 행·열 변경, 병합·분할과 독립 CodeMirror 입력 영역을 사용합니다. 공유 도구 모음은 활성 입력 영역에만 적용됩니다.
- **문서 보관함**: 문서 일부를 서버에서 가져와 가상화하여 표시합니다. 저장은 개별 블록의 revision을 확인하는 patch이며 아직 읽지 않은 부분을 교체하지 않습니다.
- **수정안 비교**: 원본과 분리된 후보를 비교하고 변경을 선택하여 수락합니다. 연결된 변경의 의존성과 원본 기준을 확인합니다. 스트림 제공자를 취소하거나 교체해도 이전 결과를 새 후보에 섞지 않습니다.

Markdown·협업·표·대용량 기능은 각각의 진입점을 가져오거나 해당 예제로 이동할 때 사용합니다. 기본 viewer에서 해당 런타임을 초기화할 필요는 없습니다.

## 라이브러리 진입점

| 모듈 | 역할 |
|---|---|
| `app/src/model.ts` | JSON codec, 복제, 예산 기반 조회, 출력, 변경 통지, 제안 및 호스트 연결 계약 |
| `app/src/Viewer.tsx` | 블록 배열을 받는 engine-free React viewer, 사용자 renderer와 overlay |
| `app/src/editing.ts` | 로컬 ModelSession과 구조 명령 |
| `app/src/features/markdown/` | Markdown 파일 연결 및 UI |
| `app/src/features/collaboration/` | Yjs 연결 및 다중 편집 surface |
| `app/src/features/composite/` | 선택적 table schema, 복합 입력 context와 migration |
| `app/src/features/large-content/` | 부분 로딩, 블록 캐시, 가상화 및 reveal/focus |

### 입력, 변경 통지, 저장

엔진 transaction과 IME 처리는 즉시 실행합니다. 내부 로컬 버전은 충돌과 위치 추적에 쓰이며 파일/서버의 저장 revision과 다릅니다. `ChangeDelivery`는 `immediate`, `debounce`(maxWait 포함), `throttle`, `manual` 정책으로 호스트 통지를 묶습니다. `flush()`는 최신 변경을 전달하고 `dispose()`는 남은 타이머를 취소합니다.

로컬 세션은 ProseMirror 상태를 단독 소유합니다. UI용 snapshot은 필요할 때 파생하며, 일반 입력 때마다 전체 JSON을 생성하거나 저장하지 않습니다. 협업 연결은 별도의 Yjs history를 사용하므로 일반 snapshot history를 중복 장착하지 않습니다.

### 데이터 경계

저장용 JSON은 미지원 구조를 보존합니다. 현재 엔진이 안전하게 해석할 수 없는 내용은 opaque로 유지합니다. Markdown/HTML 출력은 JSON 저장과 구별하며 손실 정보를 반환합니다. Markdown 파일 연결은 원래 source를 보존하고 변경한 범위만 반영합니다.

외부 콘텐츠 교체는 model/epoch/baseVersion을 검사하고 조합 중에는 유예합니다. 자동 재조정이 불가능하면 draft를 보존하고 충돌을 알립니다. 외부 액션, 렌더링, 본문 저장은 서로 다른 경로입니다.

`SuggestionProvider`를 연결해 외부 AI나 호스트 제안 스트림을 사용할 수 있습니다. 예제 기본 제공자는 입력 문장을 순차적으로 추가하는 로컬 제공자이며 외부 AI 서비스를 호출하지 않습니다.

`createHttpSuggestionProvider({ endpoint, headers })`는 호스트의 NDJSON 스트림에 실제 HTTP 요청을 보냅니다. 각 응답 줄은 `BlockDocument` snapshot이며 크기·형식 검증 후 후보로 전달됩니다. 취소 신호는 HTTP 요청과 reader에 전파됩니다. API 자격 증명을 저장소에 넣지 말고 호스트가 설정해야 합니다.

## 서버와 저장 위치

- `GET /api/markdown`, `GET/PUT /api/markdown/file`: 파일 목록, 읽기, 조건부 저장.
- `/collaboration`: schema handshake와 Yjs 동기화 WebSocket.
- `/api/large-content`: 페이지 읽기, 블록 조회·수정, 검색 및 전체 내보내기.
- `.runtime/`은 실행 데이터이며 Git에서 제외합니다.

Markdown은 실제 파일에 저장되고 로컬 노트·표와 코드는 브라우저에 저장됩니다. 협업 방과 보관함 예제는 서버 메모리 저장소를 사용합니다. 협업 클라이언트는 연결이 끊겨도 현재 replica를 유지하며 재연결 시 합칩니다. 서버 재시작 후 모든 클라이언트까지 닫힌 상황의 영속 보관은 호스트 저장소를 연결해야 합니다.

예제 서버는 단일 사용자 개발 환경을 위한 것입니다. 공개 서비스에서는 호스트가 인증·방 권한·파일 접근 정책을 추가해야 합니다. 표시용 사용자 이름이나 에디터의 입력 제한은 권한 증명이 아닙니다. 외부 AI 자격 증명, 업무 승인, 서비스 간 원자성은 호스트가 소유합니다.

## 검사 실행

```sh
corepack pnpm test
corepack pnpm typecheck
corepack pnpm build
corepack pnpm exec playwright install chromium
QA_BASE_URL=http://localhost:3000 corepack pnpm test:browser
```

기존 Chromium은 `CHROME_PATH`로 지정할 수 있습니다. 테스트 출력·브라우저 캡처·개발 진행 보고서는 저장소 산출물로 관리하지 않습니다.
