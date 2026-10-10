export type Attachment = {
  readonly dispose: () => void
}

export type AttachmentFactory<Context> = {
  readonly attach: (host: HTMLElement, context: Context) => Attachment
}

export const createAttachmentFactory = <Context>(
  mount: (host: HTMLElement, context: Context) => () => void,
): AttachmentFactory<Context> => ({
  attach: (host, context) => {
    const dispose = mount(host, context)
    return { dispose }
  },
})
