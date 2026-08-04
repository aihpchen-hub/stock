import React from 'react';
import { PROFILES, VIEW_CONFIG, viewFor, type ViewProfile } from '@workspace/view-profile';
import { AlertTriangle } from 'lucide-react';

interface ProfileSwitcherProps {
  profile: ViewProfile;
  onChange: (next: ViewProfile) => void;
}

/**
 * 受眾切換器。
 *
 * 切換完全在前端完成 —— 不重新請求、不重算任何數字。同一份資料換一種
 * 呈現，因此是同步的：使用者按下去就看到結果，不必等 16~20 秒的分析。
 */
export function ProfileSwitcher({ profile, onChange }: ProfileSwitcherProps) {
  const view = viewFor(profile);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm text-muted-foreground shrink-0">看法</span>
        <div className="flex rounded-md border border-border overflow-hidden flex-wrap">
          {PROFILES.map((p) => {
            const selected = p === profile;
            return (
              <button
                key={p}
                type="button"
                aria-pressed={selected}
                onClick={() => onChange(p)}
                className={`px-3 py-1 text-sm transition-colors ${
                  selected
                    ? 'bg-foreground text-background font-bold'
                    : 'text-muted-foreground hover:bg-muted'
                }`}
              >
                {VIEW_CONFIG[p].label}
              </button>
            );
          })}
        </div>
        <span className="text-xs text-muted-foreground">{view.description}</span>
      </div>

      {/* 動能視圖必須標明資料延遲。少了這句，畫面等於默許使用者拿
          延遲一天的日線去做當沖。 */}
      {view.caveat && (
        <div className="text-xs text-amber-500/90 bg-amber-500/10 px-2 py-1.5 rounded flex items-start gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>{view.caveat}</span>
        </div>
      )}
    </div>
  );
}
