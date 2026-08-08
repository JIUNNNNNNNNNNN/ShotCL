type PageHeaderProps = {
  title: string;
  description?: string;
  actions?: React.ReactNode;
};

/** 큰 헤더 대신 현재 위치와 핵심 동작만 낮은 높이로 표시합니다. */
export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-xs">
        <span className="rounded-md border border-field-divider bg-field-soft px-3 py-1.5 font-semibold text-field-text">{title}</span>
        {description ? <span className="min-w-0 break-words font-normal text-field-subtle [overflow-wrap:anywhere]">{description}</span> : null}
      </div>
      {actions ? <div className="shrink-0">{actions}</div> : null}
    </div>
  );
}
