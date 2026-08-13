import { DailyPlanDocument } from "@/components/DailyPlanDocument";
import { buildDailyPlanReadDocumentModel } from "@/lib/dailyPlan/readDocument";
import type { DailyPlan, DailyPlanShot } from "@/lib/types";
import styles from "./DailyPlanReadOnlyView.module.css";

type DailyPlanReadOnlyViewProps = {
  plan: DailyPlan;
  shots?: readonly DailyPlanShot[];
};

/**
 * Guest를 포함한 열람 전용 화면입니다. 편집기를 disabled 상태로 mount하지 않고
 * 실제 일촬표의 canonical portrait document만 같은 persisted snapshot으로 그립니다.
 */
export function DailyPlanReadOnlyView({
  plan,
  shots = []
}: DailyPlanReadOnlyViewProps) {
  const document = buildDailyPlanReadDocumentModel(plan, shots);

  return (
    <section
      className={styles.root}
      data-daily-plan-read-only
      aria-label={`${document.meta.day || document.plan.episode || "선택 회차"} 일촬표 열람`}
    >
      <DailyPlanDocument
        plan={document.plan}
        locations={document.locations}
        meta={document.meta}
        timetableRows={document.timetableRows}
        totalCutCount={document.totalCutCount}
        orientation="portrait"
        density="normal"
        pageLayout="single"
      />
    </section>
  );
}
