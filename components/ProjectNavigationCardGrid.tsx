"use client";

import type { MouseEvent } from "react";
import Link from "next/link";
import { ChevronDown, type LucideIcon } from "lucide-react";
import type { ProjectNavigationItemId } from "@/lib/projectNavigation";

export type ProjectNavigationCardItem = {
  id: ProjectNavigationItemId;
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
};

/** 데스크톱 고정 패널과 모바일 drawer가 공유하는 프로젝트 기능 카드 grid입니다. */
export function ProjectNavigationCardGrid({
  items,
  instanceId,
  onLinkClick,
  onToggleRounds
}: ProjectNavigationCardGridProps) {
  return (
    <ul className="project-navigation__card-grid">
      {items.map((item) => {
        const Icon = item.icon;
        const roundKind = item.roundKind;
        return (
          <li key={item.id} className="min-w-0">
            <div
              className="project-navigation__card"
              data-active={item.active ? "true" : "false"}
            >
              <Link
                href={item.href}
                onClick={(event) => onLinkClick(event, item.href)}
                aria-current={item.active ? "page" : undefined}
                className="project-navigation__card-link"
              >
                <Icon className="project-navigation__card-icon" strokeWidth={2} aria-hidden />
                <span className="project-navigation__card-label">{item.label}</span>
              </Link>

              {roundKind ? (
                <button
                  type="button"
                  aria-label={`${item.label} 회차 목록 ${item.expanded ? "접기" : "펼치기"}`}
                  aria-controls={`project-navigation-${instanceId}-rounds-${roundKind}`}
                  aria-expanded={item.expanded}
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggleRounds(roundKind);
                  }}
                  className="project-navigation__card-disclosure"
                >
                  <ChevronDown
                    className="project-navigation__card-chevron"
                    data-expanded={item.expanded ? "true" : "false"}
                    aria-hidden
                  />
                </button>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
