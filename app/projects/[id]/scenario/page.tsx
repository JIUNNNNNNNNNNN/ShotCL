"use client";

import { ChangeEvent, useCallback, useEffect, useRef, useState } from "react";
import { Download, ExternalLink, Trash2, Upload } from "lucide-react";
import { useParams } from "next/navigation";
import { PixelDogLoader } from "@/components/PixelDogLoader";
import { useProjectAccess } from "@/components/ProjectAccessGate";
import {
  deleteProjectReferenceAsset,
  listProjectReferenceAssets,
  uploadProjectReferenceAsset
} from "@/lib/data/projectReferenceAssets";
import { getProject } from "@/lib/data/projects";
import type { ProjectReferenceAsset } from "@/lib/types";

export default function ProjectScenarioPage() {
  const params = useParams<{ id: string | string[] }>();
  const projectId = Array.isArray(params.id) ? params.id[0] : params.id;
  const { role } = useProjectAccess();
  const canEdit = role !== "progress";
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [projectName, setProjectName] = useState("");
  const [assets, setAssets] = useState<ProjectReferenceAsset[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const load = useCallback(async () => {
    if (!projectId) return;
    setIsLoading(true);
    try {
      const [project, scenarioAssets] = await Promise.all([
        getProject(projectId),
        listProjectReferenceAssets(projectId, "scenario")
      ]);
      setProjectName(project?.name ?? "프로젝트");
      setAssets(scenarioAssets);
      setSelectedId((current) => scenarioAssets.some((asset) => asset.id === current)
        ? current
        : scenarioAssets[0]?.id ?? "");
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "시나리오 자료를 불러오지 못했습니다.");
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!projectId || files.length === 0) return;
    setIsUploading(true);
    setErrorMessage("");
    try {
      let uploadedId = "";
      for (const file of files) {
        const uploadedAsset = await uploadProjectReferenceAsset(projectId, "scenario", file);
        uploadedId = uploadedAsset.id;
      }
      await load();
      if (uploadedId) setSelectedId(uploadedId);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "PDF를 업로드하지 못했습니다.");
    } finally {
      setIsUploading(false);
    }
  }

  async function handleDelete(asset: ProjectReferenceAsset) {
    if (!projectId || !window.confirm(`"${asset.filename}"을 삭제할까요?`)) return;
    try {
      await deleteProjectReferenceAsset(projectId, asset.id);
      await load();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "PDF를 삭제하지 못했습니다.");
    }
  }

  if (isLoading) return <PixelDogLoader size="lg" />;
  const selectedAsset = assets.find((asset) => asset.id === selectedId) ?? null;

  return (
    <div className="grid w-full min-w-0 gap-2">
      <div className="flex min-w-0 flex-wrap items-center gap-1.5 border-b border-field-border pb-2">
        <div className="mr-1 min-w-0 shrink-0">
          <h1 className="font-display text-base font-black leading-none text-field-primary sm:text-lg">
            시나리오
          </h1>
          <p className="hidden max-w-40 truncate text-[10px] font-bold text-field-muted sm:block">
            {projectName}
          </p>
        </div>

        {assets.length > 0 ? (
          <label className="min-w-[10rem] flex-1 sm:max-w-md">
            <span className="sr-only">시나리오 PDF 선택</span>
            <select
              value={selectedId}
              onChange={(event) => setSelectedId(event.target.value)}
              aria-label="시나리오 PDF 선택"
              className="min-h-9 w-full min-w-0 truncate rounded-full border border-field-border bg-white px-3 text-xs font-bold text-field-text outline-none transition focus:border-field-primary focus:ring-2 focus:ring-field-light"
            >
              {assets.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.filename}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className="min-w-0 flex-1 truncate text-xs font-bold text-field-muted">
            등록된 PDF가 없습니다.
          </p>
        )}

        <div className="ml-auto flex shrink-0 items-center gap-1">
          {selectedAsset ? (
            <>
              <a
                href={selectedAsset.publicUrl}
                target="_blank"
                rel="noreferrer"
                aria-label={`${selectedAsset.filename} 새 창에서 열기`}
                title="새 창에서 열기"
                className="inline-flex min-h-9 items-center gap-1 rounded-full border border-field-border bg-white px-2.5 text-[11px] font-black text-field-primary transition hover:border-field-primary active:scale-95"
              >
                <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                <span className="hidden sm:inline">새 창</span>
              </a>
              <a
                href={selectedAsset.publicUrl}
                download={selectedAsset.filename}
                target="_blank"
                rel="noreferrer"
                aria-label={`${selectedAsset.filename} 다운로드`}
                title="다운로드"
                className="inline-flex min-h-9 items-center gap-1 rounded-full border border-field-border bg-white px-2.5 text-[11px] font-black text-field-primary transition hover:border-field-primary active:scale-95"
              >
                <Download className="h-3.5 w-3.5" aria-hidden />
                <span className="hidden sm:inline">다운로드</span>
              </a>
            </>
          ) : null}

          {canEdit ? (
            <>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
                aria-label={isUploading ? "PDF 업로드 중" : "PDF 업로드"}
                title="PDF 업로드"
                className="inline-flex min-h-9 items-center gap-1 rounded-full bg-field-primary px-2.5 text-[11px] font-black text-white transition hover:bg-field-secondary active:scale-95 disabled:cursor-wait disabled:opacity-60"
              >
                {isUploading
                  ? <PixelDogLoader size="xs" compact />
                  : <Upload className="h-3.5 w-3.5" aria-hidden />}
                <span className="hidden sm:inline">{isUploading ? "업로드 중" : "+ PDF"}</span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf,.pdf"
                multiple
                className="sr-only"
                onChange={handleUpload}
              />
              {selectedAsset ? (
                <button
                  type="button"
                  onClick={() => void handleDelete(selectedAsset)}
                  aria-label={`${selectedAsset.filename} 삭제`}
                  title="선택한 PDF 삭제"
                  className="grid h-9 w-9 place-items-center rounded-full border border-red-200 bg-white text-field-danger transition hover:bg-red-50 active:scale-95"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                </button>
              ) : null}
            </>
          ) : null}
        </div>
      </div>

      {errorMessage ? (
        <p role="alert" className="border-l-2 border-field-danger bg-red-50 px-2.5 py-1.5 text-xs font-bold text-field-danger">
          {errorMessage}
        </p>
      ) : null}

      <section
        aria-label="시나리오 PDF 읽기"
        className="h-[calc(100dvh-8.75rem)] min-h-[30rem] min-w-0 overflow-hidden bg-white sm:h-[calc(100dvh-8rem)]"
      >
        {selectedAsset ? (
          <iframe
            key={selectedAsset.id}
            src={selectedAsset.publicUrl}
            title={`${selectedAsset.filename} PDF`}
            className="block h-full w-full border-0 bg-white"
          />
        ) : (
          <div className="grid h-full place-items-center px-4 text-center text-sm font-bold text-field-muted">
            {canEdit ? "PDF를 업로드하면 바로 여기에서 읽을 수 있습니다." : "등록된 시나리오 PDF가 없습니다."}
          </div>
        )}
      </section>
    </div>
  );
}
