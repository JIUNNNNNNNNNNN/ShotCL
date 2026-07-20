"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, Save, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { detectTextCorruption } from "@/lib/analyzers/detectTextCorruption";
import type { AnalysisReviewedShot, ShotDraft, StoryboardAnalysisResult } from "@/lib/types";

type AnalysisPreviewProps = {
  analysis: StoryboardAnalysisResult & {
    fileName?: string;
    fileType?: string;
  };
  existingShotCount: number;
  isSaving: boolean;
  onCancel: () => void;
  onSaveFeedback: (userFeedback: string) => Promise<void>;
  onImport: (
    mode: "append" | "replace",
    payload: {
      finalShots: ShotDraft[];
      reviewedShots: AnalysisReviewedShot[];
      userFeedback: string;
    }
  ) => Promise<void>;
};

type FeedbackSaveStatus = "idle" | "saving" | "saved" | "failed";

const inputClass =
  "min-h-10 w-full rounded-md border border-field-border bg-white px-2 py-2 text-sm text-field-text outline-none focus:border-field-primary focus:ring-2 focus:ring-field-light";

const unsavedFeedbackMessage = "작성한 피드백이 아직 저장되지 않았습니다. 페이지를 나가면 내용이 사라질 수 있습니다.";

/** 분석 결과를 저장 전 데스크탑 표로 검토하고, 피드백 저장과 최종 확정을 분리합니다. */
export function AnalysisPreview({ analysis, existingShotCount, isSaving, onCancel, onSaveFeedback, onImport }: AnalysisPreviewProps) {
  const [editableShots, setEditableShots] = useState<AnalysisReviewedShot[]>(() => analysis.shots);
  const [userFeedback, setUserFeedback] = useState("");
  const [savedFeedback, setSavedFeedback] = useState("");
  const [feedbackSaveStatus, setFeedbackSaveStatus] = useState<FeedbackSaveStatus>("idle");
  const [confirmMode, setConfirmMode] = useState<"append" | "replace">("append");

  useEffect(() => {
    setEditableShots(analysis.shots);
    setUserFeedback("");
    setSavedFeedback("");
    setFeedbackSaveStatus("idle");
    setConfirmMode("append");
  }, [analysis]);

  const includedShots = useMemo(() => editableShots.filter((shot) => !shot.excluded), [editableShots]);
  const shotTextIssues = useMemo(() => editableShots.map((shot) => getShotTextIssue(shot)), [editableShots]);
  const includedIssueCount = editableShots.reduce((count, shot, index) => (!shot.excluded && shotTextIssues[index] ? count + 1 : count), 0);
  const warnings = analysis.summary.warnings ?? (analysis.warning ? [analysis.warning] : []);
  const trimmedFeedback = userFeedback.trim();
  const hasUnsavedFeedback = trimmedFeedback !== savedFeedback.trim();
  const feedbackStatusText = getFeedbackStatusText(feedbackSaveStatus, hasUnsavedFeedback, savedFeedback);

  useEffect(() => {
    if (!hasUnsavedFeedback) return;

    function handleBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = unsavedFeedbackMessage;
    }

    function handleDocumentClick(event: MouseEvent) {
      const target = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!target) return;
      const shouldLeave = window.confirm(unsavedFeedbackMessage);
      if (!shouldLeave) {
        event.preventDefault();
        event.stopPropagation();
      }
    }

    window.addEventListener("beforeunload", handleBeforeUnload);
    document.addEventListener("click", handleDocumentClick, true);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("click", handleDocumentClick, true);
    };
  }, [hasUnsavedFeedback]);

  function updateShot(index: number, patch: Partial<AnalysisReviewedShot>) {
    setEditableShots((current) => current.map((shot, shotIndex) => (shotIndex === index ? { ...shot, ...patch } : shot)));
  }

  function handleFeedbackChange(value: string) {
    setUserFeedback(value);
    if (feedbackSaveStatus !== "saving") {
      setFeedbackSaveStatus("idle");
    }
  }

  async function handleSaveFeedbackOnly() {
    setFeedbackSaveStatus("saving");

    try {
      await onSaveFeedback(trimmedFeedback);
      setSavedFeedback(trimmedFeedback);
      setFeedbackSaveStatus("saved");
    } catch {
      setFeedbackSaveStatus("failed");
    }
  }

  async function handleImport() {
    if (confirmMode === "replace" && existingShotCount > 0) {
      const shouldReplace = window.confirm("기존 컷 목록이 삭제되고 분석 결과로 교체됩니다. 계속할까요?");
      if (!shouldReplace) return;
    }

    const reviewedShots = editableShots.map((shot, index) => ({
      ...shot,
      orderIndex: index + 1,
      status: "pending" as const
    }));
    const finalShots = includedShots.map((shot, index) => ({
      ...shot,
      orderIndex: index + 1,
      status: "pending" as const
    }));

    await onImport(confirmMode, {
      finalShots,
      reviewedShots,
      userFeedback: trimmedFeedback
    });
  }

  function handleCancel() {
    if (hasUnsavedFeedback) {
      const shouldCancel = window.confirm(unsavedFeedbackMessage);
      if (!shouldCancel) return;
    }

    onCancel();
  }

  return (
    <section className="mt-6 rounded-md border border-field-border bg-white p-5 shadow-sm">
      <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-start">
        <div>
          <h2 className="text-xl font-black text-field-primary">분석 결과 미리보기</h2>
          <p className="mt-1 break-words text-sm font-bold text-field-muted">
            {analysis.fileName || "업로드 파일"} · {analysis.fileType || "unknown"}
          </p>
        </div>

        <Button variant="ghost" onClick={handleCancel} disabled={isSaving || feedbackSaveStatus === "saving"}>
          <X className="h-5 w-5" aria-hidden />
          취소
        </Button>
      </div>

      {existingShotCount > 0 ? (
        <div className="mt-4 rounded-md border border-field-border bg-field-soft p-3 text-sm font-bold text-field-primary">
          기존 컷 리스트가 {existingShotCount}개 있습니다. 아래 확정 방식에서 기존 컷 뒤에 추가하거나, 기존 컷을 삭제하고 교체할 수 있습니다.
        </div>
      ) : null}

      {analysis.extractionPreview ? (
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <SummaryStat label="분석 방식" value={analysis.extractionPreview.extractionMethod === "ocr_image" ? "PDF 이미지 OCR" : analysis.extractionPreview.extractionMethod} />
          <SummaryStat label="PDF 텍스트 직접 추출" value={analysis.extractionPreview.usedFallback ? "실패" : "사용"} />
          <SummaryStat label="OCR 전환" value={analysis.extractionPreview.usedFallback ? "사용함" : "사용 안 함"} />
        </div>
      ) : null}

      <div className="mt-4 grid gap-3 md:grid-cols-5">
        <SummaryStat label="감지 행 수" value={analysis.summary.detectedRowCount} />
        <SummaryStat label="컷 후보 수" value={analysis.summary.detectedShotCandidateCount ?? analysis.summary.detectedCandidateCount} />
        <SummaryStat label="생성 컷 수" value={analysis.summary.generatedShotCount} />
        <SummaryStat label="반영 예정" value={includedShots.length} />
        <SummaryStat label="신뢰도" value={analysis.summary.confidence ?? "medium"} />
      </div>

      {warnings.length > 0 ? (
        <div className="mt-4 grid gap-2">
          {warnings.map((warning) => (
            <div key={warning} className="flex gap-2 rounded-md border border-field-danger bg-white p-3 text-sm font-bold text-field-danger">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>{warning}</span>
            </div>
          ))}
        </div>
      ) : null}

      {includedIssueCount > 0 ? (
        <div className="mt-4 flex gap-2 rounded-md border border-field-danger bg-white p-3 text-sm font-bold leading-6 text-field-danger">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>깨진 문자로 보이는 컷이 {includedIssueCount}개 있습니다. 빨간 행의 제목/설명/장소/인물/메모를 수정하거나 제외해야 확정할 수 있습니다.</span>
        </div>
      ) : null}

      <div className="mt-5 overflow-x-auto rounded-md border border-field-border">
        <table className="min-w-[1180px] w-full border-collapse bg-white text-left text-sm">
          <thead className="bg-field-light text-xs font-black uppercase text-field-primary">
            <tr>
              <th className="w-16 border-b border-field-border p-3">제외</th>
              <th className="w-16 border-b border-field-border p-3">순서</th>
              <th className="w-24 border-b border-field-border p-3">씬</th>
              <th className="w-24 border-b border-field-border p-3">컷</th>
              <th className="w-56 border-b border-field-border p-3">제목</th>
              <th className="w-80 border-b border-field-border p-3">촬영 내용</th>
              <th className="w-40 border-b border-field-border p-3">장소</th>
              <th className="w-40 border-b border-field-border p-3">인물</th>
              <th className="w-56 border-b border-field-border p-3">메모</th>
              <th className="w-36 border-b border-field-border p-3">원본 위치</th>
            </tr>
          </thead>
          <tbody>
            {editableShots.map((shot, index) => (
              <tr
                key={`${shot.sourceRow ?? index}-${index}`}
                className={shot.excluded ? "bg-field-soft opacity-60" : shotTextIssues[index] ? "bg-red-50" : ""}
              >
                <td className="border-b border-field-border p-3 align-top">
                  <input
                    type="checkbox"
                    checked={Boolean(shot.excluded)}
                    onChange={(event) => updateShot(index, { excluded: event.target.checked })}
                    className="h-5 w-5"
                    aria-label={`${index + 1}번 컷 제외`}
                  />
                </td>
                <td className="border-b border-field-border p-3 align-top font-black text-field-muted">{index + 1}</td>
                <td className="border-b border-field-border p-2 align-top">
                  <input className={inputClass} value={shot.sceneNumber} onChange={(event) => updateShot(index, { sceneNumber: event.target.value })} />
                </td>
                <td className="border-b border-field-border p-2 align-top">
                  <input className={inputClass} value={shot.cutNumber} onChange={(event) => updateShot(index, { cutNumber: event.target.value })} />
                </td>
                <td className="border-b border-field-border p-2 align-top">
                  <input className={inputClass} value={shot.title} onChange={(event) => updateShot(index, { title: event.target.value })} />
                  {shotTextIssues[index] ? <p className="mt-2 text-xs font-black leading-5 text-field-danger">{shotTextIssues[index]}</p> : null}
                </td>
                <td className="border-b border-field-border p-2 align-top">
                  <textarea
                    className={`${inputClass} min-h-20 resize-y`}
                    value={shot.description}
                    onChange={(event) => updateShot(index, { description: event.target.value })}
                  />
                </td>
                <td className="border-b border-field-border p-2 align-top">
                  <input className={inputClass} value={shot.location} onChange={(event) => updateShot(index, { location: event.target.value })} />
                </td>
                <td className="border-b border-field-border p-2 align-top">
                  <input
                    className={inputClass}
                    value={shot.characters.join(", ")}
                    onChange={(event) =>
                      updateShot(index, {
                        characters: event.target.value
                          .split(",")
                          .map((item) => item.trim())
                          .filter(Boolean)
                      })
                    }
                  />
                </td>
                <td className="border-b border-field-border p-2 align-top">
                  <textarea className={`${inputClass} min-h-20 resize-y`} value={shot.memo} onChange={(event) => updateShot(index, { memo: event.target.value })} />
                </td>
                <td className="border-b border-field-border p-3 align-top text-xs font-bold text-field-muted">
                  {shot.sourceSheet ? `${shot.sourceSheet} · ` : ""}
                  {shot.sourcePage ? `p.${shot.sourcePage} · ` : ""}
                  {shot.sourceRow ? `row ${shot.sourceRow}` : "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="mt-5 rounded-md border border-field-border bg-field-soft p-4">
        <div className="grid gap-2 md:grid-cols-[1fr_auto] md:items-start">
          <div>
            <label className="text-sm font-black text-field-primary" htmlFor="analysis-feedback">
              AI 분석 피드백
            </label>
            <p className="mt-1 text-sm font-bold text-field-muted">{feedbackStatusText}</p>
          </div>
          <Button variant="secondary" onClick={handleSaveFeedbackOnly} disabled={feedbackSaveStatus === "saving" || isSaving || !hasUnsavedFeedback}>
            <Save className="h-5 w-5" aria-hidden />
            피드백만 저장
          </Button>
        </div>
        <textarea
          id="analysis-feedback"
          value={userFeedback}
          onChange={(event) => handleFeedbackChange(event.target.value)}
          className="mt-3 min-h-28 w-full rounded-md border border-field-border bg-white px-3 py-3 text-sm leading-6 text-field-text outline-none focus:border-field-primary focus:ring-2 focus:ring-field-light"
          placeholder="예: 실제는 10컷인데 3컷만 생성됨 / 컷을 씬 단위로 뭉쳐버림 / 표의 촬영 내용 열을 잘못 읽음"
        />

        {existingShotCount > 0 ? (
          <div className="mt-4 rounded-md border border-field-border bg-white p-3">
            <p className="text-sm font-black text-field-primary">확정 방식</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <label className="flex cursor-pointer items-center gap-2 rounded-md border border-field-border p-3 text-sm font-bold text-field-text">
                <input type="radio" name="confirm-mode" checked={confirmMode === "append"} onChange={() => setConfirmMode("append")} />
                기존 컷 뒤에 추가
              </label>
              <label className="flex cursor-pointer items-center gap-2 rounded-md border border-field-border p-3 text-sm font-bold text-field-text">
                <input type="radio" name="confirm-mode" checked={confirmMode === "replace"} onChange={() => setConfirmMode("replace")} />
                기존 컷 삭제 후 교체
              </label>
            </div>
          </div>
        ) : null}

        <div className="mt-4 grid gap-2 md:grid-cols-[1fr_auto] md:items-center">
          <p className="text-sm font-bold leading-6 text-field-muted">
            피드백만 저장하면 컷 리스트에는 반영되지 않습니다. 확정 버튼을 누르면 수정된 표가 final_confirmed_shots와 shots에 저장됩니다.
          </p>
          <Button onClick={handleImport} disabled={isSaving || feedbackSaveStatus === "saving" || includedShots.length === 0 || includedIssueCount > 0}>
            <Check className="h-5 w-5" aria-hidden />
            수정 후 컷 리스트 확정
          </Button>
        </div>
      </section>

      {process.env.NODE_ENV !== "production" ? (
        <details className="mt-5 rounded-md border border-field-border bg-field-soft p-4">
          <summary className="cursor-pointer text-sm font-black text-field-primary">개발자 디버그</summary>
          <div className="mt-4 grid gap-4 text-sm">
            <DebugBlock title="추출 텍스트 일부" value={analysis.debug.extractedTextSample} />
            <DebugBlock title="감지 컬럼" value={JSON.stringify(analysis.summary.detectedColumns ?? {}, null, 2)} />
            <DebugBlock title="AI payload 요약" value={JSON.stringify(analysis.debug.promptPayloadSummary ?? {}, null, 2)} />
            <DebugBlock title="컷 후보 raw data" value={JSON.stringify(analysis.debug.rawCandidates.slice(0, 20), null, 2)} />
            {analysis.debug.aiRawResponse ? <DebugBlock title="AI 응답 원문" value={analysis.debug.aiRawResponse} /> : null}
            {analysis.debug.parseError ? <DebugBlock title="파싱 에러" value={analysis.debug.parseError} /> : null}
          </div>
        </details>
      ) : null}
    </section>
  );
}

function SummaryStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border border-field-border bg-field-soft p-3">
      <p className="text-xs font-bold text-field-muted">{label}</p>
      <p className="mt-1 text-xl font-black text-field-primary">{value}</p>
    </div>
  );
}

function DebugBlock({ title, value }: { title: string; value: string }) {
  return (
    <div>
      <h3 className="font-black text-field-primary">{title}</h3>
      <pre className="mt-2 max-h-72 overflow-auto rounded-md bg-white p-3 text-xs leading-5 text-field-text">{value || "-"}</pre>
    </div>
  );
}

function getFeedbackStatusText(status: FeedbackSaveStatus, hasUnsavedFeedback: boolean, savedFeedback: string) {
  if (status === "saving") return "저장 중…";
  if (status === "failed") return "피드백 저장에 실패했습니다.";
  if (status === "saved" && !hasUnsavedFeedback) return "피드백이 저장되었습니다.";
  if (savedFeedback && !hasUnsavedFeedback) return "피드백이 저장되었습니다.";
  return "아직 저장되지 않았습니다.";
}

function getShotTextIssue(shot: AnalysisReviewedShot) {
  const combined = [shot.title, shot.description, shot.location, shot.memo, ...shot.characters].join(" ");
  const quality = detectTextCorruption(combined);

  if (quality.suspiciousRatio >= 0.05 || quality.suspiciousCharCount >= 5 || combined.includes("�")) {
    return "깨진 문자로 보이는 내용이 있습니다.";
  }

  return "";
}
