import { NextResponse } from "next/server";

type NaverLocalItem = {
  title?: string;
  category?: string;
  address?: string;
  roadAddress?: string;
  mapx?: string;
  mapy?: string;
};

const MISSING_KEY_MESSAGE = "네이버 지도 API 키가 설정되지 않아 장소 검색을 사용할 수 없습니다.";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = (searchParams.get("q") ?? searchParams.get("query") ?? "").trim();
  const clientId = process.env.NAVER_SEARCH_CLIENT_ID;
  const clientSecret = process.env.NAVER_SEARCH_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return NextResponse.json({
      configured: false,
      items: [],
      error: MISSING_KEY_MESSAGE
    });
  }

  if (!query) {
    return NextResponse.json({
      configured: true,
      items: [],
      error: "검색어를 입력해주세요."
    });
  }

  try {
    const naverUrl = new URL("https://openapi.naver.com/v1/search/local.json");
    naverUrl.searchParams.set("query", query);
    naverUrl.searchParams.set("display", "5");
    naverUrl.searchParams.set("sort", "random");

    const response = await fetch(naverUrl, {
      headers: {
        "X-Naver-Client-Id": clientId,
        "X-Naver-Client-Secret": clientSecret
      },
      cache: "no-store"
    });

    if (!response.ok) {
      return NextResponse.json(
        {
          configured: true,
          items: [],
          error: "네이버 장소 검색에 실패했습니다. 키 설정 또는 네이버 API 권한을 확인해주세요."
        },
        { status: 200 }
      );
    }

    const payload = (await response.json()) as { items?: NaverLocalItem[] };
    const items = (payload.items ?? []).map(normalizeNaverLocalItem);

    return NextResponse.json({
      configured: true,
      items,
      error: ""
    });
  } catch (error) {
    return NextResponse.json(
      {
        configured: true,
        items: [],
        error: error instanceof Error ? error.message : "네이버 장소 검색 중 오류가 발생했습니다."
      },
      { status: 200 }
    );
  }
}

function normalizeNaverLocalItem(item: NaverLocalItem) {
  const title = stripHtml(item.title ?? "");
  const category = stripHtml(item.category ?? "");
  const address = item.address ?? "";
  const roadAddress = item.roadAddress ?? "";
  const mapx = item.mapx ?? "";
  const mapy = item.mapy ?? "";
  const lng = parseNaverCoordinate(mapx);
  const lat = parseNaverCoordinate(mapy);
  const addressForUrl = [title, roadAddress || address].filter(Boolean).join(" ");

  return {
    title,
    category,
    address,
    roadAddress,
    mapx,
    mapy,
    lat,
    lng,
    naverMapUrl: `https://map.naver.com/p/search/${encodeURIComponent(addressForUrl || title)}`
  };
}

function stripHtml(value: string) {
  return value.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").trim();
}

function parseNaverCoordinate(value: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed / 10000000;
}
