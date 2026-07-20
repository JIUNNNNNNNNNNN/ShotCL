type PageHeaderProps = {
  title: string;
  description?: string;
  actions?: React.ReactNode;
};

/** 각 화면의 제목과 주요 동작 버튼을 같은 위치에 맞춥니다. */
export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="mb-5 flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="break-words text-2xl font-black tracking-normal text-field-primary">{title}</h1>
          {description ? <p className="mt-2 text-base leading-6 text-field-muted">{description}</p> : null}
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>
    </div>
  );
}
