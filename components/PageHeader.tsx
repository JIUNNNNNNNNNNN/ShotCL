type PageHeaderProps = {
  title: string;
  description?: string;
  actions?: React.ReactNode;
};

/** 큰 헤더 대신 현재 위치와 핵심 동작만 낮은 높이로 표시합니다. */
export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2 text-xs font-black">
        <span className="rounded-full border border-field-border bg-white px-3 py-1.5 text-field-primary">{title}</span>
        {description ? <span className="max-w-[min(52vw,28rem)] truncate text-field-muted">{description}</span> : null}
      </div>
      {actions ? <div className="shrink-0">{actions}</div> : null}
    </div>
  );
}
