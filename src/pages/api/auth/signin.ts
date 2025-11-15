import type { NextApiRequest, NextApiResponse } from 'next'
import { getServerSession } from 'next-auth/next'
import { authOptions } from './[...nextauth]'
import { prisma } from '@/lib/prisma'

type ResponseData = {
  success: boolean
  message?: string
  user?: {
    email: string
  }
  workspaces?: Array<{
    workspace_id: string
    name: string
    github_repository: string
    createdAt: string
  }>
  error?: string
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ResponseData>
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' })
  }

  try {
    const session = await getServerSession(req, res, authOptions)

    if (!session || !session.user?.email) {
      return res.status(401).json({ success: false, error: 'Unauthorized' })
    }

    const email = session.user.email

    let user = await prisma.user.findUnique({
      where: { email },
    })

    if (!user) {
      user = await prisma.user.create({
        data: { email },
      })
    }

    const workspacesRaw = await prisma.workspace.findMany({
      where: { email },
      select: {
        workspace_id: true,
        name: true,
        github_repository: true,
        createdAt: true,
      },
    })

    const workspaces = workspacesRaw.map((ws) => ({
      ...ws,
      createdAt: ws.createdAt.toISOString(),
    }))

    return res.status(200).json({
      success: true,
      message: 'User signed in successfully',
      user: { email },
      workspaces,
    })
  } catch (error) {
    console.error('Sign in error:', error)
    return res.status(500).json({ success: false, error: 'Internal server error' })
  }
}
