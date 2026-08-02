"use client";

import { useEffect, useState } from "react";
import {
  clearQueryAudit,
  getQueryAuditSummary,
  isQueryAuditEnabled,
  QUERY_AUDIT_EVENT,
  type QueryAuditSummary
} from "@/lib/queryAudit";

/** debugQueries를 명시적으로 켠 개발 화면에서만 보이는 요청 요약 패널입니다. */
export function QueryAuditPanel() {
  const [enabled, setEnabled] = useState(false);
  const [summary, setSummary] = useState<QueryAuditSummary[]>([]);

  useEffect(() => {
    const active = isQueryAuditEnabled();
    setEnabled(active);
    if (!active) return undefined;
    const refresh = () => setSummary(getQueryAuditSummary());
    refresh();
    window.addEventListener(QUERY_AUDIT_EVENT, refresh);
    return () => window.removeEventListener(QUERY_AUDIT_EVENT, refresh);
  }, []);

  if (process.env.NODE_ENV === "production" || !enabled) return null;

  const totalCalls = summary.reduce((total, item) => total + item.calls, 0);
  const duplicateCalls = summary.reduce((total, item) => total + item.duplicates, 0);

  return (
    <aside className="fixed bottom-3 left-3 z-[120] w-[min(24rem,calc(100vw-1.5rem))] text-xs">
      <details className="border border-field-primary bg-field-panel">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 font-bold text-field-primary marker:content-none">
          Query audit
          <span className="ml-auto bg-field-primary px-2 py-0.5 text-black">
            {totalCalls} calls · {duplicateCalls} duplicates
          </span>
        </summary>
        <div className="max-h-72 overflow-auto border-t border-field-border p-2">
          <div className="mb-2 flex justify-end">
            <button
              type="button"
              onClick={clearQueryAudit}
              className="min-h-7 border border-field-border bg-field-panel px-2 text-field-text transition-colors hover:border-field-primary hover:bg-field-primary hover:text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary"
            >
              로그 초기화
            </button>
          </div>
          {summary.length === 0 ? (
            <p className="px-1 py-3 text-center text-field-muted">기록된 요청이 없습니다.</p>
          ) : (
            <div className="grid gap-1">
              {summary.map((item) => (
                <div key={item.label} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 border-b border-field-border px-1 py-1.5 last:border-0">
                  <div className="min-w-0">
                    <p className="truncate font-bold text-field-text" title={item.label}>{item.label}</p>
                    <p className="truncate text-[10px] text-field-muted" title={item.source}>{item.source}</p>
                  </div>
                  <div className="text-right font-bold text-field-primary">
                    <p>{item.calls}회 · {item.totalDurationMs}ms</p>
                    <p className="text-[10px]">{item.failures ? `실패 ${item.failures}` : item.lastStatus}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </details>
    </aside>
  );
}
