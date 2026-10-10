import type { SaveMode } from "../host/useDocumentSessions"

type Props = {
  readonly saveMode: SaveMode
  readonly onSaveMode: (mode: SaveMode) => void
  readonly dirty: boolean
  readonly hostDirty: boolean
  readonly onSave: () => void
  readonly onForm: () => void
  readonly onReview: () => void
  readonly onRefresh: () => void
}

export const DocumentPanel = (props: Props) => (
  <aside className="inspector document-panel" aria-label="문서 설정">
    <div className="inspector__header">
      <h2>문서 설정</h2>
    </div>
    <div className="inspector__body panel-stack">
      <section className="inspector-card">
        <label className="field">
          <span>저장 방식</span>
          <select
            aria-label="저장 방식"
            value={props.saveMode}
            onChange={(event) => {
              const mode = event.target.value
              if (
                mode === "manual" ||
                mode === "debounce" ||
                mode === "throttle" ||
                mode === "blur"
              )
                props.onSaveMode(mode)
            }}
          >
            <option value="manual">수동 저장</option>
            <option value="debounce">입력을 멈추면 자동 저장</option>
            <option value="throttle">일정 간격으로 자동 저장</option>
            <option value="blur">편집기를 벗어나면 저장</option>
          </select>
        </label>
        <p>
          {props.saveMode === "manual"
            ? "저장 버튼을 눌러 현재 내용을 보관합니다."
            : props.saveMode === "debounce"
              ? "입력 후 600ms, 연속 입력 중에는 최대 3초마다 저장합니다."
              : props.saveMode === "throttle"
                ? "입력 중 1초 간격으로 최신 내용을 저장합니다."
                : "다른 영역으로 포커스를 옮기면 저장합니다."}
        </p>
        <p role="status">문서: {props.dirty ? "저장하지 않은 변경" : "저장됨"}</p>
        <button className="button button--primary" type="button" onClick={props.onSave}>
          지금 저장
        </button>
        <small className="muted">이 문서는 현재 브라우저에 보관됩니다.</small>
      </section>
      <section className="inspector-card button-stack">
        <h3>문서 작업</h3>
        <button className="button button--secondary" type="button" onClick={props.onReview}>
          수정안 비교
        </button>
        <button className="button button--secondary" type="button" onClick={props.onForm}>
          브리핑 정보 편집
        </button>
        <p>일감 상태: {props.hostDirty ? "변경됨" : "보관됨"}</p>
        <button className="button button--ghost" type="button" onClick={props.onRefresh}>
          최신 안내 가져오기
        </button>
      </section>
    </div>
  </aside>
)
