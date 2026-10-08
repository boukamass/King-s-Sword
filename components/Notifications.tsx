import React, { useEffect, useState } from 'react';
import { useAppStore } from '../store';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';
import { Notification as NotificationType } from '../types';

interface NotificationItemProps {
  notification: NotificationType;
  onDismiss: (id: string) => void;
}

const NotificationItem: React.FC<NotificationItemProps> = ({ notification, onDismiss }) => {
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    // Standards UX recommandés :
    // - Succès / Confirmations d'actions (ex: copié, enregistré, mis à jour) : 1800ms
    // - Informations : 2000ms
    // - Erreurs : 3200ms
    const duration = notification.type === 'error' ? 3200 : (notification.type === 'info' ? 2000 : 1800);

    const exitTimer = setTimeout(() => {
      setIsExiting(true);
    }, duration);

    const removeTimer = setTimeout(() => {
      onDismiss(notification.id);
    }, duration + 180);

    return () => {
      clearTimeout(exitTimer);
      clearTimeout(removeTimer);
    };
  }, [notification.id, notification.type, onDismiss]);

  const handleManualDismiss = () => {
    setIsExiting(true);
    setTimeout(() => onDismiss(notification.id), 120);
  };

  const getIcon = (type: 'success' | 'error' | 'info') => {
    switch (type) {
      case 'success': 
        return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />;
      case 'error': 
        return <AlertCircle className="w-3.5 h-3.5 text-rose-600" />;
      default: 
        return <Info className="w-3.5 h-3.5 text-blue-600" />;
    }
  };

  const getStyles = (type: 'success' | 'error' | 'info') => {
    if (type === 'success') {
      return {
        container: 'bg-white dark:bg-zinc-900 border-emerald-100 dark:border-emerald-900/40 ring-1 ring-emerald-500/10 border-l-emerald-500',
        text: 'text-zinc-900 dark:text-zinc-100',
        status: 'text-emerald-600 dark:text-emerald-400',
      };
    }
    if (type === 'info') {
      return {
        container: 'bg-white dark:bg-zinc-900 border-blue-100 dark:border-blue-900/40 ring-1 ring-blue-500/10 border-l-blue-500',
        text: 'text-zinc-900 dark:text-zinc-100',
        status: 'text-blue-600 dark:text-blue-400',
      };
    }
    return {
      container: 'bg-white dark:bg-zinc-900 border-rose-100 dark:border-rose-900/40 ring-1 ring-rose-500/10 border-l-rose-500',
      text: 'text-zinc-900 dark:text-zinc-100',
      status: 'text-rose-600 dark:text-rose-400',
    };
  };

  const styles = getStyles(notification.type);

  return (
    <div 
      className={`pointer-events-auto flex items-center gap-2.5 h-9 px-3 rounded-lg shadow-[0_2px_15px_rgba(0,0,0,0.08)] border border-l-4 transition-all duration-200 ease-out group ${styles.container} ${
        isExiting 
          ? 'opacity-0 translate-x-4 scale-95' 
          : 'animate-in slide-in-from-right-4 fade-in duration-200'
      }`}
    >
      <div className="shrink-0">
        {getIcon(notification.type)}
      </div>
      
      <div className="flex-1 min-w-0 flex items-center gap-1.5">
        <span className={`text-[8px] font-black uppercase tracking-tighter shrink-0 opacity-80 ${styles.status}`}>
          {notification.type === 'success' ? 'OK' : notification.type === 'info' ? 'INFO' : 'ERR'}
        </span>
        <p className={`text-[10px] font-bold truncate leading-none ${styles.text}`}>
          {notification.message}
        </p>
      </div>

      <button 
        onClick={handleManualDismiss} 
        className="shrink-0 p-1 rounded-md text-zinc-300 dark:text-zinc-600 hover:text-zinc-500 dark:hover:text-zinc-300 transition-colors active:scale-90 cursor-pointer"
        aria-label="Fermer la notification"
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
};

const Notifications: React.FC = () => {
  const { notifications, removeNotification } = useAppStore();

  if (!notifications || notifications.length === 0) return null;

  return (
    <div className="fixed bottom-6 right-6 z-[999999] w-full max-w-[300px] space-y-1.5 no-print pointer-events-none">
      {notifications.slice(0, 3).map(n => (
        <NotificationItem 
          key={n.id} 
          notification={n} 
          onDismiss={removeNotification} 
        />
      ))}
    </div>
  );
};

export default Notifications;
