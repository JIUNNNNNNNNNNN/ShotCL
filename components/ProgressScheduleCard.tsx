import { Clock3 } from "lucide-react";
import type { DailyPlanMealTime } from "@/lib/types";

type ProgressScheduleCardProps = {
  item: DailyPlanMealTime;
};

/** 촬영 컷이 아닌 기타 일정을 진행표 순서 안에 표시합니다. */
export function ProgressScheduleCard({ item }: ProgressScheduleCardProps) {
  const time = formatScheduleTimeRange(item.startTime, item.endTime);

  return (
    <article className="grid gap-1.5 rounded-[1.35rem] border border-[#e2c96e] bg-[#fff3c4] px-3 py-2.5 text-field-text sm:grid-cols-[8rem_minmax(0,1fr)] sm:items-center sm:gap-3">
      <div className="flex min-w-0 items-center gap-2">
        <span className="shrink-0 rounded-full border border-[#d9bd59] bg-[#fff8dd] px-2 py-1 text-[10px] font-black text-field-primary">
          기타일정
        </span>
        {time ? (
          <span className="inline-flex min-w-0 items-center gap-1 truncate text-xs font-black text-[#64551f]">
            <Clock3 className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {time}
          </span>
        ) : null}
      </div>
      <p className="min-w-0 truncate text-sm font-black leading-5 text-field-text">
        {item.memo.trim() || "기타 일정"}
      </p>
    </article>
  );
}

function formatScheduleTimeRange(startTime: string, endTime: string) {
  const start = formatScheduleTime(startTime);
  const end = formatScheduleTime(endTime);
  if (start && end) return `${start}–${end}`;
  return start || end;
}

function formatScheduleTime(value: string) {
  const digits = String(value ?? "").replace(/\D/g, "").slice(0, 4);
  if (digits.length !== 4) return String(value ?? "").trim();
  const hour = Number(digits.slice(0, 2));
  const minute = Number(digits.slice(2));
  if (hour > 23 || minute > 59) return String(value ?? "").trim();
  return `${digits.slice(0, 2)}:${digits.slice(2)}`;
}
