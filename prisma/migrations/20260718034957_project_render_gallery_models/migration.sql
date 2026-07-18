-- CreateEnum
CREATE TYPE "RepoVisibility" AS ENUM ('private', 'public');

-- CreateEnum
CREATE TYPE "ProjectCreatedFrom" AS ENUM ('votd', 'passage', 'blank', 'demo', 'import');

-- CreateEnum
CREATE TYPE "ProjectVersionState" AS ENUM ('base', 'working', 'published', 'archived');

-- CreateEnum
CREATE TYPE "RenderStatus" AS ENUM ('queued', 'bundling', 'synthesizing', 'encoding', 'uploading', 'completed', 'failed', 'canceled');

-- CreateEnum
CREATE TYPE "GalleryVisibility" AS ENUM ('public', 'unlisted');

-- CreateEnum
CREATE TYPE "AiGenerationKind" AS ENUM ('storyboard', 'script', 'image', 'narration', 'music', 'video');

-- CreateEnum
CREATE TYPE "AiProvider" AS ENUM ('gloo', 'openrouter');

-- CreateEnum
CREATE TYPE "ProjectJobKind" AS ENUM ('scaffold', 'import_verify', 'commit', 'publish');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('queued', 'running', 'succeeded', 'failed', 'canceled');

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "repoOwner" TEXT NOT NULL,
    "repoName" TEXT NOT NULL,
    "repoVisibility" "RepoVisibility" NOT NULL,
    "createdFrom" "ProjectCreatedFrom" NOT NULL,
    "currentBranch" TEXT NOT NULL,
    "thumbnailAssetKey" TEXT,
    "lastRenderJobId" TEXT,
    "lastOpenedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectVersion" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "semver" TEXT NOT NULL,
    "branchName" TEXT NOT NULL,
    "state" "ProjectVersionState" NOT NULL,
    "commitMessage" TEXT,
    "autoSummary" TEXT,
    "changedFiles" JSONB NOT NULL,
    "headCommitSha" TEXT,
    "prNumber" INTEGER,
    "prUrl" TEXT,
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "ProjectVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RenderJob" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "RenderStatus" NOT NULL,
    "framesDone" INTEGER NOT NULL DEFAULT 0,
    "framesTotal" INTEGER NOT NULL DEFAULT 0,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "fps" INTEGER NOT NULL,
    "aspectRatio" TEXT NOT NULL,
    "codec" TEXT NOT NULL,
    "outputAssetKey" TEXT,
    "thumbnailAssetKey" TEXT,
    "runInBackground" BOOLEAN NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "RenderJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiGeneration" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT,
    "sceneId" TEXT,
    "kind" "AiGenerationKind" NOT NULL,
    "provider" "AiProvider" NOT NULL,
    "model" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "status" "JobStatus" NOT NULL,
    "providerJobId" TEXT,
    "resultJson" JSONB,
    "resultAssetKey" TEXT,
    "error" TEXT,
    "tokenUsage" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "AiGeneration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GalleryItem" (
    "id" TEXT NOT NULL,
    "renderJobId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "scriptureReference" TEXT NOT NULL,
    "translation" TEXT NOT NULL,
    "scriptureBook" TEXT NOT NULL,
    "durationSeconds" INTEGER NOT NULL,
    "videoAssetKey" TEXT NOT NULL,
    "thumbnailAssetKey" TEXT NOT NULL,
    "visibility" "GalleryVisibility" NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "upvoteCount" INTEGER NOT NULL DEFAULT 0,
    "viewCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "GalleryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GalleryUpvote" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "galleryItemId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GalleryUpvote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectJob" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "versionId" TEXT,
    "kind" "ProjectJobKind" NOT NULL,
    "status" "JobStatus" NOT NULL,
    "stages" JSONB NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ProjectJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Project_ownerId_idx" ON "Project"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "Project_ownerId_slug_key" ON "Project"("ownerId", "slug");

-- CreateIndex
CREATE INDEX "ProjectVersion_projectId_idx" ON "ProjectVersion"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectVersion_projectId_semver_key" ON "ProjectVersion"("projectId", "semver");

-- CreateIndex
CREATE INDEX "RenderJob_projectId_idx" ON "RenderJob"("projectId");

-- CreateIndex
CREATE INDEX "RenderJob_versionId_idx" ON "RenderJob"("versionId");

-- CreateIndex
CREATE INDEX "RenderJob_userId_idx" ON "RenderJob"("userId");

-- CreateIndex
CREATE INDEX "AiGeneration_userId_idx" ON "AiGeneration"("userId");

-- CreateIndex
CREATE INDEX "AiGeneration_projectId_idx" ON "AiGeneration"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "GalleryItem_renderJobId_key" ON "GalleryItem"("renderJobId");

-- CreateIndex
CREATE INDEX "GalleryItem_projectId_idx" ON "GalleryItem"("projectId");

-- CreateIndex
CREATE INDEX "GalleryItem_ownerId_idx" ON "GalleryItem"("ownerId");

-- CreateIndex
CREATE INDEX "GalleryItem_scriptureBook_idx" ON "GalleryItem"("scriptureBook");

-- CreateIndex
CREATE INDEX "GalleryUpvote_galleryItemId_idx" ON "GalleryUpvote"("galleryItemId");

-- CreateIndex
CREATE UNIQUE INDEX "GalleryUpvote_userId_galleryItemId_key" ON "GalleryUpvote"("userId", "galleryItemId");

-- CreateIndex
CREATE INDEX "ProjectJob_projectId_idx" ON "ProjectJob"("projectId");

-- CreateIndex
CREATE INDEX "ProjectJob_userId_idx" ON "ProjectJob"("userId");

-- CreateIndex
CREATE INDEX "ProjectJob_versionId_idx" ON "ProjectJob"("versionId");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectVersion" ADD CONSTRAINT "ProjectVersion_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RenderJob" ADD CONSTRAINT "RenderJob_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RenderJob" ADD CONSTRAINT "RenderJob_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ProjectVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RenderJob" ADD CONSTRAINT "RenderJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiGeneration" ADD CONSTRAINT "AiGeneration_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiGeneration" ADD CONSTRAINT "AiGeneration_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GalleryItem" ADD CONSTRAINT "GalleryItem_renderJobId_fkey" FOREIGN KEY ("renderJobId") REFERENCES "RenderJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GalleryItem" ADD CONSTRAINT "GalleryItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GalleryItem" ADD CONSTRAINT "GalleryItem_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GalleryUpvote" ADD CONSTRAINT "GalleryUpvote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GalleryUpvote" ADD CONSTRAINT "GalleryUpvote_galleryItemId_fkey" FOREIGN KEY ("galleryItemId") REFERENCES "GalleryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectJob" ADD CONSTRAINT "ProjectJob_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectJob" ADD CONSTRAINT "ProjectJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectJob" ADD CONSTRAINT "ProjectJob_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ProjectVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
