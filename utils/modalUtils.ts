import { useEffect } from 'react';

let activeModalsCount = 0;

/**
 * Hook to register an open modal and toggle the 'has-modal-open' class on document.body.
 * This guarantees that when any modal is open:
 * 1. Floating utility buttons (Note icon, AI icon) are hidden from view.
 * 2. Background toolbars and side docks remain fully covered and inert.
 */
export function useModalActive(isOpen: boolean) {
  useEffect(() => {
    if (!isOpen) return;
    activeModalsCount++;
    if (activeModalsCount === 1) {
      document.body.classList.add('has-modal-open');
    }
    return () => {
      activeModalsCount = Math.max(0, activeModalsCount - 1);
      if (activeModalsCount === 0) {
        document.body.classList.remove('has-modal-open');
      }
    };
  }, [isOpen]);
}
