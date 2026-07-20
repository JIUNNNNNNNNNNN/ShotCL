import type { ShotDraft } from "@/lib/types";

/** 실제 AI 연결 전에도 앱 흐름을 테스트할 수 있게 임시 컷 리스트를 만듭니다. */
export function mockAnalyzeStoryboard(fileName: string): ShotDraft[] {
  const cleanName = fileName.replace(/\.[^/.]+$/, "").replace(/[-_]+/g, " ").trim();
  const boardName = cleanName || "일일촬영계획서";

  const drafts: ShotDraft[] = [
    {
      sceneNumber: "1",
      cutNumber: "1",
      title: "주인공 현관 앞",
      description: "주인공이 현관 앞에서 잠시 멈춰 선다.",
      location: "현관",
      characters: ["주인공"],
      memo: `${boardName} mock 결과입니다. 컷 단위 분리 예시입니다.`,
      orderIndex: 1,
      status: "pending",
      sourcePage: 1,
      sourceRow: 3
    },
    {
      sceneNumber: "1",
      cutNumber: "2",
      title: "문고리 클로즈업",
      description: "손이 문고리를 잡는 클로즈업.",
      location: "현관",
      characters: ["주인공"],
      memo: "손 클로즈업, 소품 위치 확인",
      orderIndex: 2,
      status: "pending",
      sourcePage: 1,
      sourceRow: 4
    },
    {
      sceneNumber: "1",
      cutNumber: "3",
      title: "문을 여는 와이드",
      description: "주인공이 문을 열고 내부로 들어간다.",
      location: "현관",
      characters: ["주인공"],
      memo: "동선 시작점 체크",
      orderIndex: 3,
      status: "pending",
      sourcePage: 1,
      sourceRow: 5
    },
    {
      sceneNumber: "1",
      cutNumber: "4",
      title: "인물 반응",
      description: "주인공이 내부를 보고 짧게 멈춘다.",
      location: "거실 입구",
      characters: ["주인공"],
      memo: "감정 컷",
      orderIndex: 4,
      status: "pending",
      sourcePage: 1,
      sourceRow: 6
    },
    {
      sceneNumber: "1",
      cutNumber: "5",
      title: "소품 인서트",
      description: "테이블 위 중요한 소품을 보여준다.",
      location: "거실",
      characters: [],
      memo: "INS",
      orderIndex: 5,
      status: "pending",
      sourcePage: 1,
      sourceRow: 7
    },
    {
      sceneNumber: "2",
      cutNumber: "1",
      title: "상대 인물 등장",
      description: "상대 인물이 프레임 안으로 들어온다.",
      location: "거실",
      characters: ["주인공", "상대역"],
      memo: "마스터",
      orderIndex: 6,
      status: "pending",
      sourcePage: 2,
      sourceRow: 2
    },
    {
      sceneNumber: "2",
      cutNumber: "2",
      title: "오버숄더 대화",
      description: "주인공 어깨 너머로 상대 인물의 대사를 잡는다.",
      location: "거실",
      characters: ["상대역"],
      memo: "어깨 방향 주의",
      orderIndex: 7,
      status: "pending",
      sourcePage: 2,
      sourceRow: 3
    },
    {
      sceneNumber: "2",
      cutNumber: "3",
      title: "리버스 오버숄더",
      description: "상대 인물 어깨 너머로 주인공 반응을 잡는다.",
      location: "거실",
      characters: ["주인공"],
      memo: "연속성 확인",
      orderIndex: 8,
      status: "pending",
      sourcePage: 2,
      sourceRow: 4
    },
    {
      sceneNumber: "2",
      cutNumber: "4",
      title: "POV 확인 컷",
      description: "주인공 시점으로 테이블 위 문서를 본다.",
      location: "거실",
      characters: ["주인공"],
      memo: "POV",
      orderIndex: 9,
      status: "pending",
      sourcePage: 2,
      sourceRow: 5
    },
    {
      sceneNumber: "3",
      cutNumber: "1",
      title: "외부 이동 시작",
      description: "인물이 건물 밖으로 걸어 나온다.",
      location: "건물 입구",
      characters: ["주인공"],
      memo: "야외 노출 체크",
      orderIndex: 10,
      status: "pending",
      sourcePage: 3,
      sourceRow: 2
    },
    {
      sceneNumber: "3",
      cutNumber: "2",
      title: "발걸음 인서트",
      description: "인물의 발걸음을 낮은 앵글로 잡는다.",
      location: "건물 입구",
      characters: ["주인공"],
      memo: "INS",
      orderIndex: 11,
      status: "pending",
      sourcePage: 3,
      sourceRow: 3
    },
    {
      sceneNumber: "3",
      cutNumber: "3",
      title: "차량 쪽 이동",
      description: "주인공이 차량 방향으로 이동한다.",
      location: "주차장",
      characters: ["주인공"],
      memo: "차량 위치 고정",
      orderIndex: 12,
      status: "pending",
      sourcePage: 3,
      sourceRow: 4
    },
    {
      sceneNumber: "3",
      cutNumber: "4",
      title: "차 문 손잡이",
      description: "차 문 손잡이를 잡는 손 클로즈업.",
      location: "주차장",
      characters: ["주인공"],
      memo: "손 클로즈업",
      orderIndex: 13,
      status: "pending",
      sourcePage: 3,
      sourceRow: 5
    },
    {
      sceneNumber: "4",
      cutNumber: "1",
      title: "차 안 리액션",
      description: "차 안에서 주인공이 숨을 고른다.",
      location: "차량 내부",
      characters: ["주인공"],
      memo: "정적인 컷",
      orderIndex: 14,
      status: "pending",
      sourcePage: 4,
      sourceRow: 2
    },
    {
      sceneNumber: "4",
      cutNumber: "2",
      title: "출발 와이드",
      description: "차량이 천천히 프레임 밖으로 나간다.",
      location: "주차장",
      characters: ["주인공"],
      memo: "마지막 연결 컷",
      orderIndex: 15,
      status: "pending",
      sourcePage: 4,
      sourceRow: 3
    }
  ];

  return drafts;
}
