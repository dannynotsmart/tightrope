import { useSession, signOut } from 'next-auth/react'
import { useRouter } from 'next/router'
import { useEffect, useState, useRef } from 'react'

interface WorkspaceData {
  workspace_id: string
  name: string
  github_repository: string
  createdAt: string
  analysis?: {
    id: string
    status: string
    progress?: number
    message?: string
    current_step?: string
    startedAt?: string
    completedAt?: string
    hasResult?: boolean
    result?: any
  }
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

          // If analysis is not completed, start polling status
          // Start polling status if analysis isn't completed yet (we may not have analysis stored yet)
          if (!data.workspace.analysis || (data.workspace.analysis && !data.workspace.analysis.hasResult)) {
            pollStatus()
          }
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
  // Poll status function with interval ref and proper cleanup
  const pollingRef = useRef<number | null>(null)

  const pollStatus = async () => {
    if (pollingRef.current) return // already polling
    setError('')
    setLoading(true)

    pollingRef.current = window.setInterval(async () => {
      try {
        const res = await fetch(`/api/workspaces/${id}/status`)
        const data = await res.json()
        if (!res.ok) {
          console.error('status fetch error', data)
          setError(data?.error || 'Failed to fetch status')
          if (pollingRef.current) {
            clearInterval(pollingRef.current)
            pollingRef.current = null
          }
          setLoading(false)
          return
        }

        const analysis = data.analysis
        if (analysis) {
          // update workspace local state with analysis summary (including result if present)
          setWorkspace((prev) => {
            if (!prev) return prev
            return { ...prev, analysis: { ...analysis } }
          })
        }

        // Stop polling when analyzer reports completed OR when a result is provided
        if (data.status === 'completed' || (analysis && analysis.result)) {
          if (pollingRef.current) {
            clearInterval(pollingRef.current)
            pollingRef.current = null
          }
          // if analysis contains result, we've already set it on workspace; otherwise fetch final workspace once
          if (!(analysis && analysis.result)) {
            try {
              const finalRes = await fetch(`/api/workspaces/${id}`)
              const finalData = await finalRes.json()
              if (finalRes.ok) setWorkspace(finalData.workspace)
            } catch (e) {
              console.error('failed to fetch final workspace', e)
            }
          }
          setLoading(false)
        }
      } catch (err) {
        console.error('poll error', err)
        setError('Polling failed')
        setLoading(false)
        if (pollingRef.current) {
          clearInterval(pollingRef.current)
          pollingRef.current = null
        }
      }
    }, 2000)
  }

  // cleanup on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current)
        pollingRef.current = null
      }
    }
  }, [])

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
          <div className="space-y-6">
            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="text-2xl font-bold mb-2">{workspace.name}</h2>
              <p className="text-sm text-gray-500 mb-4">Created: {new Date(workspace.createdAt).toLocaleString()}</p>
              <p className="text-gray-700 break-all">{workspace.github_repository}</p>
              <div className="mt-6">
                <a href={workspace.github_repository} target="_blank" rel="noreferrer" className="inline-block px-4 py-2 bg-blue-600 text-white rounded-md">Open on GitHub</a>
              </div>
            </div>

            {/* Analysis Status */}
            {workspace.analysis && (
              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="text-lg font-semibold mb-2">Analysis</h3>
                <p className="text-sm text-gray-600 mb-2">Status: <span className="font-medium">{workspace.analysis.status}</span></p>
                {typeof workspace.analysis.progress === 'number' && (
                  <div className="w-full bg-gray-200 rounded h-3 mb-3">
                    <div style={{ width: `${workspace.analysis.progress}%` }} className="bg-blue-600 h-3 rounded" />
                  </div>
                )}
                {workspace.analysis.message && (
                  <div className="text-sm text-gray-700 mb-2">{workspace.analysis.message}</div>
                )}

                {/* If result is available show basic summary */}
                {workspace.analysis && workspace.analysis.result ? (
                  <div className="mt-4 space-y-6">
                    <h4 className="font-semibold text-lg">Analysis Result</h4>

                    {/* Summary */}
                    {workspace.analysis.result.project_summary && (
                      <div className="bg-gray-50 p-4 rounded">
                        <h5 className="font-medium mb-2">Project Summary</h5>
                        <p className="text-gray-700 whitespace-pre-wrap">{workspace.analysis.result.project_summary}</p>
                      </div>
                    )}

                    {/* Primary languages & metadata */}
                    <div className="flex flex-col md:flex-row gap-4">
                      <div className="flex-1 bg-white p-4 rounded shadow">
                        <h6 className="font-medium mb-2">Primary Languages</h6>
                        <div className="flex flex-wrap gap-2">
                          {(workspace.analysis.result.primary_languages || []).map((l: string) => (
                            <span key={l} className="px-3 py-1 bg-blue-50 text-blue-700 rounded-full text-sm">{l}</span>
                          ))}
                        </div>
                      </div>

                      <div className="w-full md:w-64 bg-white p-4 rounded shadow">
                        <h6 className="font-medium mb-2">Repository</h6>
                        <a href={workspace.analysis.result.repository_url} target="_blank" rel="noreferrer" className="text-blue-600 break-all">{workspace.analysis.result.repository_url}</a>
                        <div className="mt-3 text-sm text-gray-600">
                          <div><strong>Stars:</strong> {workspace.analysis.result.metadata?.stars ?? '-'}</div>
                          <div><strong>Forks:</strong> {workspace.analysis.result.metadata?.forks ?? '-'}</div>
                          <div><strong>Commits analyzed:</strong> {workspace.analysis.result.metadata?.commits_analyzed ?? '-'}</div>
                        </div>
                      </div>
                    </div>

                    {/* Contributors */}
                    <div className="bg-white p-4 rounded shadow">
                      <h6 className="font-medium mb-3">Top Contributors</h6>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {(workspace.analysis.result.contributors || []).map((c: any) => (
                          <div key={c.username} className="border rounded p-3">
                            <div className="flex items-center justify-between">
                              <div>
                                <div className="font-semibold">{c.username}</div>
                                <div className="text-sm text-gray-500">{c.email}</div>
                              </div>
                              <div className="text-sm text-gray-700">{c.total_commits} commits</div>
                            </div>
                            <div className="mt-2 text-sm text-gray-700">
                              <div className="font-medium">Expertise</div>
                              <div className="text-gray-600">{(c.knowledge_areas || []).slice(0,3).join(', ')}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Codebase health & recommendations */}
                    <div className="bg-white p-4 rounded shadow">
                      <h6 className="font-medium mb-3">Codebase Health</h6>
                      <div className="grid grid-cols-2 gap-4 text-sm text-gray-700">
                        <div><strong>Total files:</strong> {workspace.analysis.result.codebase_health?.total_files ?? '-'}</div>
                        <div><strong>Total commits:</strong> {workspace.analysis.result.codebase_health?.total_commits ?? '-'}</div>
                        <div><strong>Active contributors:</strong> {workspace.analysis.result.codebase_health?.active_contributors ?? '-'}</div>
                        <div><strong>Hot spots:</strong> {(workspace.analysis.result.codebase_health?.hot_spots || []).length}</div>
                      </div>

                      {workspace.analysis.result.recommendations && (
                        <div className="mt-4">
                          <h6 className="font-medium mb-2">Recommendations</h6>
                          <ul className="list-disc list-inside text-sm text-gray-700">
                            {(workspace.analysis.result.recommendations || []).map((r: string, i: number) => (
                              <li key={i}>{r}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 text-sm text-gray-500">No result yet. Analysis will run and update here.</div>
                )}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
