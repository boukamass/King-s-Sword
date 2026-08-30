import React, { useState } from 'react';
import { ShieldAlert, KeyRound, Copy, Check, Lock, AlertCircle, RefreshCw } from 'lucide-react';

interface DeviceLockModalProps {
  machineId: string;
  onUnlocked: () => void;
}

export const DeviceLockModal: React.FC<DeviceLockModalProps> = ({ machineId, onUnlocked }) => {
  const [activationCode, setActivationCode] = useState('');
  const [copied, setCopied] = useState(false);
  const [isActivating, setIsActivating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleCopyMachineId = () => {
    if (machineId) {
      navigator.clipboard.writeText(machineId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleActivate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activationCode.trim()) return;

    setIsActivating(true);
    setErrorMessage(null);

    try {
      if (window.electronAPI?.security) {
        const res = await window.electronAPI.security.activateDevice(activationCode.trim());
        if (res.success) {
          onUnlocked();
        } else {
          setErrorMessage(res.error || "Code d'activation invalide pour cet appareil.");
        }
      }
    } catch (err: any) {
      setErrorMessage(err.message || "Erreur de communication lors de l'activation.");
    } finally {
      setIsActivating(false);
    }
  };

  return (
    <div id="device-lock-modal" className="fixed inset-0 z-[9999999] bg-zinc-950/90 backdrop-blur-xl flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl p-6 text-zinc-100 relative overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        <div className="absolute top-0 right-0 w-48 h-48 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="flex items-center gap-3 mb-5">
          <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-400 shrink-0">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-base font-black tracking-tight text-white">Appareil non autorisé</h2>
            <p className="text-xs text-zinc-400">Verrouillage de sécurité anti-copie</p>
          </div>
        </div>

        <div className="space-y-4 text-xs text-zinc-300">
          <p className="leading-relaxed">
            Cette copie de l&apos;application a été déplacée ou copiée depuis un autre ordinateur. Pour protéger l&apos;intégrité des données, l&apos;accès est restreint à cette machine.
          </p>

          <div className="p-3.5 bg-zinc-950 border border-zinc-800 rounded-xl space-y-1.5">
            <div className="flex items-center justify-between text-[11px] text-zinc-400 font-semibold uppercase tracking-wider">
              <span>Identifiant matériel de ce PC</span>
              <span className="flex items-center gap-1 text-teal-400">
                <Lock className="w-3 h-3" /> Unique
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <code className="text-sm font-mono font-black text-amber-400 tracking-wider">
                {machineId || 'KS-CHARGEMENT...'}
              </code>
              <button
                type="button"
                id="btn-copy-machine-id"
                onClick={handleCopyMachineId}
                className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 rounded-lg text-zinc-200 transition-colors"
                data-tooltip="Copier le code machine"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'Copié !' : 'Copier'}</span>
              </button>
            </div>
          </div>

          <form onSubmit={handleActivate} className="space-y-3 pt-2">
            <div>
              <label htmlFor="activation-code" className="block text-[11px] font-bold uppercase tracking-wider text-zinc-400 mb-1.5">
                Clé d&apos;autorisation / Code d&apos;activation
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-zinc-500">
                  <KeyRound className="w-4 h-4" />
                </div>
                <input
                  id="activation-code"
                  type="text"
                  value={activationCode}
                  onChange={(e) => setActivationCode(e.target.value.toUpperCase())}
                  placeholder="ACT-XXXX-XXXX"
                  className="w-full pl-9 pr-3 py-2.5 bg-zinc-950 border border-zinc-800 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 rounded-xl text-sm font-mono font-bold text-zinc-100 placeholder-zinc-600 outline-none uppercase transition-all tracking-wider"
                  autoFocus
                />
              </div>
            </div>

            {errorMessage && (
              <div className="flex items-center gap-2 p-2.5 bg-red-950/40 border border-red-800/60 rounded-xl text-red-300 text-xs animate-in fade-in">
                <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
                <span>{errorMessage}</span>
              </div>
            )}

            <button
              type="submit"
              id="btn-activate-device"
              disabled={isActivating || !activationCode.trim()}
              className="w-full py-2.5 px-4 bg-amber-500 hover:bg-amber-400 active:bg-amber-600 disabled:opacity-50 disabled:pointer-events-none text-zinc-950 font-black text-xs uppercase tracking-wider rounded-xl shadow-lg transition-all flex items-center justify-center gap-2"
            >
              {isActivating ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Validation en cours...</span>
                </>
              ) : (
                <>
                  <Lock className="w-4 h-4" />
                  <span>Activer pour cet ordinateur</span>
                </>
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
export default DeviceLockModal;
