# 패키지 배포와 실사용 전 계약

이 문서는 공개 패키지의 경계와 출시 승인 조건을 정의합니다. 이름 변경이나 로컬 테스트 통과가 npm 게시 또는 운영 준비 완료를 뜻하지 않습니다. 아래 미완료 항목은 실제 배포 전에 해결해야 합니다.

## 공개 / 로컬 경계

공개 라이브러리 이름은 `@slop-lab/blocks`와 `@slop-lab/blocks-*`만 사용합니다. 로컬 애플리케이션·개발 도구는 `@this-project/*`이며 반드시 `private: true`를 유지합니다. 공개 패키지는 로컬 패키지에 runtime dependency를 가져서는 안 됩니다.

| 디렉터리 | 패키지 이름 | 배포 대상 |
| --- | --- | --- |
| `packages/model` | `@slop-lab/blocks` | 공개 코어 |
| `packages/bindings` | `@slop-lab/blocks-bindings` | 공개 |
| `packages/containers` | `@slop-lab/blocks-containers` | 공개 |
| `packages/interactions` | `@slop-lab/blocks-interactions` | 공개 |
| `packages/prosemirror` | `@slop-lab/blocks-prosemirror` | 공개, 선택적 편집 엔진 |
| `packages/markdown` | `@slop-lab/blocks-markdown` | 공개 |
| `packages/workspace` | `@slop-lab/blocks-workspace` | 공개 |
| `packages/server-bindings` | `@slop-lab/blocks-server-bindings` | 공개, Node 호스트 |
| `packages/git-documents` | `@slop-lab/blocks-git-documents` | 공개, Node / Git |
| `packages/git-documents-host` | `@slop-lab/blocks-git-documents-host` | 공개, Node HTTP 호스트 |
| `packages/agent-tools` | `@slop-lab/blocks-agent-tools` | 공개, 실행 엔진 독립 |
| `packages/agent-tools-part` | `@slop-lab/blocks-agent-tools-part` | 공개, 선택적 Part 연결 |
| 저장소 루트 | `@this-project/demo` | 로컬 전용 |
| `packages/block-docs` | `@this-project/block-docs` | 로컬 전용 |

`block-docs` 실행 파일 이름과 기존 명령은 바꾸지 않습니다. 현재 CLI는 실행 위치의 `dist` 또는 저장소 상대 위치의 웹 빌드를 사용합니다. npm 단독 설치에 웹 자산이 포함되는 구조가 아니므로 공개 대상에서 제외합니다. 나중에 공개하려면 웹 자산의 포함·해결 경로·버전 결합과 저장소 밖에서의 실제 HTTP 화면 실행을 먼저 해결해야 합니다. HTTP 호스트 라이브러리 자체는 소비자가 자산 경로를 제공하는 별도 공개 모듈입니다.

패키지 이름과 저장 형식은 별개입니다. `block-editor/v0.3`, `block-editor.agent` 프로토콜 식별자와 저장된 데이터는 이름 변경으로 마이그레이션하지 않습니다. 이전 패키지 이름의 alias는 제공하지 않습니다.

## 1. npm 첫 배포 전 차단 항목

- [ ] **라이선스 결정**: 권리자가 라이선스를 정하고 각 공개 manifest의 `license`와 각 tarball의 LICENSE를 일치시킵니다. 현재 12개 공개 tarball 모두 LICENSE가 없습니다. 임의로 MIT 등으로 선언하지 않습니다. 외부 코드·자산의 라이선스도 확인합니다.
- [ ] **소유권·권한 확인**: 실제 registry에서 `@slop-lab` scope 권한, 12개 이름의 사용 가능 여부, 이미 게시된 버전을 확인합니다. 로컬 이름 변경으로 확인된 사항이 아닙니다.
- [ ] **배포 metadata**: 공개 패키지마다 `description`, 실제 공개 가능한 `repository`와 `directory`, 지원·이슈 경로를 정합니다. 현재 공개 manifest에는 `license`, `description`, `repository`, `publishConfig`가 없습니다. scoped public 배포 접근 설정을 명시하고 registry·tag를 검토합니다.
- [ ] **패키지별 문서**: 설치, 최소 실행 예시, exports, peer dependencies, 브라우저/Node 경계, 안정성·지원 범위를 README에 넣습니다. 현재 공개 tarball 중 README는 containers에만 있습니다. 저장소 루트 README는 다른 패키지에 자동 포함되지 않습니다.
- [ ] **지원 환경 명시**: ESM-only 공개 형태와 TypeScript module resolution, React·ProseMirror·Yjs·Zod의 지원 조합을 확정합니다. Node 전용 모듈에는 실제 최소 Node/Git 요구사항을 검증·명시합니다. 데모와 Part 연결은 Node `>=24.22.0`이며 이를 브라우저 코어 전체의 요구사항으로 혼동하지 않습니다.
- [ ] **버전·API 정책**: 현재 공개 패키지 버전 `0.1.0`의 최초 게시 여부를 확인하고, 동시/독립 버전 정책과 changelog·breaking change·지원 중단 정책을 정합니다. `0.x` 호환성을 보장한다고 가정하지 않습니다.
- [ ] **릴리즈 자동화**: 현재 저장소에 릴리즈 CI가 없습니다. 깨끗한 checkout, 고정 lockfile, 패키지 빌드, 검증, tarball 검사, 승인된 게시와 tag를 연결합니다. 게시 자격 증명은 소스나 tarball에 넣지 않고 최소 권한과 보호된 배포 환경을 사용합니다.

위 항목은 이번 이름 변경에서 임의 설정하지 않았습니다. 특히 라이선스, registry 소유권, 공개 repository 주소는 프로젝트 소유자의 결정이 필요합니다.

## 2. 소비자 기준 패키징 승인

workspace의 symlink로 실행되는 것과 npm 소비자가 실행하는 것은 다릅니다. 릴리즈마다 다음을 확인합니다.

- [ ] 지원 Node와 고정된 pnpm 버전으로 `corepack pnpm install --frozen-lockfile` 후 빌드합니다.
- [ ] 공개 12개만 pack하고, 각 tarball의 manifest·파일 목록을 검사합니다. exports의 JS / `.d.ts` 대상이 모두 존재하고 `workspace:`, 옛 scope, `@this-project/*`, 저장소 절대 경로가 남지 않아야 합니다.
- [ ] tarball에 `.runtime`, 비밀값, 개발용 보고서, 소비자에게 필요 없는 앱 코드가 들어가지 않음을 확인합니다.
- [ ] 저장소 밖 빈 소비자에 설치하고 공개 root 및 subpath exports, `.d.ts`, peer 조합과 실제 API 호출을 검증합니다. viewer-only 소비자에 ProseMirror·Node·Part가 끼어들지 않는지도 확인합니다.
- [ ] 지원 OS와 브라우저 조합을 CI에서 실행합니다. Linux 검사 통과만으로 Windows/macOS 지원을 주장하지 않습니다.
- [ ] 공개 의존 패키지가 먼저 존재하도록 의존 그래프 순서로 게시합니다. staging registry에서 전체 그래프를 먼저 설치해 보고, 실제 registry 게시 후에는 로컬 overrides 없이 다시 설치·실행합니다.

pnpm은 pack/publish 시 `workspace:*`를 해당 버전으로 바꿉니다. 현재 `0.1.0` 내부 의존성이므로 상위 패키지 tarball만 설치하면 아직 게시되지 않은 하위 패키지는 registry에서 404가 납니다. tarball 소비자 검증에서 사용한 로컬 overrides는 이 이름 해석을 임시 대체한 것이지, 실제 registry 게시가 검증됐다는 뜻이 아닙니다.

현재 이름 변경은 공개 12개 tarball의 root import, 코어 codec 실행, 외부 소비자 TypeScript 검사까지 확인했습니다. 모든 subpath·지원 OS·실제 registry 설치 검증을 대체하지는 않습니다.

저장소 내 기본 회귀 검사는 다음과 같습니다.

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
corepack pnpm test:browser
corepack pnpm test:git-documents-browser
```

브라우저 검사는 설치된 Playwright Chromium 또는 `CHROME_PATH`가 필요합니다. 두 로컬 패키지에는 게시 명령을 실행하지 않습니다. 이 문서의 체크리스트는 게시 실행 지시가 아닙니다.

## 3. 실제 제품에 연결하기 전

### 인증과 호스트 책임

- [ ] 데모 identity 선택·서명 cookie를 실제 로그인, tenant/resource 권한, session rotation 정책으로 교체합니다. 화면의 읽기 전용 표시를 권한 검사로 간주하지 않습니다.
- [ ] HTTPS·trusted proxy·Secure cookie·origin 정책, 요청 크기·rate limit·실행 예산을 배포 환경에 맞게 설정합니다. 데모 서버를 그대로 공개 인터넷에 노출하지 않습니다.
- [ ] 사용자 schema와 renderer, opaque 데이터 보존·외부 링크 정책, host mutation 계약을 정합니다. 편집기 코어가 업무 권한이나 workflow를 대신 소유하지 않게 합니다.

### 저장과 복구

- [ ] 기존 JSON과 Markdown의 백업·복원, 스키마 변경, CAS 충돌 UI와 실패 후 재시도를 실제 운영 데이터로 검증합니다. 기존 콘텐츠·history의 단일 소유권을 유지합니다.
- [ ] 파일 저장소의 단일 프로세스 queue를 다중 worker·분산 transaction 보장으로 사용하지 않습니다. 여러 프로세스로 확장하려면 저장 adapter와 동시성 제어를 교체합니다.
- [ ] 협업 연결 해제·재접속, 서버 종료·재시작, 디스크 오류와 저장 공간 부족, 백업 복구를 검증합니다. 보존 기간과 감사·관측·민감 정보 삭제 정책을 정합니다.
- [ ] Git 호스트에는 실제 Git 실행 환경과 사용자 credential을 준비하고 worktree·branch·충돌 복구·원격 오류를 검증합니다. 자동 reset/force-push로 복구하지 않습니다.

### Part 도구 / 모델

- [ ] 기본 `결정적 시나리오 / 모델미연결`은 실제 Part dispatcher 예시이지 외부 LLM 검증이 아닙니다. 사용할 provider/model/endpoint/credential로 별도 검증합니다.
- [ ] 모델 자격 증명과 도구 권한은 서버에만 두고, 문서·도구 결과를 비신뢰 입력으로 취급합니다. 모델의 제안 생성과 사용자의 승인된 원본 적용을 분리합니다.
- [ ] readset·hash·revision과 승인 대상의 정확한 일치, 취소 후 늦은 결과, 요청 중복·세션 격리·예산 초과·기록 redaction을 실제 호스트에서 확인합니다.
- [ ] journal의 command receipts/events는 100개 보존 경계를 가집니다. 장기 감사와 영구 중복 방지가 필요하면 별도 durable store·보존 정책을 제공합니다.
- [ ] `application-failed` / `application-incomplete`는 자동 재적용하지 않습니다. 원본 변경 뒤 장애가 났을 가능성을 확인할 복구·운영 절차를 마련합니다. 연결 Markdown 읽기와 백로그 변경의 cross-resource 원자성도 제공한다고 가정하지 않습니다.

## 참고

- [pnpm workspace 의존성의 pack/publish 변환](https://pnpm.io/workspaces#publishing-workspace-packages)
- 소유권·저장 계약: `source-runtime.md`, `interaction.md`
- 도구·실행 계약: `agent-tools.md`
- 검증 계층: `testing.md`
