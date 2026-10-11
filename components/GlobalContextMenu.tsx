import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useAppStore } from '../store';
import { 
  Copy, 
  Search, 
  Sparkles, 
  NotebookPen, 
  CheckSquare
} from 'lucide-react';

interface ContextMenuState {
  x: number;
  y: number;
  selectedText: string;
  targetElement: HTMLElement | null;
}

export const GlobalContextMenu: React.FC = () => {
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const {
    addNotification,
    setSearchQuery,
    setSidebarOpen,
    setAiOpen,
    activeSermon,
    notes,
    addCitationToNote
  } = useAppStore();

  const handleClose = useCallback(() => {
    setMenu(null);
  }, []);

  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      
      // Laisser passer le clic droit si Shift est enfoncé (menu natif du navigateur)
      if (e.shiftKey) {
        return;
      }

      // Laisser passer le clic droit sur certains éléments avec exception explicite
      if (target.closest('[data-no-context-menu]')) {
        return;
      }

      // Résolution de l'élément éditable (input, textarea, contenteditable)
      let editableTarget: HTMLElement | null = target.closest('input, textarea, [contenteditable="true"]');

      if (!editableTarget) {
        const container = target.closest('.relative, form, [role="form"], label');
        if (container) {
          editableTarget = container.querySelector('input, textarea, [contenteditable="true"]');
        }
      }

      if (!editableTarget && document.activeElement && (
        document.activeElement instanceof HTMLInputElement || 
        document.activeElement instanceof HTMLTextAreaElement || 
        (document.activeElement as HTMLElement).isContentEditable
      )) {
        editableTarget = document.activeElement as HTMLElement;
      }

      // VÉRIFICATION CRUCIALE : Si l'utilisateur fait un clic droit dans ou sur un champ de texte (Assistant IA, Recherche, Notes...)
      // On autorise le MENU CONTEXTUEL NATIF DU NAVIGATEUR.
      // Le menu natif a les permissions système pour "Coller" directement le contenu du presse-papier sans blocage de sécurité.
      if (editableTarget) {
        try {
          editableTarget.focus();
        } catch {
          // Ignorer si déjà ciblé
        }
        setMenu(null);
        return; // NE PAS appeler e.preventDefault() -> le menu natif "Coller" s'ouvre !
      }

      // Pour les éléments non-éditables (texte des sermons, extraits, cartes), afficher notre menu universel
      const sel = window.getSelection();
      const selectedText = sel ? sel.toString().trim() : '';

      let textForMenu = selectedText;
      if (!textForMenu) {
        const textContainer = target.closest('p, .serif-text, .prose-styles, [data-seg-idx], span');
        if (textContainer && textContainer.textContent) {
          const raw = textContainer.textContent.trim();
          if (raw.length > 0 && raw.length < 500) {
            textForMenu = raw;
          }
        }
      }

      // Empêcher le menu contextuel par défaut pour les zones non-éditables et afficher notre menu d'actions
      e.preventDefault();

      const menuWidth = 220;
      const menuHeight = 180;

      let posX = e.clientX;
      let posY = e.clientY;

      if (posX + menuWidth > window.innerWidth - 10) {
        posX = window.innerWidth - menuWidth - 10;
      }
      if (posY + menuHeight > window.innerHeight - 10) {
        posY = window.innerHeight - menuHeight - 10;
      }
      if (posX < 10) posX = 10;
      if (posY < 10) posY = 10;

      setMenu({
        x: posX,
        y: posY,
        selectedText: textForMenu,
        targetElement: target
      });
    };

    const handleGlobalClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        handleClose();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose();
      }
    };

    const handleScroll = () => {
      handleClose();
    };

    window.addEventListener('contextmenu', handleContextMenu);
    window.addEventListener('mousedown', handleGlobalClick);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      window.removeEventListener('contextmenu', handleContextMenu);
      window.removeEventListener('mousedown', handleGlobalClick);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('scroll', handleScroll);
    };
  }, [handleClose]);

  const applyReactValue = (el: HTMLInputElement | HTMLTextAreaElement, newValue: string) => {
    const prototype = el instanceof HTMLInputElement 
      ? window.HTMLInputElement.prototype 
      : window.HTMLTextAreaElement.prototype;
    
    const valueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    
    if (valueSetter) {
      valueSetter.call(el, newValue);
    } else {
      el.value = newValue;
    }

    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };

  const handleCopy = async () => {
    if (menu?.selectedText) {
      try {
        await navigator.clipboard.writeText(menu.selectedText);
        addNotification("Texte copié dans le presse-papier", "success");
      } catch (err) {
        document.execCommand('copy');
        addNotification("Texte copié", "success");
      }
    }
    handleClose();
  };

  const handleSelectAll = () => {
    const sel = window.getSelection();
    const range = document.createRange();
    if (menu?.targetElement) {
      range.selectNodeContents(menu.targetElement);
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
    handleClose();
  };

  const handleSearchInSermons = () => {
    if (menu?.selectedText) {
      setSearchQuery(menu.selectedText.slice(0, 120));
      setSidebarOpen(true);
    }
    handleClose();
  };

  const handleAskAI = () => {
    if (menu?.selectedText) {
      setAiOpen(true);
      setTimeout(() => {
        const aiInput = document.querySelector('textarea[placeholder*="POSEZ"]') as HTMLTextAreaElement;
        if (aiInput) {
          applyReactValue(aiInput, menu.selectedText);
          aiInput.focus();
        }
      }, 50);
    }
    handleClose();
  };

  const handleAddToActiveNote = () => {
    if (menu?.selectedText && notes.length > 0) {
      const activeNote = notes[0];
      addCitationToNote(activeNote.id, {
        id: `cit-${Date.now()}`,
        sermon_id: activeSermon?.id || 'note-cit',
        sermon_title_snapshot: activeSermon?.title || 'Extrait sélectionné',
        sermon_date_snapshot: activeSermon?.date || new Date().toISOString().split('T')[0],
        sermon_version_snapshot: activeSermon?.version,
        quoted_text: menu.selectedText,
        date_added: new Date().toISOString(),
        paragraph_index: 1
      });
      addNotification(`Extrait ajouté à la note "${activeNote.title}"`, "success");
    } else if (menu?.selectedText) {
      addNotification("Aucune note active : ouvrez le panneau de notes", "info");
    }
    handleClose();
  };

  return (
    <>
      {menu && (
        <div
          ref={menuRef}
          style={{ left: `${menu.x}px`, top: `${menu.y}px` }}
          className="fixed z-[9999999] min-w-[210px] bg-white dark:bg-zinc-900 rounded-2xl shadow-[0_10px_35px_rgba(0,0,0,0.18)] border border-zinc-200/80 dark:border-zinc-800 p-1.5 text-zinc-800 dark:text-zinc-200 text-[12px] font-medium animate-in fade-in zoom-in-95 duration-100 ease-out select-none"
        >
          {Boolean(menu.selectedText && menu.selectedText.trim().length > 0) && (
            <button
              onClick={handleCopy}
              className="w-full flex items-center justify-between px-3 py-2 rounded-xl hover:bg-teal-50 dark:hover:bg-teal-950/60 text-zinc-900 dark:text-zinc-100 hover:text-teal-700 dark:hover:text-teal-300 transition-colors cursor-pointer group"
            >
              <div className="flex items-center gap-2.5">
                <Copy className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400 group-hover:scale-110 transition-transform" />
                <span className="font-bold">Copier</span>
              </div>
              <span className="text-[10px] font-mono text-zinc-400">Ctrl+C</span>
            </button>
          )}

          <button
            onClick={handleSelectAll}
            className="w-full flex items-center justify-between px-3 py-2 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-2.5">
              <CheckSquare className="w-3.5 h-3.5 text-zinc-400" />
              <span>Tout sélectionner</span>
            </div>
            <span className="text-[10px] font-mono text-zinc-400">Ctrl+A</span>
          </button>

          {Boolean(menu.selectedText && menu.selectedText.trim().length > 0) && (
            <>
              <div className="my-1 border-t border-zinc-100 dark:border-zinc-800" />

              <button
                onClick={handleSearchInSermons}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-teal-50 dark:hover:bg-teal-950/60 text-teal-900 dark:text-teal-200 hover:text-teal-700 dark:hover:text-teal-300 font-semibold transition-colors cursor-pointer group"
              >
                <Search className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400 group-hover:scale-110 transition-transform" />
                <span className="truncate">Rechercher dans les sermons</span>
              </button>

              <button
                onClick={handleAskAI}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-teal-50 dark:hover:bg-teal-950/60 text-teal-900 dark:text-teal-200 hover:text-teal-700 dark:hover:text-teal-300 font-semibold transition-colors cursor-pointer group"
              >
                <Sparkles className="w-3.5 h-3.5 text-amber-500 group-hover:scale-110 transition-transform" />
                <span className="truncate">Poser à l'Assistant IA</span>
              </button>

              <button
                onClick={handleAddToActiveNote}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-emerald-50 dark:hover:bg-emerald-950/60 text-emerald-900 dark:text-emerald-200 hover:text-emerald-700 dark:hover:text-emerald-300 font-semibold transition-colors cursor-pointer group"
              >
                <NotebookPen className="w-3.5 h-3.5 text-emerald-600 group-hover:scale-110 transition-transform" />
                <span className="truncate">Ajouter à mes Notes</span>
              </button>
            </>
          )}
        </div>
      )}
    </>
  );
};

export default GlobalContextMenu;

