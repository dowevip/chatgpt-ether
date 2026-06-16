export const uiTokens = {
  color: {
    app: 'bg-background text-foreground',
    surface: 'bg-card text-card-foreground',
    surfaceMuted: 'bg-muted text-muted-foreground',
    border: 'border-border',
    borderSubtle: 'border-border/60',
    text: 'text-foreground',
    textMuted: 'text-muted-foreground',
    textStrong: 'text-[#3D365C] dark:text-[#F4F4F5]',
    action: 'bg-primary text-primary-foreground',
    actionSubtle: 'bg-secondary text-secondary-foreground',
    actionDanger: 'bg-destructive text-destructive-foreground',
    textDanger: 'text-destructive',
    focus: 'focus-visible:ring-ring',
    input: 'border-input bg-background text-foreground',
  },
  layout: {
    popupWidth: 'w-[380px]',
    panelMaxHeight: 'max-h-[600px]',
    pagePadding: 'p-4',
    sectionGap: 'gap-3',
    rowGap: 'gap-2',
  },
  radius: {
    panel: 'rounded-xl',
    section: 'rounded-xl',
    control: 'rounded-md',
  },
  shadow: {
    panel: 'shadow-none',
    floating: 'shadow-sm',
  },
  typography: {
    title: 'text-[22px] font-semibold tracking-tight',
    sectionTitle: 'text-[15px] font-semibold',
    body: 'text-[13px]',
    caption: 'text-xs',
    mono: 'font-mono text-xs',
  },
  motion: {
    interactive: 'transition-colors',
  },
} as const;

export type UITokens = typeof uiTokens;
