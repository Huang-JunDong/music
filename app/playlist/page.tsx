"use client";

/** 歌单详情（?id=&source=） */
import { Suspense } from "react";
import { CollectionDetail, DetailFallback } from "@/components/collection-detail";

export default function PlaylistPage() {
  return (
    <Suspense fallback={<DetailFallback />}>
      <CollectionDetail kind="playlist" />
    </Suspense>
  );
}
