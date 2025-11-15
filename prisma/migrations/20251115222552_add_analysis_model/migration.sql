-- CreateTable
CREATE TABLE "Analysis" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "external_workspace_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "progress" INTEGER,
    "message" TEXT,
    "current_step" TEXT,
    "status_url" TEXT,
    "result_url" TEXT,
    "result" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Analysis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Analysis_workspaceId_key" ON "Analysis"("workspaceId");

-- AddForeignKey
ALTER TABLE "Analysis" ADD CONSTRAINT "Analysis_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;
