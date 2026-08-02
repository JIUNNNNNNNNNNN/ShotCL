"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Search, Unlink, X } from "lucide-react";
import { PixelDogLoader } from "@/components/PixelDogLoader";
import { ShotOverheadPreview } from "@/components/ShotOverheadPreview";
import { listProjectReferenceAssets } from "@/lib/data/projectReferenceAssets";
import {
  listOverheadDiagramArchive,
  saveShotMediaLink
} from "@/lib/data/shotMediaArchive";
import type {
  OverheadDiagramArchiveItem,
  ProjectReferenceAsset,
  Shot,
  ShotMediaLink,
  ShotMediaType
} from "@/lib/types";

type PickerAsset = {
  id: string;
  source: "reference" | "diagram";
  title: string;
  memo: string;
  sceneNo: string;
  cutNo: string;
  publicUrl: string | null;
  thumbnailUrl: string | null;
  diagram: OverheadDiagramArchiveItem["diagram"] | null;
  sortOrder: number;
  createdAt: string;
};

const ARCHIVE_PICKER_COLLATOR = new Intl.Collator("ko-KR", { numeric: true, sensitivity: "base" });

export function ShotArchivePicker({
  shot,
  initialType,
  selectedLinks,
  readOnly,
  onClose,
  onSaved
}: {
  shot: Shot;
  initialType: ShotMediaType;
  selectedLinks: ShotMediaLink[];
  readOnly: boolean;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const [mediaType, setMediaType] = useState<ShotMediaType>(initialType);
  const [assets, setAssets] = useState<PickerAsset[]>([]);
  const [query, setQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const selected = selectedLinks.find((link) => link.mediaType === mediaType) ?? null;

  useEffect(() => {
    let active = true;
    setIsLoading(true);
    setErrorMessage("");
    Promise.all([
      listProjectReferenceAssets(shot.projectId, mediaType),
      mediaType === "overhead" ? listOverheadDiagramArchive(shot.projectId) : Promise.resolve([])
    ]).then(([references, diagrams]) => {
      if (!active) return;
      const referenceAssets = references
        .filter((asset) => isPickerImage(asset) && !asset.groupId?.startsWith("source:"))
        .sort(compareReferencePickerAssets)
        .map(referencePickerAsset);
      const diagramAssets = diagrams.map(diagramPickerAsset);
      setAssets([...diagramAssets, ...referenceAssets]);
    }).catch((error) => {
      if (active) setErrorMessage(error instanceof Error ? error.message : "아카이브 자료를 불러오지 못했습니다.");
    }).finally(() => {
      if (active) setIsLoading(false);
    });
    return () => {
      active = false;
    };
  }, [mediaType, shot.projectId]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ko-KR");
    if (!normalized) return assets;
    return assets.filter((asset) => [
      asset.title,
      asset.memo,
      asset.sceneNo,
      asset.cutNo
    ].join(" ").toLocaleLowerCase("ko-KR").includes(normalized));
  }, [assets, query]);

  async function selectAsset(asset: PickerAsset | null) {
    if (readOnly || isSaving) return;
    setIsSaving(true);
    setErrorMessage("");
    try {
      await saveShotMediaLink(
        shot,
        mediaType,
        asset ? { assetId: asset.id, source: asset.source } : null
      );
      await onSaved();
      if (asset) onClose();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "컷 자료 연결을 저장하지 못했습니다.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[75] flex items-end justify-center bg-field-bg/80 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="부감도와 콘티 아카이브 선택">
      <section className="flex max-h-[90dvh] w-full max-w-4xl flex-col border border-field-divider bg-field-dialog shadow-dialog">
        <header className="flex items-center justify-between gap-3 border-b border-field-divider px-4 py-3">
          <div className="min-w-0">
            <h2 className="font-display truncate text-lg font-bold text-field-text">아카이브에서 선택</h2>
            <p className="truncate text-xs font-normal text-field-muted">S#{shot.sceneNumber} · C#{shot.cutNumber}{readOnly ? " · 읽기 전용" : ""}</p>
          </div>
          <button type="button" onClick={onClose} className="grid h-10 w-10 place-items-center border border-field-divider bg-field-panel text-field-muted transition-colors hover:border-field-subtle hover:bg-field-hover hover:text-field-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary" aria-label="자료 선택 닫기">
            <X className="h-5 w-5" aria-hidden />
          </button>
        </header>

        <div className="grid gap-3 border-b border-field-divider p-3">
          <div className="grid grid-cols-2 gap-2">
            {(["overhead", "storyboard"] as const).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setMediaType(type)}
                className={`min-h-10 border text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary ${mediaType === type ? "border-field-primary/80 bg-field-primary/10 text-field-primary" : "border-field-divider bg-field-panel text-field-text hover:border-field-subtle hover:bg-field-hover"}`}
              >
                {type === "overhead" ? "부감도" : "콘티"}
              </button>
            ))}
          </div>
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-field-muted" aria-hidden />
            <input value={query} onChange={(event) => setQuery(event.target.value)} className="min-h-10 w-full border border-field-divider bg-field-input pl-9 pr-3 text-sm font-normal text-field-text outline-none placeholder:text-field-disabled focus:border-field-primary focus:ring-1 focus:ring-field-primary" placeholder="제목, 메모, 씬, 컷 검색" />
          </label>
          {selected ? (
            <div className="flex items-center justify-between gap-2 border border-field-primary/70 bg-field-primary/10 px-3 py-2">
              <p className="min-w-0 truncate text-xs font-bold text-field-primary">현재 연결: {selected.filename}</p>
              {!readOnly ? (
                <button type="button" disabled={isSaving} onClick={() => selectAsset(null)} className="inline-flex min-h-8 shrink-0 items-center gap-1  border border-field-danger/60 bg-field-panel px-2 text-[11px] font-bold text-field-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-danger">
                  <Unlink className="h-3.5 w-3.5" aria-hidden />
                  선택 해제
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {isLoading ? <PixelDogLoader size="md" /> : errorMessage ? (
            <p role="alert" className="border border-field-danger bg-field-danger/10 p-3 text-sm font-normal text-field-danger">{errorMessage}</p>
          ) : filtered.length === 0 ? (
            <p className="py-10 text-center text-sm font-normal text-field-muted">선택할 {mediaType === "overhead" ? "부감도" : "콘티"} 자료가 없습니다.</p>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {filtered.map((asset) => {
                const isSelected = selected?.assetId === asset.id && selected.source === asset.source;
                return (
                  <button
                    key={`${asset.source}-${asset.id}`}
                    type="button"
                    disabled={readOnly || isSaving}
                    onClick={() => selectAsset(asset)}
                    className={`relative grid min-w-0 gap-1 border p-1.5 text-left transition-colors disabled:cursor-default ${isSelected ? "border-field-primary/80 bg-field-primary/10 ring-2 ring-field-primary/20" : "border-field-divider bg-field-panel hover:border-field-subtle hover:bg-field-hover"}`}
                  >
                    <div className="grid aspect-[4/3] w-full place-items-center bg-field-soft">
                      {asset.publicUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={asset.thumbnailUrl || asset.publicUrl}
                          alt={asset.title}
                          loading="lazy"
                          decoding="async"
                          className="block h-full w-full  object-contain"
                        />
                      ) : asset.diagram ? (
                        <ShotOverheadPreview diagram={asset.diagram} label={`${asset.title} 부감도`} />
                      ) : null}
                    </div>
                    <p className="truncate px-1 text-xs font-bold text-field-text">{asset.title}</p>
                    <p className="truncate px-1 text-[10px] font-normal text-field-muted">
                      {[asset.sceneNo && `S#${asset.sceneNo}`, asset.cutNo && `C#${asset.cutNo}`, asset.memo].filter(Boolean).join(" · ") || "태그 없음"}
                    </p>
                    {isSelected ? <span className="absolute right-2 top-2 grid h-6 w-6 place-items-center border border-field-primary/80 bg-field-elevated text-field-primary"><Check className="h-4 w-4" aria-hidden /></span> : null}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function referencePickerAsset(asset: ProjectReferenceAsset): PickerAsset {
  return {
    id: asset.id,
    source: "reference",
    title: asset.crop.title || asset.filename,
    memo: asset.crop.memo || "",
    sceneNo: asset.sceneNo || "",
    cutNo: asset.cutNo || "",
    publicUrl: asset.publicUrl,
    thumbnailUrl: asset.crop.thumbnailUrl || null,
    diagram: null,
    sortOrder: Number.isSafeInteger(asset.sortOrder) && asset.sortOrder > 0 ? asset.sortOrder : 0,
    createdAt: asset.createdAt
  };
}

function diagramPickerAsset(asset: OverheadDiagramArchiveItem): PickerAsset {
  return {
    id: asset.id,
    source: "diagram",
    title: asset.title,
    memo: asset.memo,
    sceneNo: asset.sceneNo,
    cutNo: asset.cutNo,
    publicUrl: null,
    thumbnailUrl: null,
    diagram: asset.diagram,
    sortOrder: Number.MAX_SAFE_INTEGER,
    createdAt: asset.createdAt
  };
}

function compareReferencePickerAssets(left: ProjectReferenceAsset, right: ProjectReferenceAsset) {
  const sceneOrder = ARCHIVE_PICKER_COLLATOR.compare(
    left.crop.sceneNumber || left.sceneNo || "",
    right.crop.sceneNumber || right.sceneNo || ""
  );
  if (sceneOrder !== 0) return sceneOrder;
  const leftCut = Number(left.crop.cutNumber ?? left.cutNo);
  const rightCut = Number(right.crop.cutNumber ?? right.cutNo);
  const safeLeftCut = Number.isSafeInteger(leftCut) && leftCut > 0 ? leftCut : Number.MAX_SAFE_INTEGER;
  const safeRightCut = Number.isSafeInteger(rightCut) && rightCut > 0 ? rightCut : Number.MAX_SAFE_INTEGER;
  if (safeLeftCut !== safeRightCut) return safeLeftCut - safeRightCut;
  const leftOrder = Number.isSafeInteger(left.sortOrder) && left.sortOrder > 0 ? left.sortOrder : 0;
  const rightOrder = Number.isSafeInteger(right.sortOrder) && right.sortOrder > 0 ? right.sortOrder : 0;
  if (leftOrder !== rightOrder) return leftOrder - rightOrder;
  const createdOrder = Date.parse(left.createdAt) - Date.parse(right.createdAt);
  if (Number.isFinite(createdOrder) && createdOrder !== 0) return createdOrder;
  return left.id.localeCompare(right.id);
}

function isPickerImage(asset: ProjectReferenceAsset) {
  return asset.mimeType.startsWith("image/") || /\.(?:jpe?g|png|webp)$/i.test(asset.filename);
}
