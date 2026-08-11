import { redirect } from "next/navigation";

/** 프로젝트 생성은 Google 계정·편집자 검증이 적용되는 Main New 흐름으로 통일합니다. */
export default function LegacyNewProjectPage() {
  redirect("/");
}
