import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Route, Switch, Router as WouterRouter } from 'wouter';
import { ThemeProvider } from 'next-themes';
import Home from '@/pages/home';
import Analysis from '@/pages/analysis';
import NotFound from '@/pages/not-found';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { Disclaimer } from '@/components/disclaimer';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 個股明細依賴 FinMind，而免費層的每小時額度用盡是常態不是例外。
      // 先前是 retry: false，於是一次限流就等於那一檔永久失敗、卡片
      // 停在載入骨架上。退避重試兩次的成本遠低於少一檔的代價。
      retry: 2,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 5000),
      refetchOnWindowFocus: false,
    },
    mutations: {
      // /analyze 要 16~20 秒且會消耗 Gemini 配額，自動重試不划算 ——
      // 失敗時由畫面提供「重試」按鈕，讓使用者決定。
      retry: false,
    },
  },
});

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/analysis" component={Analysis} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" forcedTheme="dark">
      <QueryClientProvider client={queryClient}>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <div className="min-h-[100dvh] bg-background text-foreground selection:bg-primary/30 font-sans flex flex-col">
            <ErrorBoundary>
              <Router />
            </ErrorBoundary>
            <Disclaimer />
          </div>
          {/* 整套 toast 系統（use-toast 187 行 + toast.tsx + 這個元件）先前
              從未被掛載，而錯誤提示用的是三處原生 alert()。 */}
          <Toaster />
        </WouterRouter>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
