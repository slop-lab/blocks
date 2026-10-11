import ky, { HTTPError } from "ky"
import { useCallback, useEffect, useState } from "react"
import { z } from "zod"
import "./workflow.css"

const auditSchema = z
  .object({
    action: z.enum(["created", "submitted", "approved"]),
    actorId: z.string(),
    timestamp: z.string(),
  })
  .strict()
const workflowSchema = z
  .object({
    documentId: z.string(),
    revision: z.number().int().positive(),
    state: z.enum(["draft", "submitted", "approved"]),
    authorId: z.string(),
    submittedDocumentRevision: z.number().int().positive().nullable(),
    audit: z.array(auditSchema),
  })
  .strict()
const documentSchema = z
  .object({
    documentId: z.string(),
    revision: z.number().int().positive(),
    content: z.unknown(),
    metadata: z.record(z.string(), z.unknown()),
    history: z.array(z.unknown()),
  })
  .strict()

type Identity = "author" | "reviewer" | "viewer"
type Workflow = z.infer<typeof workflowSchema>
const client = ky.create({ timeout: 10_000, retry: 0 })
const labels: Readonly<Record<Workflow["state"], string>> = {
  draft: "초안",
  submitted: "검토 요청됨",
  approved: "승인됨",
}
const identityLabels: Readonly<Record<string, string>> = {
  author: "작성자",
  reviewer: "검토자",
  viewer: "열람자",
}
const actionLabels: Readonly<Record<Workflow["audit"][number]["action"], string>> = {
  created: "초안 생성",
  submitted: "검토 요청",
  approved: "승인",
}
const initialText = "다음 주 회의는 목요일 오후 세 시에 진행합니다."

export const WorkflowWorkspace = () => {
  const [identity, setIdentity] = useState<Identity>("author")
  const [workflow, setWorkflow] = useState<Workflow | null>(null)
  const [text, setText] = useState(initialText)
  const [documentRevision, setDocumentRevision] = useState<number | null>(null)
  const [message, setMessage] = useState("서버 세션을 여는 중입니다.")
  const [busy, setBusy] = useState<"opening" | "saving" | "transition" | null>(null)

  const open = useCallback(async (nextIdentity: Identity): Promise<void> => {
    setBusy("opening")
    try {
      await client.post(`api/demo/session?identity=${nextIdentity}`)
      setIdentity(nextIdentity)
      const document = documentSchema.parse(await client.get("api/documents/team-minutes").json())
      setDocumentRevision(document.revision)
      if (
        typeof document.content === "object" &&
        document.content !== null &&
        "text" in document.content &&
        typeof document.content.text === "string"
      )
        setText(document.content.text)
      setWorkflow(workflowSchema.parse(await client.get("api/workflows/team-minutes").json()))
      setMessage(`${identityLabels[nextIdentity]} 권한을 서버에서 확인했습니다.`)
    } catch (error) {
      if (!(error instanceof HTTPError) || error.response.status !== 404) {
        setMessage(error instanceof Error ? error.message : "서버 상태를 불러오지 못했습니다.")
        return
      }
      if (nextIdentity !== "author") {
        setWorkflow(null)
        setMessage("작성자가 아직 문서를 만들지 않았습니다.")
        return
      }
      const document = documentSchema.parse(
        await client
          .put("api/documents/team-minutes", {
            json: {
              content: { text: initialText },
              metadata: { useCase: "shared-meeting-notes" },
            },
          })
          .json(),
      )
      setDocumentRevision(document.revision)
      setWorkflow(workflowSchema.parse(await client.get("api/workflows/team-minutes").json()))
      setMessage(`${identityLabels[nextIdentity]} 권한을 서버에서 확인했습니다.`)
    } finally {
      setBusy(null)
    }
  }, [])

  useEffect(() => {
    void open("author")
  }, [open])

  const save = async (): Promise<void> => {
    if (documentRevision === null || busy !== null) return
    setBusy("saving")
    try {
      const document = documentSchema.parse(
        await client
          .put("api/documents/team-minutes", {
            json: { expectedRevision: documentRevision, content: { text } },
          })
          .json(),
      )
      setDocumentRevision(document.revision)
      setMessage("초안을 durable 문서에 저장했습니다.")
    } catch (error) {
      if (error instanceof HTTPError && error.response.status === 409) {
        await open(identity)
        setMessage("다른 변경을 불러왔습니다. 내용을 확인한 뒤 다시 저장하세요.")
        return
      }
      setMessage(error instanceof Error ? error.message : "초안을 저장하지 못했습니다.")
    } finally {
      setBusy(null)
    }
  }

  const transition = async (action: "submit" | "approve"): Promise<void> => {
    if (workflow === null || busy !== null) return
    setBusy("transition")
    try {
      const next = workflowSchema.parse(
        await client
          .post(`api/workflows/team-minutes/${action}`, {
            json: { expectedRevision: workflow.revision },
          })
          .json(),
      )
      setWorkflow(next)
      setMessage(action === "submit" ? "검토를 요청했습니다." : "문서를 승인했습니다.")
    } catch (error) {
      if (
        error instanceof HTTPError &&
        (error.response.status === 403 || error.response.status === 409)
      ) {
        if (error.response.status === 409) {
          await open(identity)
          setMessage("다른 변경을 불러왔습니다. 현재 상태에서 다시 시도하세요.")
        } else setMessage("현재 역할에는 이 작업 권한이 없습니다.")
        return
      }
      setMessage(error instanceof Error ? error.message : "워크플로 작업을 완료하지 못했습니다.")
    } finally {
      setBusy(null)
    }
  }

  const editable = identity === "author" && workflow?.state === "draft"
  return (
    <section className="workflow-workspace" aria-labelledby="workflow-title">
      <header className="workflow-header">
        <div>
          <span className="eyebrow">서버 권한 워크플로</span>
          <h1 id="workflow-title">공유 회의록</h1>
        </div>
        <fieldset className="workflow-identities">
          <legend>데모 역할</legend>
          {(["author", "reviewer", "viewer"] as const).map((value) => (
            <button
              className={
                identity === value ? "workflow-role workflow-role--active" : "workflow-role"
              }
              type="button"
              key={value}
              disabled={busy !== null}
              onClick={() => void open(value)}
            >
              {identityLabels[value]}
            </button>
          ))}
        </fieldset>
      </header>
      <div className="workflow-grid">
        <article className="workflow-document">
          <span className="status-badge">
            {workflow === null ? "없음" : labels[workflow.state]}
          </span>
          <label htmlFor="workflow-text">회의 내용</label>
          <textarea
            id="workflow-text"
            value={text}
            readOnly={!editable}
            onChange={(event) => setText(event.target.value)}
          />
          <div className="workflow-actions">
            <button
              className="button button--secondary"
              type="button"
              disabled={!editable || busy !== null}
              onClick={() => void save()}
            >
              {busy === "saving" ? "저장 중" : "초안 저장"}
            </button>
            <button
              className="button button--primary"
              type="button"
              disabled={!editable || busy !== null}
              onClick={() => void transition("submit")}
            >
              {busy === "transition" && identity === "author" ? "요청 중" : "검토 요청"}
            </button>
            <button
              className="button button--primary"
              type="button"
              disabled={identity !== "reviewer" || workflow?.state !== "submitted" || busy !== null}
              onClick={() => void transition("approve")}
            >
              {busy === "transition" && identity === "reviewer" ? "승인 중" : "승인"}
            </button>
          </div>
          <p role="status">{message}</p>
        </article>
        <aside className="workflow-audit" aria-label="업무 이력">
          <h2>업무 이력</h2>
          <ol>
            {workflow?.audit.map((entry) => (
              <li key={`${entry.action}-${entry.timestamp}`}>
                <strong>{actionLabels[entry.action]}</strong>
                <span>{identityLabels[entry.actorId] ?? entry.actorId}</span>
                <time>{new Date(entry.timestamp).toLocaleString("ko-KR")}</time>
              </li>
            ))}
          </ol>
        </aside>
      </div>
    </section>
  )
}
