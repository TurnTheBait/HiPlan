import { useRef, useEffect } from 'react';

// Soglia in px oltre la quale consideriamo il movimento un "drag" (non un click)
const DRAG_THRESHOLD = 5;

export default function useDragScroll(externalRef, deps = []) {
  const internalRef = useRef(null);
  const ref = externalRef || internalRef;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let isDown = false;
    let isDragging = false;   // true solo se si è mosso oltre la soglia
    let startX;
    let startScrollLeft;

    const mouseDown = (e) => {
      isDown = true;
      isDragging = false;
      el.classList.add('grabbing');
      el.style.cursor = 'grabbing';
      startX = e.pageX - el.offsetLeft;
      startScrollLeft = el.scrollLeft;
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
      // Non resettiamo isDragging qui: lo facciamo nel click handler
      // così il click viene soppresso se c'è stato un drag
    };

    const mouseMove = (e) => {
      if (!isDown) return;
      e.preventDefault();
      const x = e.pageX - el.offsetLeft;
      const walk = x - startX;
      // Determina se è un vero drag
      if (Math.abs(walk) > DRAG_THRESHOLD) {
        isDragging = true;
      }
      el.scrollLeft = startScrollLeft - walk * 1.5;
    };

    // Intercetta il click a fase di cattura: se è seguito da un drag, lo annulla
    const captureClick = (e) => {
      if (isDragging) {
        e.stopPropagation();
        e.preventDefault();
        isDragging = false; // reset per il prossimo click
      }
    };

    // Impostiamo il cursore di default su grab
    el.style.cursor = 'grab';

    el.addEventListener('mousedown', mouseDown);
    el.addEventListener('mouseleave', mouseLeave);
    el.addEventListener('mouseup', mouseUp);
    el.addEventListener('mousemove', mouseMove);
    // capture:true → viene eseguito PRIMA dei listener dei figli
    el.addEventListener('click', captureClick, true);

    return () => {
      el.removeEventListener('mousedown', mouseDown);
      el.removeEventListener('mouseleave', mouseLeave);
      el.removeEventListener('mouseup', mouseUp);
      el.removeEventListener('mousemove', mouseMove);
      el.removeEventListener('click', captureClick, true);
    };
  }, [ref, ...deps]);

  return ref;
}
