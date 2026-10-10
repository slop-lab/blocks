import type { BlockDocument } from "./types"

export type ReviewCandidate = {
  readonly id: string
  readonly baseVersion: number
  readonly document: BlockDocument
}

export const acceptReview = (candidate: ReviewCandidate, currentVersion: number) =>
  candidate.baseVersion === currentVersion
    ? { kind: "accepted" as const, document: candidate.document }
    : { kind: "base_mismatch" as const, expected: candidate.baseVersion, received: currentVersion }

export const rejectReview = (candidate: ReviewCandidate) => ({
  kind: "rejected" as const,
  id: candidate.id,
})
