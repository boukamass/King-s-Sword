import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useAppStore } from '../store';
import { 
  Copy, 
  Scissors, 
  ClipboardPaste, 
  Search, 
  Sparkles, 
  NotebookPen, 
  CheckSquare,
  FileText
} from 'lucide-react';

interface ContextMenuState {
  x: number;
  y: number;
  selectedText: string;
  isInput: boolean;
  isEditable: boolean;
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
      
      // Laisser passer le clic droit sur certains éléments de debug ou exceptions explicites
      if (target.closest('[data-no-context-menu]')) {
        return;
      }

      const sel = window.getSelection();
      const selectedText = sel ? sel.toString().trim() : '';

      const isInput = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
      const isEditable = target.isContentEditable || isInput;

      // Si du texte est sélectionné, ou si c'est un champ de saisie, ou si l'utilisateur clique sur du texte
      let textForMenu = selectedText;
      if (!textForMenu && isInput) {
        textForMenu = (target as HTMLInputElement | HTMLTextAreaElement).value || '';
      }

      // Si aucun texte n'est sélectionné et pas d'input, tenter de récupérer le texte du paragraphe ou bloc cliqué
      if (!textForMenu) {
        const textContainer = target.closest('p, .serif-text, .prose-styles, [data-seg-idx], span');
        if (textContainer && textContainer.textContent) {
          const raw = textContainer.textContent.trim();
          if (raw.length > 0 && raw.length < 500) {
            textForMenu = raw;
          }
        }
      }

      // Empêcher le menu contextuel par défaut et afficher notre menu fluide universel
      e.preventDefault();

      const menuWidth = 220;
      const menuHeight = 220;

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
        isInput,
        isEditable,
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

  if (!menu) return null;

  const handleCopy = async () => {
    if (menu.selectedText) {
      try {
        await navigator.clipboard.writeText(menu.selectedText);
        addNotification("Texte copié dans le presse-papier", "success");
      } catch (err) {
        // Fallback document.execCommand
        document.execCommand('copy');
        addNotification("Texte copié", "success");
      }
    }
    handleClose();
  };

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

  const handleCut = async () => {
    if ((menu.isInput || menu.isEditable) && menu.targetElement) {
      const el = menu.targetElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        const inputEl = el;
        const start = inputEl.selectionStart || 0;
        const end = inputEl.selectionEnd || 0;
        const val = inputEl.value;
        const selectedPart = val.substring(start, end);
        
        if (selectedPart) {
          try {
            await navigator.clipboard.writeText(selectedPart);
          } catch {
            document.execCommand('cut');
          }
          const newValue = val.substring(0, start) + val.substring(end);
          applyReactValue(inputEl, newValue);
          inputEl.selectionStart = inputEl.selectionEnd = start;
          addNotification("Texte coupé", "info");
        }
      } else if (el.isContentEditable) {
        document.execCommand('cut');
        addNotification("Texte coupé", "info");
      }
    }
    handleClose();
  };

  const handlePaste = async () => {
    // Fermer immédiatement le menu contextuel dès le clic sur l'action
    const currentTarget = menu.targetElement;
    const isInputTarget = menu.isInput;
    const isEditableTarget = menu.isEditable;
    handleClose();

    if ((isInputTarget || isEditableTarget) && currentTarget) {
      const el = currentTarget as HTMLElement;

      // 1. Restaurer la focalisation sur l'élément cible
      if ('focus' in el && typeof el.focus === 'function') {
        el.focus();
      }

      let pasteText = '';

      // 2. Essayer de lire le presse-papier via l'API Clipboard
      try {
        if (navigator.clipboard && typeof navigator.clipboard.readText === 'function') {
          pasteText = await navigator.clipboard.readText();
        }
      } catch (err) {
        console.warn('[ContextMenu] navigator.clipboard.readText a échoué:', err);
      }

      // 3. Insérer le texte collé s'il a été récupéré
      if (pasteText) {
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
          const inputEl = el;
          const start = inputEl.selectionStart ?? inputEl.value.length;
          const end = inputEl.selectionEnd ?? inputEl.value.length;
          const val = inputEl.value;
          const newValue = val.substring(0, start) + pasteText + val.substring(end);

          applyReactValue(inputEl, newValue);
          const newPos = start + pasteText.length;
          inputEl.setSelectionRange(newPos, newPos);
        } else if (el.isContentEditable) {
          document.execCommand('insertText', false, pasteText);
        }
        addNotification("Texte collé", "success");
        return;
      }

      // 4. Repli via document.execCommand('paste')
      try {
        const success = document.execCommand('paste');
        if (success) {
          addNotification("Texte collé", "success");
          return;
        }
      } catch (err) {
        console.warn('[ContextMenu] execCommand paste a échoué:', err);
      }
    }
  };

  const handleSelectAll = () => {
    if (menu.isInput && menu.targetElement) {
      (menu.targetElement as HTMLInputElement | HTMLTextAreaElement).select();
    } else {
      const sel = window.getSelection();
      const range = document.createRange();
      if (menu.targetElement) {
        range.selectNodeContents(menu.targetElement);
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
    }
    handleClose();
  };

  const handleSearchInSermons = () => {
    if (menu.selectedText) {
      setSearchQuery(menu.selectedText.slice(0, 120));
      setSidebarOpen(true);
    }
    handleClose();
  };

  const handleAskAI = () => {
    if (menu.selectedText) {
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
    if (menu.selectedText && notes.length > 0) {
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
    } else if (menu.selectedText) {
      addNotification("Aucune note active : ouvrez le panneau de notes", "info");
    }
    handleClose();
  };

  const hasText = Boolean(menu.selectedText && menu.selectedText.trim().length > 0);

  return (
    <div
      ref={menuRef}
      style={{ left: `${menu.x}px`, top: `${menu.y}px` }}
      className="fixed z-[9999999] min-w-[210px] bg-white dark:bg-zinc-900 rounded-2xl shadow-[0_10px_35px_rgba(0,0,0,0.18)] border border-zinc-200/80 dark:border-zinc-800 p-1.5 text-zinc-800 dark:text-zinc-200 text-[12px] font-medium animate-in fade-in zoom-in-95 duration-100 ease-out select-none"
    >
      {/* 1. Actions d'édition & Copie */}
      {hasText && (
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

      {(menu.isInput || menu.isEditable) && hasText && (
        <button
          onClick={handleCut}
          className="w-full flex items-center justify-between px-3 py-2 rounded-xl hover:bg-teal-50 dark:hover:bg-teal-950/60 text-zinc-900 dark:text-zinc-100 hover:text-teal-700 dark:hover:text-teal-300 transition-colors cursor-pointer group"
        >
          <div className="flex items-center gap-2.5">
            <Scissors className="w-3.5 h-3.5 text-zinc-500 group-hover:scale-110 transition-transform" />
            <span>Couper</span>
          </div>
          <span className="text-[10px] font-mono text-zinc-400">Ctrl+X</span>
        </button>
      )}

      {(menu.isInput || menu.isEditable) && (
        <button
          onClick={handlePaste}
          className="w-full flex items-center justify-between px-3 py-2 rounded-xl hover:bg-teal-50 dark:hover:bg-teal-950/60 text-zinc-900 dark:text-zinc-100 hover:text-teal-700 dark:hover:text-teal-300 transition-colors cursor-pointer group"
        >
          <div className="flex items-center gap-2.5">
            <ClipboardPaste className="w-3.5 h-3.5 text-zinc-500 group-hover:scale-110 transition-transform" />
            <span>Coller</span>
          </div>
          <span className="text-[10px] font-mono text-zinc-400">Ctrl+V</span>
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

      {/* Séparateur pour les actions d'étude */}
      {hasText && (
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
  );
};

export default GlobalContextMenu;
