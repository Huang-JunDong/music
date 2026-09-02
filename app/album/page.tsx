"use client";

/** 专辑详情（?id=&source=） */
import { Suspense } from "react";
import { CollectionDetail, DetailFallback } from "@/components/collection-detail";

export default function AlbumPage() {
  return (
    <Suspense fallback={<DetailFallback />}>
      <CollectionDetail kind="album" />
    </Suspense>
  );
}
