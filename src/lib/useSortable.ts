import { useEffect, useRef, type RefObject } from 'react';
import Sortable from 'sortablejs';

/**
 * Integra SortableJS con React: Sortable mueve el DOM, pero aquí deshacemos ese
 * movimiento y dejamos que React lo re-renderice a partir del estado.
 */
export function useSortable(
  ref: RefObject<HTMLElement | null>,
  onMove: (from: number, to: number) => void,
  options: Sortable.Options = {},
  /** Cambia este valor cuando el contenedor se monte de nuevo. */
  active: unknown = true,
): void {
  const cb = useRef(onMove);
  cb.current = onMove;
  useEffect(() => {
    if (!ref.current) return;
    const s = Sortable.create(ref.current, {
      animation: 160,
      ghostClass: 'sortable-ghost',
      chosenClass: 'sortable-chosen',
      forceFallback: false,
      delayOnTouchOnly: true,
      delay: 120,
      ...options,
      onEnd: (evt) => {
        const { oldIndex, newIndex, item, from } = evt;
        if (oldIndex == null || newIndex == null || oldIndex === newIndex) return;
        from.removeChild(item);
        from.insertBefore(item, from.children[oldIndex] ?? null);
        cb.current(oldIndex, newIndex);
      },
    });
    return () => s.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, active]);
}
