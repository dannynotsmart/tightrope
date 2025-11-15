import type { NextApiRequest, NextApiResponse } from 'next'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '../../auth/[...nextauth]'
import { prisma } from '@/lib/prisma'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query

  if (!id || typeof id !== 'string') return res.status(400).json({ error: 'Invalid id' })

  try {
    const session = await getServerSession(req, res, authOptions)
    if (!session || !session.user?.email) return res.status(401).json({ error: 'Unauthorized' })

    const email = session.user.email

    const analysis = await prisma.analysis.findUnique({ where: { workspaceId: id } })
    if (!analysis) return res.status(404).json({ error: 'No analysis record' })

    // If we already have a result saved, return it
    if (analysis.result) {
      return res.status(200).json({ success: true, status: 'completed', analysis })
    }

    if (!analysis.status_url && !analysis.external_workspace_id) {
      return res.status(200).json({ success: true, status: analysis.status || 'pending' })
    }

    // Prefer status_url if available, otherwise construct from external_workspace_id
    const statusUrl = analysis.status_url ?? `http://0.0.0.0:8000/api/status/${analysis.external_workspace_id}`

    const statusResp = await fetch(statusUrl)
    if (!statusResp.ok) {
      return res.status(502).json({ error: 'Failed to fetch status from analyzer' })
    }

    const statusData = await statusResp.json()

    // Update analysis record with latest status info
    await prisma.analysis.update({
      where: { workspaceId: id },
      data: {
        status: statusData.status || analysis.status,
        progress: statusData.progress ?? analysis.progress,
        message: statusData.message ?? analysis.message,
        current_step: statusData.current_step ?? analysis.current_step,
      },
    })

    // If completed, fetch result and save
    if (statusData.status === 'completed') {
      const externalId = analysis.external_workspace_id ?? statusData.workspace_id
      const resultUrl = analysis.result_url ?? `http://0.0.0.0:8000/api/result/${externalId}`

      const resultResp = await fetch(resultUrl)
      if (resultResp.ok) {
        const resultData = await resultResp.json()
        await prisma.analysis.update({
          where: { workspaceId: id },
          data: {
            result: resultData,
            completedAt: new Date(),
            status: 'completed',
          },
        })
        const updated = await prisma.analysis.findUnique({ where: { workspaceId: id } })
        return res.status(200).json({ success: true, status: 'completed', analysis: updated })
      } else {
        return res.status(502).json({ error: 'Failed to fetch result from analyzer' })
      }
    }

    const updated = await prisma.analysis.findUnique({ where: { workspaceId: id } })
    return res.status(200).json({ success: true, status: statusData.status, analysis: updated })
  } catch (err) {
    console.error('status check error', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
}
