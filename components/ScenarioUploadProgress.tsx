import styles from "./ScenarioUploadProgress.module.css";

export type ScenarioUploadStage =
  | "validating"
  | "uploading"
  | "analyzing"
  | "saving"
  | "refreshing"
  | "warning"
  | "success";

export type ScenarioUploadProgressState = {
  stage: ScenarioUploadStage;
  filename: string;
  currentFile: number;
  totalFiles: number;
  detail?: string;
};

const STAGE_COPY: Record<ScenarioUploadStage, { title: string; detail: string }> = {
  validating: {
    title: "파일 확인 중",
    detail: "PDF 형식과 파일 크기를 확인하고 있습니다."
  },
  uploading: {
    title: "파일 업로드·기본 분석 중",
    detail: "PDF를 전송하고 기본 씬 정보를 준비하고 있습니다."
  },
  analyzing: {
    title: "씬 분석 중",
    detail: "PDF의 씬과 페이지 구간을 정리하고 있습니다."
  },
  saving: {
    title: "분석 결과 저장 중",
    detail: "씬 구성을 프로젝트에 저장하고 있습니다."
  },
  refreshing: {
    title: "시나리오 목록 반영 중",
    detail: "저장된 시나리오 목록을 다시 불러오고 있습니다."
  },
  warning: {
    title: "업로드 완료 · 확인 필요",
    detail: "업로드한 PDF는 유지되며 오류 내용을 확인한 뒤 다시 시도할 수 있습니다."
  },
  success: {
    title: "시나리오 처리 완료",
    detail: "새 시나리오를 화면에 반영했습니다."
  }
};

export function ScenarioUploadProgress({
  progress
}: {
  progress: ScenarioUploadProgressState | null;
}) {
  if (!progress) return null;

  const copy = STAGE_COPY[progress.stage];
  const isComplete = progress.stage === "success";
  const isWarning = progress.stage === "warning";
  const isSettled = isComplete || isWarning;
  const stageDetail = progress.detail ?? copy.detail;

  return (
    <section
      className={styles.card}
      role={isSettled ? undefined : "status"}
      aria-live={isSettled ? undefined : "polite"}
      aria-atomic={isSettled ? undefined : true}
      aria-busy={!isSettled}
      data-scenario-upload-progress
      data-stage={progress.stage}
    >
      <div className={styles.headingRow}>
        <div className={styles.copy}>
          <p className={styles.title}>{copy.title}</p>
          <p className={styles.detail}>{stageDetail}</p>
        </div>
        {progress.totalFiles > 1 ? (
          <span className={styles.counter} aria-label={`전체 ${progress.totalFiles}개 중 ${progress.currentFile}번째 파일`}>
            {progress.currentFile}/{progress.totalFiles}
          </span>
        ) : null}
      </div>

      <p className={styles.filename} title={progress.filename}>
        {progress.filename}
      </p>

      {isSettled ? (
        <div className={isWarning ? styles.warningIndicator : styles.completeIndicator} aria-hidden="true" />
      ) : (
        <div
          className={styles.track}
          role="progressbar"
          aria-label={copy.title}
          aria-valuetext={copy.title}
        >
          <span className={styles.indicator} aria-hidden="true" />
        </div>
      )}

      {!isSettled ? (
        <p className={styles.hint}>파일 크기와 페이지 수에 따라 잠시 걸릴 수 있습니다.</p>
      ) : null}
    </section>
  );
}
