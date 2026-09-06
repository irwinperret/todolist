import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useLookups } from '../lib/useLookups'

export default function ManageLists() {
  const { projects, people, reload } = useLookups()
  const [newProject, setNewProject] = useState('')
  const [newPerson, setNewPerson] = useState('')
  const [newPersonRole, setNewPersonRole] = useState('')

  const addProject = async () => {
    if (!newProject.trim()) return
    const { error } = await supabase.from('projects').insert({ name: newProject.trim() })
    if (!error) {
      setNewProject('')
      reload()
    }
  }

  const archiveProject = async (id: string) => {
    await supabase.from('projects').update({ archived: true }).eq('id', id)
    reload()
  }

  const addPerson = async () => {
    if (!newPerson.trim()) return
    const { error } = await supabase
      .from('people')
      .insert({ name: newPerson.trim(), role: newPersonRole.trim() || null })
    if (!error) {
      setNewPerson('')
      setNewPersonRole('')
      reload()
    }
  }

  const archivePerson = async (id: string) => {
    await supabase.from('people').update({ archived: true }).eq('id', id)
    reload()
  }

  return (
    <div className="px-4 pt-4 space-y-6 pb-8">
      <section className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
        <p className="font-medium text-gray-900">Proyectos</p>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Nuevo proyecto"
            value={newProject}
            onChange={(e) => setNewProject(e.target.value)}
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
          <button onClick={addProject} className="bg-gray-900 text-white rounded-lg px-4 text-sm">
            Agregar
          </button>
        </div>
        <div className="space-y-1">
          {projects.map((p) => (
            <div key={p.id} className="flex items-center justify-between text-sm py-1 border-b border-gray-100">
              <span>{p.name}</span>
              <button onClick={() => archiveProject(p.id)} className="text-xs text-gray-400">
                Archivar
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
        <p className="font-medium text-gray-900">Personas / Subcontratistas</p>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Nombre"
            value={newPerson}
            onChange={(e) => setNewPerson(e.target.value)}
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
          <input
            type="text"
            placeholder="Rol"
            value={newPersonRole}
            onChange={(e) => setNewPersonRole(e.target.value)}
            className="w-24 border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
          <button onClick={addPerson} className="bg-gray-900 text-white rounded-lg px-4 text-sm">
            Agregar
          </button>
        </div>
        <div className="space-y-1">
          {people.map((p) => (
            <div key={p.id} className="flex items-center justify-between text-sm py-1 border-b border-gray-100">
              <span>{p.name} {p.role && <span className="text-gray-400">({p.role})</span>}</span>
              <button onClick={() => archivePerson(p.id)} className="text-xs text-gray-400">
                Archivar
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
