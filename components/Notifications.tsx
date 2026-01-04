
import React, { useEffect } from 'react';
import { useAppStore } from '../store';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

const Notifications: React.FC = () => {
  const { notifications, removeNotification } = useAppStore();

  useEffect(() => {
    const timers = notifications.map(notification => {
      return setTimeout(() => removeNotification(notification.id), 5000);
    });
    return () => timers.forEach(timer => clearTimeout(timer));
  }, [notifications, removeNotification]);

  const getIcon = (type: 'success' | 'error') => {
    switch (type) {
      case 'success': 
        return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />;
      case 'error': 
        return <AlertCircle className="w-3.5 h-3.5 text-rose-600" />;
      default: 
        return <Info className="w-3.5 h-3.5 text-blue-600" />;
    }
  };

  const getStyles = (type: 'success' | 'error') => {
    if (type === 'success') {
      return {
        container: 'bg-white border-emerald-100 ring-1 ring-emerald-500/10 border-l-emerald-500',
        text: 'text-zinc-900',
        status: 'text-emerald-600',
      };
    }
    return {
      container: 'bg-white border-rose-100 ring-1 ring-rose-500/10 border-l-rose-500',
      text: 'text-zinc-900',
      status: 'text-rose-600',
    };
  };

  return (
    <div className="fixed bottom-6 right-6 z-[999999] w-full max-w-[300px] space-y-1.5 no-print pointer-events-none">
      {notifications.map(n => {
        const styles = getStyles(n.type);
        return (
          <div 
            key={n.id} 
            className={`pointer-events-auto flex items-center gap-2.5 h-9 px-3 rounded-lg shadow-[0_2px_15px_rgba(0,0,0,0.05)] border border-l-4 animate-in slide-in-from-right-4 fade-in duration-250 ease-out group ${styles.container}`}
          >
            <div className="shrink-0">
              {getIcon(n.type)}
            </div>
            
            <div className="flex-1 min-w-0 flex items-center gap-1.5">
              <span className={`text-[8px] font-black uppercase tracking-tighter shrink-0 opacity-80 ${styles.status}`}>
                {n.type === 'success' ? 'OK' : 'ERR'}
              </span>
              <p className={`text-[10px] font-bold truncate leading-none ${styles.text}`}>
                {n.message}
              </p>
            </div>

            <button 
              onClick={() => removeNotification(n.id)} 
              className="shrink-0 p-1 rounded-md text-zinc-300 hover:text-zinc-500 transition-colors active:scale-90"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
};

export default Notifications;
