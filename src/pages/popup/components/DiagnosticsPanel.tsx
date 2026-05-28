import React, { useEffect, useMemo, useState } from 'react';

import {
  formatChatGPTDiagnosticsText,
  getChatGPTDiagnosticsStatus,
  type ChatGPTDiagnosticsStatus,
} from '@/core/services/ChatGPTDiagnosticsService';

import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardTitle } from '../../../components/ui/card';

type DiagnosticsPanelProps = {
  onBack: () => void;
};

function valueText(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '-';
  return String(value);
}

function boolText(value: boolean): string {
  return value ? '是' : '否';
}

export function DiagnosticsPanel({ onBack }: DiagnosticsPanelProps) {
  const [status, setStatus] = useState<ChatGPTDiagnosticsStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const rows = useMemo(
    () =>
      status
        ? [
            ['当前页面是否识别为 ChatGPT', boolText(status.isChatGPTPage)],
            ['conversationId', valueText(status.conversationId)],
            ['当前对话标题', valueText(status.conversationTitle)],
            ['当前消息节点数量', String(status.totalMessageCount)],
            ['用户消息数量', String(status.userMessageCount)],
            ['助手消息数量', String(status.assistantMessageCount)],
            ['当前时间轴是否显示', boolText(status.timelineVisible)],
            ['时间轴节点数量', String(status.timelineNodeCount)],
            ['收藏消息数量', String(status.starredMessageCount)],
            ['当前对话是否已保存到对话索引', boolText(status.currentConversationSaved)],
            ['本地 schemaVersion', status.schemaVersion || '未设置'],
            ['插件版本号', status.extensionVersion],
            ['Google Drive 授权状态', status.googleDriveAuthStatus],
            ['上次同步时间', status.lastSyncTime],
            ['最近同步错误', status.recentSyncError],
          ]
        : [],
    [status],
  );

  const refreshDiagnostics = async () => {
    setLoading(true);
    setMessage(null);
    try {
      setStatus(await getChatGPTDiagnosticsStatus());
    } catch {
      setMessage('读取诊断信息失败。');
    } finally {
      setLoading(false);
    }
  };

  const copyDiagnostics = async () => {
    if (!status) return;
    try {
      await navigator.clipboard.writeText(formatChatGPTDiagnosticsText(status));
      setMessage('诊断信息已复制。');
    } catch {
      setMessage('复制失败，请刷新后重试。');
    }
  };

  useEffect(() => {
    void refreshDiagnostics();
  }, []);

  return (
    <div className="bg-background text-foreground w-[360px]">
      <div className="border-border/50 flex items-center justify-between border-b px-5 py-4">
        <div>
          <h1 className="text-primary text-xl font-bold">诊断信息</h1>
          <p className="text-muted-foreground text-xs">当前 ChatGPT Voyager 运行状态</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onBack}>
          返回
        </Button>
      </div>

      <div className="flex max-h-[560px] flex-col gap-4 overflow-y-auto p-5">
        <Card className="p-4">
          <CardContent className="flex items-center justify-between gap-3 p-0">
            <div>
              <CardTitle className="text-base">运行状态</CardTitle>
              <p className="text-muted-foreground mt-1 text-xs">
                {loading ? '正在刷新诊断信息' : '不包含聊天正文'}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={loading}
                onClick={() => void refreshDiagnostics()}
              >
                刷新
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={!status || loading}
                onClick={() => void copyDiagnostics()}
              >
                复制
              </Button>
            </div>
          </CardContent>
        </Card>

        {message && <p className="text-muted-foreground text-xs">{message}</p>}

        <Card className="p-4">
          <CardContent className="space-y-2 p-0">
            {rows.length === 0 && (
              <p className="text-muted-foreground text-sm">暂无诊断信息。</p>
            )}
            {rows.map(([label, value]) => (
              <div key={label} className="flex justify-between gap-3 text-xs">
                <span className="text-muted-foreground shrink-0">{label}</span>
                <span className="min-w-0 truncate text-right font-medium">{value}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
