import React from 'react';
import { AlertTriangle } from 'lucide-react';

/**
 * 全站的最後一道防線。
 *
 * 先前完全沒有這個東西，而程式碼裡至少三處註解（chips-panel、verifyStore、
 * signal-list）都寫著「整個 app 沒有 ErrorBoundary」，然後各自做了一份
 * 防禦性查表。逐點防守擋得住已經想到的那幾種，擋不住沒想到的：
 * 任何一個元件在 render 期間丟例外 —— 一個 null 欄位被 .toFixed、一筆
 * 三個月前存下的殘缺快照 —— React 就會卸載整棵樹，畫面全白，
 * 連「返回首頁」都沒有，主控台以外沒有任何線索。
 *
 * 這裡刻意不做「重試同一個畫面」：會丟例外的多半是資料本身的形狀有問題，
 * 重新 render 只會再丟一次。給的是離開這個畫面的出口。
 */
interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo) {
    // 保留原始堆疊供開發時追查；正式環境沒有錯誤回報服務，至少主控台看得到
    console.error('Unhandled render error', error, info.componentStack);
  }

  override render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex-1 flex items-center justify-center p-6 min-h-[60vh]">
        <div className="bg-card border border-border rounded-2xl p-8 max-w-md w-full space-y-4 shadow-lg">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-6 h-6 text-destructive shrink-0" />
            <h1 className="text-xl font-bold">這個畫面出了點問題</h1>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">
            多半是某一筆分析結果的資料格式異常 —— 有可能是很久以前存下的查詢紀錄。
            回首頁重新查一次通常就正常了。
          </p>
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer select-none">技術細節</summary>
            <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-[11px]">
              {error.message}
            </pre>
          </details>
          <button
            type="button"
            onClick={() => {
              // 直接換頁而不是 setState —— 壞的是資料，重新 render 只會再丟一次
              window.location.href = '/';
            }}
            className="w-full py-2.5 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg font-medium transition-colors"
          >
            回首頁
          </button>
        </div>
      </div>
    );
  }
}
