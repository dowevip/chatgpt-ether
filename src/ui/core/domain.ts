import type { ReactNode } from 'react';

export type UIActionTone = 'primary' | 'secondary' | 'danger' | 'ghost';

export type UIAction = {
  id: string;
  label: ReactNode;
  tone?: UIActionTone;
  disabled?: boolean;
  title?: string;
  onClick?: () => void;
};

export type Panel = {
  title: ReactNode;
  subtitle?: ReactNode;
  onBack?: () => void;
  backLabel?: ReactNode;
  headerAccessory?: ReactNode;
  actions?: UIAction[];
  children: ReactNode;
};

export type PageSection = {
  title?: ReactNode;
  description?: ReactNode;
  actions?: UIAction[];
  children: ReactNode;
};

export type ListViewItem = {
  id: string;
  title: ReactNode;
  subtitle?: ReactNode;
  meta?: ReactNode;
  body?: ReactNode;
  actions?: UIAction[];
};

export type ListView = {
  items: ListViewItem[];
  emptyText: ReactNode;
  variant?: 'plain' | 'divided' | 'cards';
};

export type ActionBar = {
  actions: UIAction[];
  align?: 'start' | 'end' | 'between';
};
