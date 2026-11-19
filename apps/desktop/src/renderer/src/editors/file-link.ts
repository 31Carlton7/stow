import Link, { type LinkOptions } from "@tiptap/extension-link";

export const DEAD_LINK_TITLE = "This link leads to no file";

/**
 * The schema's link, drawn as dead where the file being read says it leads nowhere. Told through the
 * mark's own rendering, never by changing the anchor afterwards: ProseMirror redraws a node whose DOM
 * it finds changed.
 */
export const FileLink = Link.extend<LinkOptions & { isDeadLink: (href: string) => boolean }>({
  addOptions() {
    return { ...this.parent!(), isDeadLink: () => false };
  },
  renderHTML({ mark, HTMLAttributes }) {
    const dead = this.options.isDeadLink(String(mark.attrs.href ?? ""));
    return this.parent!({ mark, HTMLAttributes: dead ? { ...HTMLAttributes, "data-dead": "", title: DEAD_LINK_TITLE } : HTMLAttributes });
  },
});
