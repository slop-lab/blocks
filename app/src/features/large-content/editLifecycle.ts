type SaveAcknowledgementInput = Readonly<{
  mounted: boolean
  latestRequest: boolean
  requestTargetId: string
  currentTargetId: string
  submittedDraft: string
  currentDraft: string
}>

export type SaveAcknowledgement = "close" | "preserve" | "stale"

export const resolveSaveAcknowledgement = ({
  mounted,
  latestRequest,
  requestTargetId,
  currentTargetId,
  submittedDraft,
  currentDraft,
}: SaveAcknowledgementInput): SaveAcknowledgement => {
  if (!mounted || !latestRequest || requestTargetId !== currentTargetId) return "stale"
  return submittedDraft === currentDraft ? "close" : "preserve"
}
