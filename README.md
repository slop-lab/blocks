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

## Git 문서 라이브러리 CLI

`block-docs`는 기존 non-bare Git 저장소의 주 작업 트리를 건드리지 않고, `.runtime/git-documents` 아래에 브랜치별 관리 작업 트리를 만들거나 재사용합니다. 브라우저는 같은 origin의 고정된 문서 API만 호출하며 Git 명령이나 인자를 전달하는 endpoint는 없습니다.

```sh
corepack pnpm build
corepack pnpm docs:start -- --repo /absolute/path/to/repository --docs docs --port 3000
```

기본 브랜치는 `block-docs`, 기본 listen 주소는 `127.0.0.1`입니다. 임시 포트는 `--port 0`, 별도 runtime 위치는 `--data /absolute/runtime/path`, 기존 관리 브랜치는 `--branch notes/topic`으로 선택합니다. container나 신뢰한 LAN에서만 `--host 0.0.0.0`을 명시하세요. 시작하면 출력된 `http://127.0.0.1:<port>/?workspace=git-documents`를 엽니다.

새 전용 저장소가 필요하면 다음 고정 명령을 사용합니다. 디렉터리는 비어 있어야 하며 CLI는 `docs/welcome.md`, `.gitignore`, 초기 커밋만 만듭니다. 기존 repository/global Git config를 수정하지 않습니다.

```sh
node packages/block-docs/dist/cli.js init \
  --repo /absolute/path/to/new-library \
  --author-name "Your Name" \
  --author-email "you@example.com"

node packages/block-docs/dist/cli.js --help
```

Git identity는 명시한 author, CLI 환경, 저장소/사용자 설정 순으로 Git이 해석합니다. identity가 없으면 commit/init이 설명과 함께 실패합니다. CLI는 credential을 저장하지 않고 `origin`만 사용하며 terminal prompt를 끕니다. remote 인증은 사용자의 기존 Git credential helper 또는 SSH agent가 담당합니다.

문서 라이브러리에서 지원하는 흐름:

- source-preserving WYSIWYG와 Markdown 원문 편집, 500ms 복구 초안 자동 저장, CAS 기반 작업 트리 저장
- 폴더 경로를 포함한 Markdown 생성·이동·삭제, 전체 검색과 상대 문서명 기반 백링크 후보
- HEAD/작업본 비교, 문서 경로 선택 커밋, 문서별 기록 열람과 작업본 복원
- branch 생성·목록·전환. 각 branch는 별도 관리 작업 트리와 별도 draft scope를 사용
- 수동 `origin` fetch, clean worktree의 fast-forward-only 반영, 현재 branch push
- divergence 표시, 명시적 `--no-commit` merge 준비, 문서 conflict 원문 편집·resolve·merge commit 또는 abort

안전 경계와 의도적인 제한:

- 문서는 구성한 repository-relative root 아래 `.md`만 허용합니다. 절대 경로, `..`, 역슬래시, option처럼 `-`로 시작하는 이름, `.git`, symlink를 거부합니다.
- commit은 선택한 문서 root 경로만 stage합니다. 기존 staged change가 있거나 merge가 문서 root 밖 파일을 포함하면 거부합니다.
- worktree를 자동 삭제하지 않습니다. 종료·재시작은 같은 등록 worktree와 branch별 draft를 재사용하므로 미커밋 변경을 잃지 않습니다.
- reset, rebase, stash, force push, 임의 remote URL, 임의 shell/Git argv를 제공하지 않습니다. primary branch가 이미 다른 worktree에 checkout되어 있으면 그 branch를 관리 worktree로 중복 열지 않습니다.
- Git hook은 subprocess별 `core.hooksPath=/dev/null`로 비활성화합니다. 이 도구는 신뢰한 개인 저장소의 문서 파일을 관리하며 repository의 application code나 package hook을 실행하지 않습니다.
- 요청 본문은 6 MiB, Markdown 파일/초안은 5 MiB, search 결과는 100개, history는 최대 100개로 제한합니다. attachment upload는 현재 제공하지 않습니다.
- mutation 요청은 browser Origin이 Host와 다르면 거부합니다. 기본 localhost는 개인용입니다. `0.0.0.0` 공개 시 reverse proxy 인증과 HTTPS는 host 운영자가 추가해야 합니다.

## 사용 예제

- **로컬 노트**: 수동 저장, 입력 후 자동 저장, 주기적 자동 저장, 포커스 이탈 저장 중 선택합니다. 데이터는 localStorage에 저장됩니다.
- **작업 브리핑 / 읽기 전용 안내**: 외부 일감 상태와 문서의 캡션·배치를 분리합니다. 일감 상태 변경은 콘텐츠 수정이 아닙니다.
- **Markdown 파일**: 서버 파일을 읽고 편집합니다. `MARKDOWN_ROOT`로 폴더를 지정하며 기본 폴더는 `.runtime/markdown`입니다. 파일 해시를 기준으로 저장 충돌을 검사하고, 블록 ID와 1-based 원본 줄 범위는 서버 메모리에서 임시로 추적합니다. 파일에는 에디터 ID를 삽입하지 않습니다.
- **함께 쓰기**: 두 편집 창 또는 여러 브라우저에서 같은 방을 편집합니다. Yjs의 선택적 Undo가 로컬 편집을 관리하고 WebSocket이 변경 및 presence를 전달합니다.
- **표와 코드**: 셀 선택, 붙여넣기, 행·열 변경, 병합·분할과 독립 CodeMirror 입력 영역을 사용합니다. 공유 도구 모음은 활성 입력 영역에만 적용됩니다.
- **문서 보관함**: 문서 일부를 서버에서 가져와 가상화하여 표시합니다. 저장은 개별 블록의 revision을 확인하는 durable patch이며 아직 읽지 않은 부분을 교체하지 않습니다.
- **수정안 비교**: 원본과 분리된 후보를 비교하고 변경을 선택하여 수락합니다. 연결된 변경의 의존성과 원본 기준을 확인합니다. 스트림 제공자를 취소하거나 교체해도 이전 결과를 새 후보에 섞지 않습니다.
- **문서와 데이터베이스**: `?workspace=structured-workspace`에서 JSON 문서, 중첩 페이지, typed database, 공유 블록을 편집합니다. 페이지 본문·데이터베이스·공유 원본은 서로 다른 CAS entity로 저장되며 600ms 자동 저장과 2초 외부 변경 갱신을 사용합니다.

Markdown·협업·표·대용량 기능은 각각의 진입점을 가져오거나 해당 예제로 이동할 때 사용합니다. 기본 viewer에서 해당 런타임을 초기화할 필요는 없습니다.

### Markdown 시각 편집 범위

시각 편집기는 제목, 문단, 인용, 순서/비순서 목록, 강조, 링크, 인라인 코드, 이미지, 구분선, 들여쓴 코드와 fenced code를 구조적으로 편집합니다. 참조 링크는 문서 전체의 정의를 기준으로 해석하며, 안전한 `http:`, `https:`, `mailto:`, 해시, 사이트 상대 주소와 일반 상대 이미지 경로만 활성화합니다. `//`로 시작하거나 역슬래시를 포함하는 모호한 경로는 활성화하지 않습니다.

표, directive, HTML이 섞인 블록과 그 밖의 지원하지 않는 확장 구문은 잠긴 원문 블록으로 표시합니다. 잠긴 블록은 시각 보기에서 수정하거나 구조 변경할 수 없지만 저장할 때 바이트를 그대로 보존합니다. 해당 구문을 편집하려면 **Markdown 원문** 탭을 사용합니다. 구조 블록을 추가, 분할, 삭제하거나 순서를 바꾸면 필요한 블록 경계만 새로 만들며, 손대지 않은 CRLF와 확장 구문 원문은 유지합니다.

## 라이브러리 진입점

| 모듈 | 역할 |
|---|---|
| `app/src/model.ts` | JSON codec, 복제, 예산 기반 조회, 출력, 변경 통지, 제안 및 호스트 연결 계약 |
| `app/src/Viewer.tsx` | 블록 배열을 받는 engine-free React viewer, 사용자 renderer와 overlay. 정적/읽기 전용 출력의 링크는 `http:`, `https:`, `mailto:`, 해시, 사이트 상대 주소만 활성화합니다. |
| `app/src/editing.ts` | 로컬 ModelSession과 구조 명령 |
| `app/src/features/markdown/` | Markdown 파일 연결 및 UI |
| `app/src/features/collaboration/` | Yjs 연결 및 다중 편집 surface |
| `app/src/features/composite/` | 선택적 table schema, 복합 입력 context와 migration |
| `app/src/features/large-content/` | 부분 로딩, 블록 캐시, 가상화 및 reveal/focus |
| `@block-editor/bindings` | 엔진과 무관한 변경 전달, draft/ack 정책, 비동기 외부 액션 target guard, 엄격한 revision schema |
| `@block-editor/server-bindings` | Node 파일 CAS 저장소, Yjs room 저장소, 서명된 데모 세션과 scope 검사, versioned 승인 workflow |
| `@block-editor/model` | 엔진과 무관한 문서 계약, codec, 명시적 block registry와 React viewer |
| `@block-editor/prosemirror` | opt-in ProseMirror schema/snapshot adapter와 block별 leaf export |
| `@block-editor/workspace` | 엔진 독립 페이지/문서/database/synced-source Zod 계약, 계층 명령, typed row patch, filter/sort와 context heading projection |

두 패키지는 `corepack pnpm build:packages`로 ESM과 선언 파일을 `packages/*/dist`에 생성합니다. 앱은 로컬 노트의 저장 알림, 호스트 폼의 revision bookmark, 수정안의 비동기 target guard, 부분 문서 저장 acknowledgement를 `@block-editor/bindings`에서 직접 사용합니다. 서버는 `.runtime` 아래 durable document/room/workflow 저장소와 권한 검사를 `@block-editor/server-bindings`에서 사용합니다.

```ts
import { ChangeDelivery, PersistenceBaseline } from "@block-editor/bindings"
import { DemoSessionAuthority, FileCasRepository } from "@block-editor/server-bindings"
```

### 사용자 schema와 tree-shaking

core 문서 계약에는 필수 paragraph가 없습니다. ProseMirror를 사용할 때 소비자가 필요한 block leaf만 가져와 schema를 조립합니다. 기존 편집기는 편의를 위해 `@block-editor/prosemirror/preset`을 사용하므로 공개 동작이 유지됩니다.

```tsx
import { BlockViewer } from "@block-editor/model/viewer"
import { blockAttrs, createProseMirrorProfile } from "@block-editor/prosemirror"

const notesText = {
  type: "notes.text",
  nodeName: "notes_text",
  text: true,
  nodeSpec: { group: "block", content: "inline*", attrs: blockAttrs },
  render: (block) => <p>{block.content.map((item) => item.kind === "text" ? item.text : "")}</p>,
} as const

const profile = createProseMirrorProfile([notesText], "notes.text")
const renderers = new Map([[notesText.type, notesText.render]])
const view = <BlockViewer content={document} renderers={renderers} />
```

독립 leaf는 `@block-editor/prosemirror/paragraph`, `/heading`, `/quote`, `/code`, `/caption`, `/task-card`입니다. 공통 preset이 필요한 소비자만 `/preset`을 가져옵니다. 모든 package는 ESM과 선언 파일을 만들고 `sideEffects: false`를 선언합니다. `app/tests/tree-shaking.test.ts`는 실제 esbuild metafile의 입력 모듈을 검사하여 custom-text 소비자에 기본 block leaf가 없고 view-only 소비자에 ProseMirror가 없음을 증명합니다.

구조화 도메인은 렌더링 엔진과 Node 저장소를 import하지 않습니다. 호스트는 schema로 경계를 파싱하고 명령 결과를 자체 CAS adapter에 전달합니다.

```ts
import {
  filterAndSortRows,
  headingLevelAtDepth,
  movePage,
  workspaceSchema,
  type WorkspaceStoragePort,
} from "@block-editor/workspace"

const workspace = workspaceSchema.parse(payload)
const moved = movePage(workspace, "research", "project")
const htmlLevel = headingLevelAtDepth(2, 3) // 5; 저장된 2는 바뀌지 않음
```

## 소유권 예제

사이드바의 **소유권 예제**는 하나의 작업 공간 안에서 다음 경계를 실제 mutation과 저장으로 비교합니다.

- `notebook`: `notes.text`가 기본인 custom schema. 블록 문서가 canonical이고 브라우저 저장 후 다시 불러옵니다.
- `projectboard`: 작업 제목/상태는 분리된 domain data이고 카드 occurrence의 local ID와 캡션만 presentation이 소유합니다. 같은 task 참조를 복제해도 새 local ID를 받으며 카드 삭제는 task를 삭제하지 않습니다.
- `statusview`: query projection과 server action만 사용하며 editor를 만들지 않는 명시적 renderer viewer입니다.
- `filetree`: 허용된 Markdown root 아래의 재귀 파일 트리를 표시합니다. 서버는 절대 경로, traversal, 역슬래시, symlink를 거부하고 `.md` 원문에는 block ID를 기록하지 않습니다.
- `mixedbacklog`: 검색/현재 실행 목록과 workflow 상태는 서버 domain이 소유합니다. 읽기 전용 root 아래의 캡션과 agent proposal만 하위 패널에서 수정하며 proposal은 task dependency version이 바뀌면 거절됩니다. 추가 작업 정보는 Markdown file-tree 서비스로 엽니다.

이 예제의 demo identity cookie는 기존 서명 세션을 재사용합니다. 운영 로그인이나 여러 서비스 사이의 원자성을 주장하지 않습니다.

### 입력, 변경 통지, 저장

엔진 transaction과 IME 처리는 즉시 실행합니다. 내부 로컬 버전은 충돌과 위치 추적에 쓰이며 파일/서버의 저장 revision과 다릅니다. `ChangeDelivery`는 `immediate`, `debounce`(maxWait 포함), `throttle`, `manual` 정책으로 호스트 통지를 묶습니다. `flush()`는 최신 변경을 전달하고 `dispose()`는 남은 타이머를 취소합니다.

로컬 세션은 ProseMirror 상태를 단독 소유합니다. UI용 snapshot은 필요할 때 파생하며, 일반 입력 때마다 전체 JSON을 생성하거나 저장하지 않습니다. 협업 연결은 별도의 Yjs history를 사용하므로 일반 snapshot history를 중복 장착하지 않습니다.

### 데이터 경계

저장용 JSON은 미지원 구조를 보존합니다. 현재 엔진이 안전하게 해석할 수 없는 내용은 opaque로 유지합니다. Markdown/HTML 출력은 JSON 저장과 구별하며 손실 정보를 반환합니다. Markdown 파일 연결은 원래 source를 보존하고 변경한 범위만 반영합니다.

외부 콘텐츠 교체는 model/epoch/baseVersion을 검사하고 조합 중에는 유예합니다. 자동 재조정이 불가능하면 draft를 보존하고 충돌을 알립니다. 외부 액션, 렌더링, 본문 저장은 서로 다른 경로입니다.

`SuggestionProvider`를 연결해 외부 AI나 호스트 제안 스트림을 사용할 수 있습니다. 예제 기본 제공자는 입력 문장을 순차적으로 추가하는 로컬 제공자이며 외부 AI 서비스를 호출하지 않습니다.

`createHttpSuggestionProvider({ endpoint, headers })`는 호스트의 NDJSON 스트림에 실제 HTTP 요청을 보냅니다. 각 응답 줄은 `BlockDocument` snapshot이며 크기·형식 검증 후 후보로 전달됩니다. 취소 신호는 HTTP 요청과 reader에 전파됩니다. API 자격 증명을 저장소에 넣지 말고 호스트가 설정해야 합니다.

## 서버와 저장 위치

- `GET /api/markdown`, `GET/PUT /api/markdown/file`: 재귀 파일 트리, 읽기, 조건부 저장. root 밖 경로와 symlink는 노출하지 않습니다.
- `GET /api/ownership/mixed`, `POST /api/ownership/mixed/task-status|presentation|proposal`: 혼합 백로그의 domain workflow, 하위 presentation, dependency-guarded 제안.
- `/collaboration`: schema handshake, room scope 검사, Yjs 동기화 및 재시작 가능한 room snapshot.
- `/api/large-content`: 페이지 읽기, 블록 조회·수정, 검색 및 전체 내보내기.
- `POST /api/demo/session?identity=author|reviewer|viewer`: 서명된 opaque 데모 세션 cookie 발급.
- `GET/PUT /api/documents/:id`: room scope와 role을 검사하는 durable CAS 문서.
- `POST /api/workflows/:id/submit|approve`: 제출한 콘텐츠 revision을 고정하는 versioned 제출/승인과 audit history. 제출·승인된 문서는 이 예제 API에서 수정할 수 없습니다.
- `GET /api/workspace`: sample workspace와 별도 page/database/synced-source entity를 읽습니다.
- `PUT /api/workspace/:kind/:id`: `trees|pages|databases|sources` entity를 Zod로 파싱한 뒤 `expectedRevision` CAS로 저장합니다. 새 page document만 revision 없이 생성할 수 있습니다.
- `.runtime/`은 실행 데이터이며 Git에서 제외합니다.

구조화 작업 공간은 기본 서버에서 `.runtime/workspace/{trees,pages,databases,sources}`에 entity별 JSON snapshot과 audit history를 저장합니다. `RUNTIME_ROOT`를 직접 받는 API는 없으며 테스트는 `createApplicationServer({ runtimeRoot })`로 임시 root를 격리합니다. 저장 직렬화는 한 Node process 안의 파일별 queue와 atomic rename을 사용합니다. 여러 process 또는 분산 transaction을 제공한다고 가정하지 않습니다.

Markdown은 실제 파일에 저장되고 로컬 노트·표와 코드는 브라우저에 저장됩니다. 협업 방, 일반 문서, 문서 보관함의 수정 블록과 승인 workflow는 `.runtime`의 원자적 파일 교체를 사용합니다. 협업 클라이언트는 연결이 끊겨도 현재 replica를 유지하며 재연결 시 합치고, 서버는 종료 전에 마지막 Yjs snapshot을 저장하여 재시작 후 다시 엽니다. 보관함의 기본 1,600개 원문은 synthetic이며 수정본만 저장합니다.

데모 세션은 화면에서 공개적으로 선택할 수 있는 예제 identity의 역할과 room scope만 확인하며 운영 인증이 아닙니다. `DEMO_SESSION_SECRET`을 지정하지 않으면 서버는 mode 0600의 random secret을 `.runtime/demo-session.secret`에 생성해 재시작 때 재사용합니다. HTTPS를 직접 사용하거나 신뢰한 proxy에서 HTTPS를 종료하는 호스트는 `createApplicationServer({ secureCookies: true })`로 Secure cookie를 설정해야 합니다. 공개 서비스에서는 실제 identity provider와 session rotation으로 교체해야 합니다. 표시용 사용자 이름이나 에디터의 입력 제한은 권한 증명이 아닙니다. 외부 AI 자격 증명과 여러 프로세스·서비스 간 원자성은 호스트가 소유합니다.

## 검사 실행

```sh
corepack pnpm test
corepack pnpm typecheck
corepack pnpm build
corepack pnpm exec playwright install chromium
QA_BASE_URL=http://localhost:3000 corepack pnpm test:browser
```

기존 Chromium은 `CHROME_PATH`로 지정할 수 있습니다. 테스트 출력·브라우저 캡처·개발 진행 보고서는 저장소 산출물로 관리하지 않습니다.
