import { useState } from "react"

type Task = { readonly id: string; readonly title: string; readonly done: boolean }
type Card = { readonly localId: string; readonly taskId: string; readonly caption: string }
const tasks: readonly Task[] = [
  { id: "TASK-21", title: "온보딩 인터뷰", done: false },
  { id: "TASK-22", title: "결과 문서 배포", done: true },
]
const seed: readonly Card[] = [
  { localId: "card-1", taskId: "TASK-21", caption: "첫 번째 화면" },
  { localId: "card-2", taskId: "TASK-21", caption: "같은 작업의 요약 카드" },
]

export const ProjectBoardScenario = () => {
  const [cards, setCards] = useState(seed)
  const duplicate = (card: Card) =>
    setCards((current) => [
      ...current,
      { ...card, localId: crypto.randomUUID(), caption: `${card.caption} 복사본` },
    ])
  return (
    <section className="ownership-scenario" aria-labelledby="board-title">
      <header className="ownership-scenario__header">
        <div>
          <span className="eyebrow">DOMAIN + PRESENTATION</span>
          <h2 id="board-title">프로젝트 보드</h2>
        </div>
      </header>
      <p className="ownership-explainer">
        작업 서비스가 제목과 완료 상태를 소유합니다. 블록 문서는 카드 배치와 occurrence 캡션만
        저장합니다.
      </p>
      <div className="ownership-grid">
        {cards.map((card) => {
          const task = tasks.find((item) => item.id === card.taskId)
          return (
            <article className="ownership-card" key={card.localId}>
              <small>{card.localId}</small>
              <h3>{task?.title ?? "삭제된 작업"}</h3>
              <p>{card.caption}</p>
              <span className="status-badge">외부 참조 {card.taskId}</span>
              <div className="button-row">
                <button
                  className="button button--secondary"
                  type="button"
                  onClick={() => duplicate(card)}
                >
                  카드 복제
                </button>
                <button
                  className="button button--danger"
                  type="button"
                  onClick={() =>
                    setCards((current) => current.filter((item) => item.localId !== card.localId))
                  }
                >
                  카드 삭제
                </button>
              </div>
            </article>
          )
        })}
      </div>
      <footer role="status">도메인 작업 {tasks.length}개는 카드 삭제와 무관하게 유지됩니다.</footer>
    </section>
  )
}
