import React from 'react';
import { X, ShieldCheck, FileText, Lock, BookOpen, AlertCircle, Copy, Code, Sparkles, Phone, Mail } from 'lucide-react';
import { APP_VERSION } from '../utils/version';

interface TermsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const TermsModal: React.FC<TermsModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-in fade-in duration-200">
      <div 
        className="relative w-full max-w-2xl max-h-[85vh] bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/80">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-teal-600/10 border border-teal-600/20 flex items-center justify-center text-teal-600 dark:text-teal-400">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-black tracking-wider text-zinc-900 dark:text-zinc-100 uppercase">
                Termes & Conditions d'Utilisation
              </h2>
              <p className="text-[10.5px] font-medium text-zinc-500 dark:text-zinc-400">
                King's Sword — Logiciel d'étude spirituelle & d'édification
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-200/50 dark:hover:bg-zinc-800 rounded-lg transition-colors"
            title="Fermer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 text-xs text-zinc-700 dark:text-zinc-300 leading-relaxed scrollbar-thin scrollbar-thumb-zinc-300 dark:scrollbar-thumb-zinc-700">
          
          {/* Introduction */}
          <div className="p-3.5 bg-teal-500/10 border border-teal-500/20 rounded-xl flex items-start gap-3">
            <BookOpen className="w-5 h-5 text-teal-600 dark:text-teal-400 shrink-0 mt-0.5" />
            <p className="text-[11.5px] text-zinc-800 dark:text-zinc-200 font-medium leading-relaxed">
              L'application <strong>King's Sword</strong> a été créée pour l'édification de l'Épouse de Jésus-Christ, en facilitant la lecture, l'étude approfondie et la diffusion des sermons du frère William Marrion Branham ainsi que de la Sainte Bible.
            </p>
          </div>

          {/* Section 1: Usage & Droits de Copie */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-zinc-900 dark:text-zinc-100 font-bold uppercase tracking-wider text-[11px]">
              <Copy className="w-4 h-4 text-teal-600 dark:text-teal-400" />
              <span>1. Droit de Copie, Partage & Gratuité</span>
            </div>
            <div className="pl-6 space-y-1.5 text-[11px] text-zinc-600 dark:text-zinc-400">
              <p>
                • <strong>Gratuité absolue :</strong> Ce logiciel et l'accès aux textes sont fournis gratuitement. Aucune partie de ce contenu ne peut être vendue, louée ou commercialisée sous quelque forme que ce soit.
              </p>
              <p>
                • <strong>Copie & Partage :</strong> Vous êtes vivement encouragé(e) à copier, partager et diffuser les citations, extraits de prédications et versets bibliques à des fins d'édification spirituelle, d'enseignement ou d'évangélisation.
              </p>
            </div>
          </div>

          {/* Section 2: Intégrité & Non-Modification */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-zinc-900 dark:text-zinc-100 font-bold uppercase tracking-wider text-[11px]">
              <FileText className="w-4 h-4 text-teal-600 dark:text-teal-400" />
              <span>2. Intégrité des Textes & Interdiction de Modification</span>
            </div>
            <div className="pl-6 space-y-1.5 text-[11px] text-zinc-600 dark:text-zinc-400">
              <p>
                • <strong>Respect de la lettre :</strong> Il est strictement interdit d'altérer, déformer, tronquer abusivement ou modifier le texte original des sermons du frère William Marrion Branham ou des Écritures.
              </p>
              <p>
                • <strong>Fidélité des citations :</strong> Toute citation copiée ou projetée depuis l'application doit conserver son exactitude originelle afin d'éviter toute mauvaise interprétation ou falsification de la Parole.
              </p>
            </div>
          </div>

          {/* Section 3: Modification & Code du Logiciel */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-zinc-900 dark:text-zinc-100 font-bold uppercase tracking-wider text-[11px]">
              <Code className="w-4 h-4 text-teal-600 dark:text-teal-400" />
              <span>3. Utilisation & Adaptations du Logiciel</span>
            </div>
            <p className="pl-6 text-[11px] text-zinc-600 dark:text-zinc-400">
              King's Sword est conçu comme un outil de travail pour le Corps de Christ. Toute redistribution ou adaptation technique du logiciel doit maintenir la vocation spirituelle non commerciale et respecter l'intégrité des bases de données intégrées (prédications, bibles, exposés et cantiques).
            </p>
          </div>

          {/* Section 4: Confidentialité & Données */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-zinc-900 dark:text-zinc-100 font-bold uppercase tracking-wider text-[11px]">
              <Lock className="w-4 h-4 text-teal-600 dark:text-teal-400" />
              <span>4. Protection de la Vie Privée & Données Locales</span>
            </div>
            <p className="pl-6 text-[11px] text-zinc-600 dark:text-zinc-400">
              Vos annotations, notes personnelles, surlignages, historiques de recherche et prédications favorites sont enregistrés exclusivement en local sur votre appareil. Aucune donnée personnelle n'est collectée ni vendue.
            </p>
          </div>

          {/* Section 5: Assistant IA */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-zinc-900 dark:text-zinc-100 font-bold uppercase tracking-wider text-[11px]">
              <Sparkles className="w-4 h-4 text-teal-600 dark:text-teal-400" />
              <span>5. Assistant IA & Recherche Algorithmique</span>
            </div>
            <p className="pl-6 text-[11px] text-zinc-600 dark:text-zinc-400">
              L'assistant de recherche IA est un outil d'aide à la recherche textuelle et à la synthèse. Les réponses générées servent de repère d'étude et doivent systématiquement être vérifiées avec les textes officiels originaux.
            </p>
          </div>

          {/* Section 6: Mode Projection */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-zinc-900 dark:text-zinc-100 font-bold uppercase tracking-wider text-[11px]">
              <AlertCircle className="w-4 h-4 text-teal-600 dark:text-teal-400" />
              <span>6. Usage en Assemblée & Projection</span>
            </div>
            <p className="pl-6 text-[11px] text-zinc-600 dark:text-zinc-400">
              L'utilisation du mode projection pendant les cultes et réunions doit se faire dans le respect du calme de l'assemblée et de l'harmonie de l'édification collective.
            </p>
          </div>

          {/* Credits, Contact & Date */}
          <div className="pt-4 border-t border-zinc-200 dark:border-zinc-800 text-[10.5px] text-zinc-500 dark:text-zinc-400 text-center space-y-2">
            <p className="font-bold text-zinc-700 dark:text-zinc-200 uppercase tracking-wider">King's Sword — Version {APP_VERSION}</p>
            <p className="text-[10px] text-zinc-500">Vision de l'Aigle Tabernacle, Koufoli, PNR, Congo</p>
            <div className="p-2.5 bg-zinc-100 dark:bg-zinc-800/60 rounded-xl flex flex-wrap items-center justify-center gap-4 text-xs font-semibold text-teal-700 dark:text-teal-300">
              <span className="flex items-center gap-1.5">
                <Phone className="w-3.5 h-3.5" />
                <span>Tel : +242068189594</span>
              </span>
              <span className="flex items-center gap-1.5">
                <Mail className="w-3.5 h-3.5" />
                <span>Email : boukamass@gmail.com</span>
              </span>
            </div>
          </div>

        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/80 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 bg-teal-600 hover:bg-teal-500 text-white font-bold text-xs rounded-xl shadow-md hover:shadow-lg transition-all active:scale-95 uppercase tracking-wider cursor-pointer"
          >
            J'accepte & J'ai compris
          </button>
        </div>
      </div>
    </div>
  );
};

