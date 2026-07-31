import { useLocation } from "wouter";
import { AlertCircle } from "lucide-react";

export default function NotFound() {
  const [, setLocation] = useLocation();

  return (
    <div className="flex w-full flex-col items-center justify-center min-h-[100dvh] bg-background">
      <AlertCircle className="h-16 w-16 text-destructive mb-4" />
      <h1 className="text-4xl font-bold text-foreground mb-2">404</h1>
      <p className="text-muted-foreground mb-8">找不到此頁面</p>
      <button
        onClick={() => setLocation('/')}
        className="px-6 py-2 bg-primary text-primary-foreground font-medium rounded-lg hover:bg-primary/90 transition-colors"
      >
        返回首頁
      </button>
    </div>
  );
}
