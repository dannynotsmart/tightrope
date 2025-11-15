import type { NextApiRequest, NextApiResponse } from 'next'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '../auth/[...nextauth]'
import { prisma } from '@/lib/prisma'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const session = await getServerSession(req, res, authOptions)
    if (!session || !session.user?.email) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const email = session.user.email
    const { name, github_repository } = req.body as {
      name?: string
      github_repository?: string
    }

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Workspace name is required' })
    }

    if (!github_repository || !github_repository.includes('github.com')) {
      return res.status(400).json({ error: 'Invalid GitHub repository URL' })
    }

    const workspace = await prisma.workspace.create({
      data: {
        name: name.trim(),
        github_repository: github_repository.trim(),
        email,
      },
    })

    // start analysis with external API
    try {
      const analyzeResp = await fetch('http://0.0.0.0:8000/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ github_url: github_repository.trim(), workspace_id: workspace.workspace_id }),
      })

      const analyzeData = await analyzeResp.json().catch(() => null)

      // normalize status/result urls (some analyzers return relative paths)
      const base = 'http://0.0.0.0:8000'
      const status_url = analyzeData?.status_url
        ? analyzeData.status_url.startsWith('http')
          ? analyzeData.status_url
          : `${base}${analyzeData.status_url}`
        : null
      const result_url = analyzeData?.result_url
        ? analyzeData.result_url.startsWith('http')
          ? analyzeData.result_url
          : `${base}${analyzeData.result_url}`
        : null

      // store analysis record
      const analysis = await prisma.analysis.create({
        data: {
          workspaceId: workspace.workspace_id,
          external_workspace_id: analyzeData?.workspace_id ?? null,
          status: analyzeData?.status ?? 'pending',
          status_url: status_url,
          result_url: result_url,
        },
      })

      const result = {
        ...workspace,
        createdAt: workspace.createdAt.toISOString(),
        updatedAt: workspace.updatedAt.toISOString(),
        analysis: {
          id: analysis.id,
          status: analysis.status,
          status_url: analysis.status_url,
          result_url: analysis.result_url,
          hasResult: !!analysis.result,
        },
      }

      return res.status(201).json({ success: true, workspace: result })
    } catch (err) {
      console.error('analyze start error', err)
      const result = { ...workspace, createdAt: workspace.createdAt.toISOString(), updatedAt: workspace.updatedAt.toISOString() }
      return res.status(201).json({ success: true, workspace: result })
    }
  } catch (err) {
    console.error('create workspace error', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
}
