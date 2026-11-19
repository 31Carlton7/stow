import type { DragEvent, MouseEvent } from "react";
import { Icon } from "@amc/ui";
import type { HandedOut } from "../../../preload";

export type { HandedOut };

/**
 * What makes a row or a card something that can be dragged out of the window. A file or a folder is
 * dragged by the main process, as a file another app can take: the page's own drag is cancelled, for
 * it would carry only the row's words. Text is an ordinary drag of the page's.
 */
export function dragOut(handed: HandedOut): { draggable: true; onDragStart: (e: DragEvent) => void } {
  return {
    draggable: true,
    onDragStart(e) {
      if ("text" in handed) {
        e.dataTransfer.setData("text/plain", handed.text);
        e.dataTransfer.effectAllowed = "copy";
        return;
      }
      e.preventDefault();
      window.amc?.dragOut(handed.path);
    },
  };
}

/** Opens the Mac's share sheet under itself, on what a drag of the same thing would carry. It belongs in a column's head. */
export function ShareButton({ handed }: { handed: HandedOut }) {
  const share = (e: MouseEvent<HTMLButtonElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    void window.amc?.share(handed, { x: Math.round(box.left), y: Math.round(box.bottom) + 6 });
  };
  return (
    <button type="button" className="icon-btn" aria-label="Share" title="Share" onClick={share}>
      <Icon name="share" size={14} />
    </button>
  );
}
