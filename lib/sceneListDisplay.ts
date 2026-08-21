import type {
  ProjectSceneActorCell,
  ProjectSceneItem
} from "@/lib/types";

export type SceneListPaletteStyle = {
  background: string;
  color: string;
};

export type SceneListActorCellState =
  | { mode: "empty"; text: "" }
  | { mode: "color"; text: "" }
  | { mode: "text"; text: string };

const actorPalette = [
  { background: "#fce4ec", headerBackground: "#f8bbd0", color: "#6b1835" },
  { background: "#e3f2fd", headerBackground: "#bbdefb", color: "#17486b" },
  { background: "#e8f5e9", headerBackground: "#c8e6c9", color: "#24532a" },
  { background: "#fff8e1", headerBackground: "#ffecb3", color: "#66510b" },
  { background: "#f3e5f5", headerBackground: "#e1bee7", color: "#53305d" },
  { background: "#fff3e0", headerBackground: "#ffe0b2", color: "#6a3b10" }
];

const locationPalette: SceneListPaletteStyle[] = [
  { background: "#fff4c7", color: "#584607" },
  { background: "#dff1df", color: "#224d29" },
  { background: "#f8dfd1", color: "#62311d" },
  { background: "#dcedf2", color: "#204955" },
  { background: "#e8e0f2", color: "#45325b" },
  { background: "#f4dfe8", color: "#5e2b40" },
  { background: "#e8efcf", color: "#41521c" },
  { background: "#dce8fb", color: "#28466d" }
];

export function getActorCellState(
  item: ProjectSceneItem,
  role: string
): SceneListActorCellState {
  const key = role.trim().toLocaleLowerCase();
  const stored = Object.entries(item.actorCells ?? {}).find(
    ([candidate]) => candidate.trim().toLocaleLowerCase() === key
  )?.[1];
  if (stored?.mode === "text" && String(stored.text ?? "").trim()) {
    return { mode: "text", text: String(stored.text).slice(0, 120) };
  }
  if (stored?.mode === "color") return { mode: "color", text: "" };
  const legacy = parseCharacters(item.characters).some(
    (character) => character.toLocaleLowerCase() === key
  );
  return legacy ? { mode: "color", text: "" } : { mode: "empty", text: "" };
}

export function setActorCellState(
  item: ProjectSceneItem,
  role: string,
  state: SceneListActorCellState
): ProjectSceneItem {
  const normalizedRole = role.trim();
  const roleKey = normalizedRole.toLocaleLowerCase();
  const actorCells: Record<string, ProjectSceneActorCell> = { ...(item.actorCells ?? {}) };
  const existingActorId = Object.entries(actorCells).find(
    ([key]) => key.trim().toLocaleLowerCase() === roleKey
  )?.[1].actorId;
  Object.keys(actorCells).forEach((key) => {
    if (key.trim().toLocaleLowerCase() === roleKey) delete actorCells[key];
  });
  let characters = parseCharacters(item.characters).filter(
    (character) => character.toLocaleLowerCase() !== roleKey
  );
  if (state.mode === "color") {
    actorCells[normalizedRole] = {
      mode: "color",
      ...(existingActorId ? { actorId: existingActorId } : {})
    };
    characters = [...characters, normalizedRole];
  } else if (state.mode === "text" && state.text.trim()) {
    actorCells[normalizedRole] = {
      mode: "text",
      text: state.text.slice(0, 120),
      ...(existingActorId ? { actorId: existingActorId } : {})
    };
  }
  return { ...item, actorCells, characters: characters.join(", ") };
}

export function parseCharacters(value: string) {
  return Array.from(new Set(
    value.split(/[,，/|\n]+/).map((character) => character.trim()).filter(Boolean)
  ));
}

export function getActorStyle(index: number) {
  return actorPalette[index % actorPalette.length] ?? actorPalette[0]!;
}

export function createLocationStyles(items: ProjectSceneItem[]) {
  const locations = Array.from(new Set(
    items.map((item) => item.mainLocation.trim() || item.subLocation.trim()).filter(Boolean)
  )).sort((a, b) => a.localeCompare(b, "ko"));
  return new Map(locations.map((location, index) => [
    location.toLocaleLowerCase(),
    locationPalette[index % locationPalette.length]!
  ]));
}

export function getLocationStyle(
  item: Pick<ProjectSceneItem, "mainLocation" | "subLocation">,
  styles: Map<string, SceneListPaletteStyle>
) {
  const key = (item.mainLocation.trim() || item.subLocation.trim()).toLocaleLowerCase();
  return key ? styles.get(key) ?? { background: "#fff", color: "#151515" } : {
    background: "#fff",
    color: "#151515"
  };
}
