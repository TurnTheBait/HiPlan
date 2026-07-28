import { useRef, useEffect } from 'react';

export default function useDragScroll(externalRef, deps = []) {
  const internalRef = useRef(null);
  const ref = externalRef || internalRef;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let isDown = false;
    let startX;
    let scrollLeft;

    const mouseDown = (e) => {
      isDown = true;
      el.classList.add('grabbing');
      el.style.cursor = 'grabbing';
      startX = e.pageX - el.offsetLeft;
      scrollLeft = el.scrollLeft;
    };

    const mouseLeave = () => {
      isDown = false;
      el.classList.remove('grabbing');
      el.style.cursor = 'grab';
    };

    const mouseUp = () => {
      isDown = false;
      el.classList.remove('grabbing');
      el.style.cursor = 'grab';
    };

    const mouseMove = (e) => {
      if (!isDown) return;
      e.preventDefault();
      const x = e.pageX - el.offsetLeft;
      const walk = (x - startX) * 1.5; // Scroll-fast
      el.scrollLeft = scrollLeft - walk;
    };

    // Impostiamo il cursore di default su grab
    el.style.cursor = 'grab';

    el.addEventListener('mousedown', mouseDown);
    el.addEventListener('mouseleave', mouseLeave);
    el.addEventListener('mouseup', mouseUp);
    el.addEventListener('mousemove', mouseMove);

    return () => {
      el.removeEventListener('mousedown', mouseDown);
      el.removeEventListener('mouseleave', mouseLeave);
      el.removeEventListener('mouseup', mouseUp);
      el.removeEventListener('mousemove', mouseMove);
    };
  }, [ref, ...deps]);

  return ref;
}
