import React, { useState } from 'react';
import {
  Bell,
  Check,
  AlertTriangle,
  Sparkles,
  Users,
  FileText,
  TrendingUp,
  X,
  ArrowRight
} from 'lucide-react';

export interface AppNotificationItem {
  id: string;
  householdId: string;
  userId?: string;
  category: 'import' | 'family' | 'milestone' | 'drift' | 'system';
  severity: 'info' | 'success' | 'warning';
  title: string;
  message: string;
  actionTab?: string;
  isRead: boolean;
  createdAt: number;
}

export interface SmartInsightAlert {
  id: string;
  severity: 'info' | 'success' | 'warning';
  title: string;
  message: string;
  actionLabel: string;
  onAction: () => void;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  smartAlerts: SmartInsightAlert[];
  notifications: AppNotificationItem[];
  onMarkAllRead: () => void;
  onNavigateTab: (tab: any) => void;
}

function timeAgo(ts: number): string {
  const diffSec = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 60) return 'Just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

export function NotificationDrawer({
  isOpen,
  onClose,
  smartAlerts,
  notifications,
  onMarkAllRead,
  onNavigateTab
}: Props) {
  const [browserPerm, setBrowserPerm] = useState<string>(() =>
    typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'unsupported'
  );

  if (!isOpen) return null;

  const enableBrowserNotifications = async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    try {
      const perm = await Notification.requestPermission();
      setBrowserPerm(perm);
      if (perm === 'granted') {
        new Notification('UnityWealth Alerts Active', {
          body: 'You will receive drift, statement sync, and milestone alerts right here.'
        });
      }
    } catch {
      // ignore
    }
  };

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40 backdrop-blur-xs">
      <div className="w-full max-w-md bg-white h-full shadow-2xl flex flex-col overflow-hidden">
        <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-indigo-600 text-white flex items-center justify-center">
              <Bell size={18} />
            </div>
            <div>
              <h3 className="font-bold text-base text-slate-900">Wealth Alerts & Activity</h3>
              <p className="text-xs text-slate-500">Proactive drift, sync & family updates</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={onMarkAllRead}
                className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold text-indigo-600 hover:bg-indigo-50 flex items-center gap-1"
              >
                <Check size={13} /> Mark read
              </button>
            )}
            <button
              type="button"
              aria-label="Close notifications"
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-slate-700 rounded-xl hover:bg-slate-100"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {/* Browser Notification Opt-in Banner */}
          {browserPerm === 'default' && (
            <div className="p-3.5 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-bold text-indigo-950">Enable Instant Browser Alerts</div>
                <div className="text-[11px] text-indigo-700 mt-0.5">
                  Get notified when drift crosses threshold or family statements sync (no email setup needed).
                </div>
              </div>
              <button
                type="button"
                onClick={enableBrowserNotifications}
                className="px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shrink-0"
              >
                Enable
              </button>
            </div>
          )}

          {/* Smart Live Portfolio Advisors */}
          <div className="space-y-2.5">
            <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">
              Smart Wealth Advisors ({smartAlerts.length})
            </div>
            {smartAlerts.length === 0 ? (
              <div className="p-4 rounded-2xl bg-emerald-50/70 border border-emerald-100 text-xs text-emerald-800 font-semibold flex items-center gap-2">
                <Check size={16} className="text-emerald-600 shrink-0" />
                Portfolio alignment and statement syncs are healthy!
              </div>
            ) : (
              smartAlerts.map((alert) => (
                <div
                  key={alert.id}
                  className={`p-4 rounded-2xl border space-y-2 ${
                    alert.severity === 'warning'
                      ? 'bg-amber-50/70 border-amber-200/80'
                      : alert.severity === 'success'
                      ? 'bg-emerald-50/70 border-emerald-200/80'
                      : 'bg-slate-50 border-slate-200/80'
                  }`}
                >
                  <div className="flex items-start gap-2.5">
                    <div className="mt-0.5 shrink-0">
                      {alert.severity === 'warning' ? (
                        <AlertTriangle size={16} className="text-amber-600" />
                      ) : (
                        <Sparkles size={16} className="text-indigo-600" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-bold text-slate-900">{alert.title}</div>
                      <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">{alert.message}</p>
                      <button
                        type="button"
                        onClick={() => {
                          alert.onAction();
                          onClose();
                        }}
                        className="mt-2 inline-flex items-center gap-1 text-xs font-black text-indigo-700 hover:underline"
                      >
                        {alert.actionLabel} <ArrowRight size={12} />
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Persisted Family Activity Feed */}
          <div className="space-y-2.5">
            <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">
              Household Activity Log
            </div>
            {notifications.length === 0 ? (
              <div className="p-6 text-center rounded-2xl bg-slate-50 border border-slate-100 text-xs text-slate-400">
                Statement imports, family joins, and net worth milestones will appear here automatically.
              </div>
            ) : (
              notifications.map((n) => (
                <div
                  key={n.id}
                  onClick={() => {
                    if (n.actionTab) {
                      onNavigateTab(n.actionTab);
                      onClose();
                    }
                  }}
                  className={`p-3.5 rounded-2xl border transition-all ${
                    n.isRead ? 'bg-white border-slate-100' : 'bg-indigo-50/40 border-indigo-100'
                  } ${n.actionTab ? 'cursor-pointer hover:border-indigo-200' : ''}`}
                >
                  <div className="flex items-start gap-3">
                    <div className="p-2 rounded-xl bg-slate-100 text-slate-600 shrink-0 mt-0.5">
                      {n.category === 'family' ? (
                        <Users size={14} className="text-emerald-600" />
                      ) : n.category === 'milestone' ? (
                        <TrendingUp size={14} className="text-indigo-600" />
                      ) : (
                        <FileText size={14} className="text-violet-600" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-slate-900 truncate">{n.title}</span>
                        <span className="text-[10px] text-slate-400 shrink-0">{timeAgo(n.createdAt)}</span>
                      </div>
                      <p className="text-xs text-slate-600 mt-0.5 leading-snug">{n.message}</p>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
