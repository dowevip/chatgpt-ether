import type { ChatGPTTimelineNode } from './timeline';

export type ChatGPTTimeContextNodeSource = () => ChatGPTTimelineNode[];

export type ChatGPTTimeContextInjectionOptions = {
  getTimelineNodes: ChatGPTTimeContextNodeSource;
};

export type ChatGPTTimeContextInjectionResult = {
  injected: boolean;
  reason: string;
  lastInteractionAt: number | null;
  elapsedMs: number | null;
};
