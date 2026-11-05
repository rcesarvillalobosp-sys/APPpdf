import { memo, useEffect, useRef, useState } from 'react';
import { getThumbnail } from '../lib/thumbnails';

/** Miniatura que se renderiza solo cuando entra en pantalla. */
export const PageThumb = memo(function PageThumb({
  docId,
  pageIndex,
  rotation,
  alt,
}: {
  docId: string;
  pageIndex: number;
  rotation: number;
  alt: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: '300px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    let alive = true;
    getThumbnail(docId, pageIndex).then(
      (u) => alive && setUrl(u),
      () => alive && setFailed(true),
    );
    return () => {
      alive = false;
    };
  }, [visible, docId, pageIndex]);

  return (
    <div ref={ref} className="flex aspect-[3/4] w-full items-center justify-center overflow-hidden rounded-md bg-slate-100">
      {url ? (
        <img
          src={url}
          alt={alt}
          draggable={false}
          className="max-h-full max-w-full object-contain shadow-sm transition-transform duration-200"
          style={{ transform: `rotate(${rotation}deg)${rotation % 180 ? ' scale(0.75)' : ''}` }}
        />
      ) : failed ? (
        <span className="px-2 text-center text-xs text-red-600">No se pudo previsualizar</span>
      ) : (
        <div className="skeleton h-full w-full" />
      )}
    </div>
  );
});
