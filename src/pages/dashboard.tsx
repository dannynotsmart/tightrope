import { useSession, signOut } from "next-auth/react"
import { useRouter } from "next/router"
import { useEffect, useState } from "react"

interface WorkspaceData {
  workspace_id: string
  name: string
  github_repository: string
  createdAt: string
}

export default function Dashboard() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [workspaces, setWorkspaces] = useState<WorkspaceData[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [formData, setFormData] = useState({
    name: "",
    github_repository: "",
  })
  const [formError, setFormError] = useState("")

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/")
    } else if (status === "authenticated") {
      fetchWorkspaces()
    }
  }, [status, router])

  const fetchWorkspaces = async () => {
    try {
      setLoading(true)
      const response = await fetch("/api/auth/signin", { method: "POST" })
      const data = await response.json()
      if (data.success) {
        setWorkspaces(data.workspaces || [])
      }
    } catch (error) {
      console.error("Failed to fetch workspaces:", error)
    } finally {
      setLoading(false)
    }
  }

  const validateForm = () => {
    setFormError("")

    if (!formData.name.trim()) {
      setFormError("Workspace name is required")
      return false
    }

    if (!formData.github_repository.trim()) {
      setFormError("GitHub URL is required")
      return false
    }

    if (
      !formData.github_repository.includes("github.com") &&
      !formData.github_repository.includes("github.com/")
    ) {
      setFormError("Please enter a valid GitHub URL")
      return false
    }

    return true
  }

  const handleConnect = async () => {
    if (!validateForm()) return

    try {
      setFormError("")
      const res = await fetch('/api/workspaces/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      })

      const data = await res.json()
      if (!res.ok) {
        setFormError(data?.error || 'Failed to create workspace')
        return
      }

      const workspace = data.workspace
      setShowModal(false)
      setFormData({ name: '', github_repository: '' })

      if (workspace?.workspace_id) {
        router.push(`/workspaces/${workspace.workspace_id}`)
      } else {
        fetchWorkspaces()
      }
    } catch (err) {
      console.error('create workspace failed', err)
      setFormError('Failed to create workspace')
    }
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }))
  }

  if (status === "loading" || loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center">
        <div className="text-gray-600">Loading...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <header className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <div className="flex items-center gap-4">
            <span className="text-gray-600">{session?.user?.email}</span>
            <button
              onClick={() => signOut({ callbackUrl: "/" })}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition duration-200"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex justify-between items-center mb-8">
          <h2 className="text-3xl font-bold text-gray-900">Your Workspaces</h2>
          <button
            onClick={() => setShowModal(true)}
            className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition duration-200 flex items-center gap-2"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 4v16m8-8H4"
              />
            </svg>
            Create Workspace
          </button>
        </div>

        {workspaces.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-500 text-lg">No workspaces yet.</p>
            <p className="text-gray-400">Create one to get started!</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {workspaces.map((workspace) => (
              <div
                key={workspace.workspace_id}
                className="bg-white rounded-lg shadow hover:shadow-lg transition duration-200 p-6"
              >
                <h3 className="text-xl font-semibold text-gray-900 mb-2">
                  {workspace.name}
                </h3>
                <p className="text-gray-600 text-sm break-all">
                  {workspace.github_repository}
                </p>
              </div>
            ))}
          </div>
        )}
      </main>

      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">
              Create Workspace
            </h2>

            {formError && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
                {formError}
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Workspace Name
                </label>
                <input
                  type="text"
                  name="name"
                  value={formData.name}
                  onChange={handleInputChange}
                  placeholder="e.g., My Project"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  GitHub URL
                </label>
                <input
                  type="text"
                  name="github_repository"
                  value={formData.github_repository}
                  onChange={handleInputChange}
                  placeholder="e.g., https://github.com/user/repo"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition"
                />
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => {
                  setShowModal(false)
                  setFormData({ name: "", github_repository: "" })
                  setFormError("")
                }}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50 transition duration-200"
              >
                Cancel
              </button>
              <button
                onClick={handleConnect}
                className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition duration-200"
              >
                Connect
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
