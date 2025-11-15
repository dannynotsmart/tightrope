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

    // convert dates to strings
    const result = { ...workspace, createdAt: workspace.createdAt.toISOString(), updatedAt: workspace.updatedAt.toISOString() }

    return res.status(201).json({ success: true, workspace: result })
  } catch (err) {
    console.error('create workspace error', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
}
