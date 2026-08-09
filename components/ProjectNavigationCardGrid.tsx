"use client";

import type { MouseEvent, ReactNode, RefCallback } from "react";
import Link from "next/link";
import { ChevronDown, type LucideIcon } from "lucide-react";
import type { ProjectNavigationItemId } from "@/lib/projectNavigation";

export type ProjectNavigationCardItem = {
  id: ProjectNavigationItemId | "projectHome";
  label: string;
  href: string;
  icon: LucideIcon;
  active: boolean;
  roundKind: "dailyPlans" | "progress" | null;
  expanded: boolean;
};

type ProjectNavigationCardGridProps = {
  items: ProjectNavigationCardItem[];
  instanceId: string;
  onLinkClick: (event: MouseEvent<HTMLAnchorElement>, href: string) => void;
  onToggleRounds: (kind: "dailyPlans" | "progress") => void;
  renderRoundContent: (kind: "dailyPlans" | "progress") => ReactNode;
  dailyPlansGuideRef?: RefCallback<HTMLDivElement>;
  onDailyPlansGuide?: (anchor: HTMLDivElement) => void;
};

/** 데스크톱 고정 패널과 모바일 drawer가 공유하는 프로젝트 기능 카드 grid입니다. */
export function ProjectNavigationCardGrid({
  items,
  instanceId,
  onLinkClick,
  onToggleRounds,
  renderRoundContent,
  dailyPlansGuideRef,
  onDailyPlansGuide
}: ProjectNavigationCardGridProps) {
  return (
    <ul className="project-navigation__card-grid">
      {items.map((item) => {
        const Icon = item.icon;
        const roundKind = item.roundKind;
        return (
          <li key={item.id} className="min-w-0">
            <div
              ref={item.id === "dailyPlans" ? dailyPlansGuideRef : undefined}
              onPointerEnter={item.id === "dailyPlans"
                ? (event) => onDailyPlansGuide?.(event.currentTarget)
                : undefined}
              onFocusCapture={item.id === "dailyPlans"
                ? (event) => onDailyPlansGuide?.(event.currentTarget)
                : undefined}
              className="project-navigation__card"
              data-active={item.active ? "true" : "false"}
              data-has-rounds={roundKind ? "true" : "false"}
            >
              {roundKind ? (
                <>
                  <button
                    type="button"
                    aria-label={`${item.label} 회차 목록 ${item.expanded ? "접기" : "펼치기"}`}
                    aria-controls={`project-navigation-${instanceId}-rounds-${roundKind}`}
                    aria-expanded={item.expanded}
                    onClick={() => onToggleRounds(roundKind)}
                    className="project-navigation__card-link project-navigation__card-toggle"
                  >
                    <Icon className="project-navigation__card-icon" strokeWidth={2} aria-hidden />
                    <span className="project-navigation__card-label">{item.label}</span>
                    <ChevronDown
                      className="project-navigation__card-chevron"
                      data-expanded={item.expanded ? "true" : "false"}
                      aria-hidden
                    />
                  </button>
                  <div
                    id={`project-navigation-${instanceId}-rounds-${roundKind}`}
                    className="ui-accordion project-navigation__card-accordion"
                    data-expanded={item.expanded ? "true" : "false"}
                    aria-hidden={!item.expanded}
                    inert={!item.expanded}
                  >
                    <div className="ui-accordion-inner project-navigation__card-accordion-inner">
                      {renderRoundContent(roundKind)}
                    </div>
                  </div>
                </>
              ) : (
                <Link
                  href={item.href}
                  onClick={(event) => onLinkClick(event, item.href)}
                  aria-current={item.active ? "page" : undefined}
                  className="project-navigation__card-link"
                >
                  <Icon className="project-navigation__card-icon" strokeWidth={2} aria-hidden />
                  <span className="project-navigation__card-label">{item.label}</span>
                </Link>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
