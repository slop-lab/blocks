export type VersionedEntity<T> = {
  readonly id: string
  readonly revision: number
  readonly content: T
}

export type CompareAndSet<T> = {
  readonly id: string
  readonly expectedRevision: number
  readonly content: T
  readonly actorId: string
}

export interface WorkspaceStoragePort<T> {
  read(id: string): Promise<VersionedEntity<T> | null>
  create(id: string, content: T, actorId: string): Promise<VersionedEntity<T>>
  compareAndSet(input: CompareAndSet<T>): Promise<VersionedEntity<T>>
}
