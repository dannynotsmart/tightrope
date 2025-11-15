import type { NextApiRequest, NextApiResponse } from 'next'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '../auth/[...nextauth]'
import { prisma } from '@/lib/prisma'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query

  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'Invalid id' })
  }

  try {
    const session = await getServerSession(req, res, authOptions)
    if (!session || !session.user?.email) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const email = session.user.email

    const workspace = await prisma.workspace.findUnique({ where: { workspace_id: id } })
    if (!workspace || workspace.email !== email) {
      return res.status(404).json({ error: 'Workspace not found' })
    }

    // fetch analysis if present
    const analysis = await prisma.analysis.findUnique({ where: { workspaceId: id } })

    const result = {
      ...workspace,
      createdAt: workspace.createdAt.toISOString(),
      updatedAt: workspace.updatedAt.toISOString(),
      analysis: analysis
        ? {
            id: analysis.id,
            status: analysis.status,
            progress: analysis.progress ?? null,
            message: analysis.message ?? null,
            current_step: analysis.current_step ?? null,
            status_url: analysis.status_url ?? null,
            result_url: analysis.result_url ?? null,
            startedAt: analysis.startedAt?.toISOString() ?? null,
            completedAt: analysis.completedAt?.toISOString() ?? null,
            hasResult: !!analysis.result,
            result: analysis.result ?? null,
          }
        : null,
    }

    return res.status(200).json({ success: true, workspace: result })
  } catch (err) {
    console.error('get workspace error', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
}
