import { Component, ReactNode, ErrorInfo } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught Error in Kings Sword Application:', error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen w-full bg-zinc-950 text-zinc-100 flex items-center justify-center p-6 font-sans">
          <div className="max-w-md w-full bg-zinc-900 border border-zinc-800 rounded-3xl p-8 shadow-2xl text-center animate-in fade-in duration-300">
            <div className="w-16 h-16 bg-amber-500/10 rounded-2xl border border-amber-500/20 flex items-center justify-center mx-auto mb-5 text-amber-400">
              <AlertTriangle className="w-8 h-8" />
            </div>

            <h2 className="text-xl font-black mb-2 text-zinc-100 tracking-tight">
              Anomalie temporaire détectée
            </h2>
            
            <p className="text-xs text-zinc-400 mb-6 leading-relaxed">
              L'application a intercepté une erreur inattendue et s'est protégée contre tout ralentissement ou blocage.
            </p>

            {this.state.error?.message && (
              <div className="mb-6 p-3 bg-zinc-950/80 border border-zinc-800/80 rounded-xl text-[11px] font-mono text-amber-300/90 text-left overflow-x-auto max-h-24 custom-scrollbar">
                {this.state.error.message}
              </div>
            )}

            <div className="flex items-center gap-3 justify-center">
              <button
                onClick={this.handleReset}
                className="flex items-center justify-center gap-2 px-5 py-2.5 bg-teal-600 hover:bg-teal-500 text-white text-xs font-black rounded-xl transition-all shadow-lg shadow-teal-600/30 cursor-pointer active:scale-95"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Rétablir l'application
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
