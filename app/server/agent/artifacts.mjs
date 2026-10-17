import { hashJson } from "./lifecycle.mjs"

export const fingerprintArtifact = (artifact) => {
  const { fingerprint: _fingerprint, ...reviewed } = artifact
  return hashJson(reviewed)
}

export const sealArtifact = (artifact) => ({
  ...artifact,
  fingerprint: fingerprintArtifact(artifact),
})

export const artifactIsIntact = (artifact) =>
  artifact !== null && fingerprintArtifact(artifact) === artifact.fingerprint
