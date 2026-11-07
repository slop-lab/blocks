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
  draft: "Draft",
  submitted: "Review requested",
  approved: "Approved",
}
const identityLabels: Readonly<Record<string, string>> = {
  author: "Author",
  reviewer: "Reviewer",
  viewer: "Viewer",
}
const actionLabels: Readonly<Record<Workflow["audit"][number]["action"], string>> = {
  created: "Draft created",
  submitted: "Review requested",
  approved: "Approved",
}
const initialText = "Next week's meeting is scheduled for Thursday at 3:00 PM."

export const WorkflowWorkspace = () => {
  const [identity, setIdentity] = useState<Identity>("author")
  const [workflow, setWorkflow] = useState<Workflow | null>(null)
  const [text, setText] = useState(initialText)
  const [documentRevision, setDocumentRevision] = useState<number | null>(null)
  const [message, setMessage] = useState("Opening the server session.")
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
      setMessage(`Verified ${identityLabels[nextIdentity]} permissions with the server.`)
    } catch (error) {
      if (!(error instanceof HTTPError) || error.response.status !== 404) {
        setMessage(error instanceof Error ? error.message : "Could not load server state.")
        return
      }
      if (nextIdentity !== "author") {
        setWorkflow(null)
        setMessage("The author has not created a document yet.")
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
      setMessage(`Verified ${identityLabels[nextIdentity]} permissions with the server.`)
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
      setMessage("Saved the draft to the durable document.")
    } catch (error) {
      if (error instanceof HTTPError && error.response.status === 409) {
        await open(identity)
        setMessage("Loaded newer changes. Review them before saving again.")
        return
      }
      setMessage(error instanceof Error ? error.message : "Could not save the draft.")
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
      setMessage(action === "submit" ? "Requested a review." : "Approved the document.")
    } catch (error) {
      if (
        error instanceof HTTPError &&
        (error.response.status === 403 || error.response.status === 409)
      ) {
        if (error.response.status === 409) {
          await open(identity)
          setMessage("Loaded newer changes. Try again from the current state.")
        } else setMessage("The current role is not allowed to perform this action.")
        return
      }
      setMessage(error instanceof Error ? error.message : "Could not complete the workflow action.")
    } finally {
      setBusy(null)
    }
  }

  const editable = identity === "author" && workflow?.state === "draft"
  return (
    <section className="workflow-workspace" aria-labelledby="workflow-title">
      <header className="workflow-header">
        <div>
          <span className="eyebrow">Server-authorized workflow</span>
          <h1 id="workflow-title">Shared meeting notes</h1>
        </div>
        <fieldset className="workflow-identities">
          <legend>Demo role</legend>
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
            {workflow === null ? "None" : labels[workflow.state]}
          </span>
          <label htmlFor="workflow-text">Meeting notes</label>
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
              {busy === "saving" ? "Saving" : "Save draft"}
            </button>
            <button
              className="button button--primary"
              type="button"
              disabled={!editable || busy !== null}
              onClick={() => void transition("submit")}
            >
              {busy === "transition" && identity === "author" ? "Requesting" : "Request review"}
            </button>
            <button
              className="button button--primary"
              type="button"
              disabled={identity !== "reviewer" || workflow?.state !== "submitted" || busy !== null}
              onClick={() => void transition("approve")}
            >
              {busy === "transition" && identity === "reviewer" ? "Approving" : "Approve"}
            </button>
          </div>
          <p role="status">{message}</p>
        </article>
        <aside className="workflow-audit" aria-label="Workflow history">
          <h2>Workflow history</h2>
          <ol>
            {workflow?.audit.map((entry) => (
              <li key={`${entry.action}-${entry.timestamp}`}>
                <strong>{actionLabels[entry.action]}</strong>
                <span>{identityLabels[entry.actorId] ?? entry.actorId}</span>
                <time>{new Date(entry.timestamp).toLocaleString("en-US")}</time>
              </li>
            ))}
          </ol>
        </aside>
      </div>
    </section>
  )
}
