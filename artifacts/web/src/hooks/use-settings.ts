import { useState, useEffect, useCallback } from 'react';
import {
  RiskSettings,
  DEFAULT_RISK_SETTINGS,
  loadRiskSettings,
  saveRiskBudget,
  saveCapital,
  saveMaxPositionPct,
  saveFeeDiscount,
} from '@/lib/settings';

export function useSettings() {
  const [settings, setSettings] = useState<RiskSettings>(DEFAULT_RISK_SETTINGS);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const loaded = await loadRiskSettings();
    setSettings(loaded);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const updateSettings = useCallback(
    async (newSettings: Partial<RiskSettings>) => {
      if (newSettings.riskBudget !== undefined) await saveRiskBudget(newSettings.riskBudget);
      if (newSettings.capital !== undefined) await saveCapital(newSettings.capital);
      if (newSettings.maxPositionPct !== undefined) await saveMaxPositionPct(newSettings.maxPositionPct);
      if (newSettings.feeDiscount !== undefined) await saveFeeDiscount(newSettings.feeDiscount);
      await refresh();
    },
    [refresh]
  );

  return { settings, updateSettings, loading };
}
