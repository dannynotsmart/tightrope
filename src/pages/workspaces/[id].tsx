import { useSession, signOut } from 'next-auth/react'
import { useRouter } from 'next/router'
import { useEffect, useState } from 'react'

interface WorkspaceData {
  workspace_id: string
  name: string
  github_repository: string
  createdAt: string
}

export default function WorkspacePage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const { id } = router.query
  const [workspace, setWorkspace] = useState<WorkspaceData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/')
    }
  }, [status, router])

  useEffect(() => {
    if (!id || Array.isArray(id)) return
    const fetchWorkspace = async () => {
      try {
        setLoading(true)
        const res = await fetch(`/api/workspaces/${id}`)
        const data = await res.json()
        if (!res.ok) {
          setError(data?.error || 'Failed to load workspace')
        } else {
          setWorkspace(data.workspace)
        }
      } catch (err) {
        console.error(err)
        setError('Failed to load workspace')
      } finally {
        setLoading(false)
      }
    }

    fetchWorkspace()
  }, [id])

  if (loading) return <div className="min-h-screen flex items-center justify-center">Loading...</div>

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button onClick={() => router.push('/dashboard')} className="px-3 py-2 bg-gray-100 rounded-md">Back</button>
            <h1 className="text-xl font-semibold">Workspace</h1>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-600">{session?.user?.email}</span>
            <button onClick={() => signOut({ callbackUrl: '/' })} className="px-3 py-2 bg-red-600 text-white rounded-md">Sign out</button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto p-6">
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded">{error}</div>
        )}

        {!workspace ? (
          <div className="text-gray-600">No workspace found.</div>
        ) : (
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-2xl font-bold mb-2">{workspace.name}</h2>
            <p className="text-sm text-gray-500 mb-4">Created: {new Date(workspace.createdAt).toLocaleString()}</p>
            <p className="text-gray-700 break-all">{workspace.github_repository}</p>
            <div className="mt-6">
              <a href={workspace.github_repository} target="_blank" rel="noreferrer" className="inline-block px-4 py-2 bg-blue-600 text-white rounded-md">Open on GitHub</a>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
