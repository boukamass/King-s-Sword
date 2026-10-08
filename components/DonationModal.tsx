import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useModalActive } from '../utils/modalUtils';
import { useAppStore } from '../store';
import { 
  X, 
  Heart, 
  Copy, 
  Check, 
  Smartphone, 
  Mail, 
  BookOpen,
  ExternalLink
} from 'lucide-react';

interface DonationModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const DonationModal: React.FC<DonationModalProps> = ({ isOpen, onClose }) => {
  useModalActive(isOpen);

  const addNotification = useAppStore(s => s.addNotification);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setCopiedKey(null);
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const copyToClipboard = (text: string, label: string, key: string) => {
    try {
      navigator.clipboard.writeText(text);
      setCopiedKey(key);
      addNotification(`${label} copié dans le presse-papiers`, 'success');
      setTimeout(() => {
        setCopiedKey(null);
      }, 2500);
    } catch {
      addNotification("Impossible de copier automatiquement", 'error');
    }
  };

  return createPortal(
    <div 
      className="fixed inset-0 z-[250000] flex items-center justify-center p-3 sm:p-4 bg-black/75 backdrop-blur-md animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div 
        className="relative w-full max-w-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-200 text-zinc-800 dark:text-zinc-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-zinc-200/80 dark:border-zinc-800/80 bg-zinc-50/70 dark:bg-zinc-950/60">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-rose-500/10 dark:bg-rose-500/20 text-rose-600 dark:text-rose-400 border border-rose-500/20 flex items-center justify-center shrink-0 shadow-xs">
              <Heart className="w-5 h-5 fill-rose-500/20" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm sm:text-base font-black tracking-tight text-zinc-900 dark:text-zinc-50 uppercase">
                Soutenir le Projet
              </h2>
              <p className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 truncate">
                King's Sword — Contribution bénévole
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-200/50 dark:hover:bg-zinc-800 rounded-xl transition-colors cursor-pointer"
            data-tooltip="Fermer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="p-5 sm:p-6 space-y-5 custom-scrollbar overflow-y-auto max-h-[75vh]">
          
          {/* Spiritual introduction banner */}
          <div className="p-4 bg-teal-500/10 dark:bg-teal-500/15 border border-teal-500/20 rounded-2xl space-y-2">
            <div className="flex items-center gap-2 text-teal-800 dark:text-teal-300 font-bold text-xs uppercase tracking-wider">
              <BookOpen className="w-4 h-4" />
              <span>Un outil gratuit pour l'Épouse</span>
            </div>
            <p className="text-xs sm:text-[12.5px] leading-relaxed text-zinc-700 dark:text-zinc-300">
              King's Sword est un logiciel chrétien indépendant, entièrement libre et sans publicité. Il est mis à disposition pour faciliter la recherche doctrinale et la méditation des Écritures et des sermons du prophète William Marrion Branham.
            </p>
            <p className="text-xs sm:text-[12px] leading-relaxed text-zinc-600 dark:text-zinc-400 italic pt-1 border-t border-teal-500/20">
              « Que chacun donne comme il l'a résolu en son cœur, sans tristesse ni contrainte ; car Dieu aime celui qui donne avec joie. » — 2 Corinthiens 9:7
            </p>
          </div>

          <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
            Si cette œuvre vous est utile et que le Seigneur vous met à cœur de participer bénévolement à son développement et son amélioration continue, voici le moyen mis à votre disposition :
          </p>

          {/* Payment & Support Channels */}
          <div className="space-y-3">
            
            {/* 1. Mobile Money (Airtel & MTN) */}
            <div className="p-4 bg-slate-50 dark:bg-zinc-950/60 border border-slate-200/80 dark:border-zinc-800 rounded-2xl transition-all hover:border-teal-500/40">
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-teal-600/10 text-teal-600 dark:text-teal-400 border border-teal-600/20 flex items-center justify-center shrink-0">
                    <Smartphone className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-xs font-black text-zinc-900 dark:text-zinc-100 uppercase tracking-wide">
                      Mobile Money (Airtel Money / MTN)
                    </h3>
                    <p className="text-[10.5px] text-zinc-500 dark:text-zinc-400">
                      Congo, Afrique & transferts internationaux (WorldRemit, TapTap Send, etc.)
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-3 p-2.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl flex items-center justify-between gap-2">
                <div className="min-w-0 pl-1">
                  <div className="text-[10px] uppercase font-bold text-zinc-400 tracking-wider">Bénéficiaire : Bienvenu Massamba</div>
                  <div className="font-mono text-sm font-extrabold text-teal-700 dark:text-teal-400 tracking-tight">
                    +242 06 818 95 94
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => copyToClipboard('+242068189594', 'Numéro Mobile Money', 'momo')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-teal-700 dark:text-teal-300 bg-teal-50 dark:bg-teal-950/60 hover:bg-teal-100 dark:hover:bg-teal-900/60 border border-teal-200 dark:border-teal-800/80 transition-all cursor-pointer shadow-2xs"
                >
                  {copiedKey === 'momo' ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                      <span className="text-emerald-700 dark:text-emerald-400">Copié</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copier</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* 2. Correspondance & Contact Direct */}
            <div className="p-4 bg-slate-50 dark:bg-zinc-950/60 border border-slate-200/80 dark:border-zinc-800 rounded-2xl transition-all hover:border-teal-500/40">
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-emerald-600/10 text-emerald-600 dark:text-emerald-400 border border-emerald-600/20 flex items-center justify-center shrink-0">
                    <Mail className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-xs font-black text-zinc-900 dark:text-zinc-100 uppercase tracking-wide">
                      Correspondance & Contact
                    </h3>
                    <p className="text-[10.5px] text-zinc-500 dark:text-zinc-400">
                      Pour toute correspondance, question ou échange direct
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-3 p-2.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl flex items-center justify-between gap-2">
                <div className="min-w-0 pl-1">
                  <div className="text-[10px] uppercase font-bold text-zinc-400 tracking-wider">Email de correspondance</div>
                  <div className="font-mono text-xs sm:text-sm font-extrabold text-emerald-700 dark:text-emerald-400 truncate">
                    boukamass@gmail.com
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => copyToClipboard('boukamass@gmail.com', 'Adresse email', 'email')}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/60 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 border border-emerald-200 dark:border-emerald-800/80 transition-all cursor-pointer shadow-2xs"
                  >
                    {copiedKey === 'email' ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                        <span className="text-emerald-700 dark:text-emerald-400">Copié</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copier</span>
                      </>
                    )}
                  </button>
                  <a
                    href="mailto:boukamass@gmail.com?subject=Correspondance%20King%27s%20Sword"
                    className="inline-flex items-center justify-center p-1.5 rounded-lg text-zinc-500 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 border border-transparent hover:border-emerald-200 transition-all"
                    data-tooltip="Envoyer un email"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </a>
                </div>
              </div>
            </div>

          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-5 sm:px-6 py-3.5 border-t border-zinc-200/80 dark:border-zinc-800/80 bg-zinc-50/70 dark:bg-zinc-950/60 flex items-center justify-end gap-3 text-xs">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 font-bold hover:opacity-90 transition-opacity cursor-pointer shadow-xs"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
