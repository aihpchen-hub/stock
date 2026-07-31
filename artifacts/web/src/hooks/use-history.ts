import { useState, useEffect, useCallback } from 'react';
import { HistoryMeta, loadIndex, remove, clearAll } from '@/lib/history';

export function useHistory() {
  const [history, setHistory] = useState<HistoryMeta[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const data = await loadIndex();
    setHistory(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const removeHistory = useCallback(async (id: string) => {
    await remove(id);
    await refresh();
  }, [refresh]);

  const clearHistory = useCallback(async () => {
    await clearAll();
    await refresh();
  }, [refresh]);

  return { history, refresh, removeHistory, clearHistory, loading };
}
