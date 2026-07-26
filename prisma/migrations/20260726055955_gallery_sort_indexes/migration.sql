-- CreateIndex
CREATE INDEX "GalleryItem_visibility_publishedAt_id_idx" ON "GalleryItem"("visibility", "publishedAt", "id");

-- CreateIndex
CREATE INDEX "GalleryItem_visibility_upvoteCount_id_idx" ON "GalleryItem"("visibility", "upvoteCount", "id");
