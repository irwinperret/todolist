import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useLookups } from '../lib/useLookups'
import type { Project, Person } from '../lib/types'

export default function ManageLists() {
  const { projects, people, reload } = useLookups()
  const [newProject, setNewProject] = useState('')
  const [newPerson, setNewPerson] = useState('')
  const [newPersonRole, setNewPersonRole] = useState('')

  const [editingProjectId, setEditingProjectId] = useState<string | null>(null)
  const [editingProjectName, setEditingProjectName] = useState('')

  const [editingPersonId, setEditingPersonId] = useState<string | null>(null)
  const [editingPersonName, setEditingPersonName] = useState('')
  const [editingPersonRole, setEditingPersonRole] = useState('')

  const addProject = async () => {
    if (!newProject.trim()) return
    const { error } = await supabase.from('projects').insert({ name: newProject.trim() })
    if (!error) {
      setNewProject('')
      reload()
    } else {
      alert(error.message)
    }
  }

  const startEditProject = (p: Project) => {
    setEditingProjectId(p.id)
    setEditingProjectName(p.name)
  }

  const saveProjectEdit = async () => {
    if (!editingProjectId || !editingProjectName.trim()) return
    const { error } = await supabase
      .from('projects')
      .update({ name: editingProjectName.trim() })
      .eq('id', editingProjectId)
    if (!error) {
      setEditingProjectId(null)
      reload()
    } else {
      alert(error.message)
    }
  }

  const archiveProject = async (id: string) => {
    await supabase.from('projects').update({ archived: true }).eq('id', id)
    reload()
  }

  const deleteProject = async (id: string, name: string) => {
    if (!confirm(`¿Borrar "${name}" permanentemente? Si tiene tareas vinculadas, no se podrá borrar, en ese caso usa Archivar en su lugar.`)) return
    const { error } = await supabase.from('projects').delete().eq('id', id)
    if (error) {
      if (error.message.includes('foreign key') || error.code === '23503') {
        alert('Este proyecto tiene tareas vinculadas y no se puede borrar. Usa "Archivar" en su lugar.')
      } else {
        alert(error.message)
      }
    } else {
      reload()
    }
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
    } else {
      alert(error.message)
    }
  }

  const startEditPerson = (p: Person) => {
    setEditingPersonId(p.id)
    setEditingPersonName(p.name)
    setEditingPersonRole(p.role ?? '')
  }

  const savePersonEdit = async () => {
    if (!editingPersonId || !editingPersonName.trim()) return
    const { error } = await supabase
      .from('people')
      .update({ name: editingPersonName.trim(), role: editingPersonRole.trim() || null })
      .eq('id', editingPersonId)
    if (!error) {
      setEditingPersonId(null)
      reload()
    } else {
      alert(error.message)
    }
  }

  const archivePerson = async (id: string) => {
    await supabase.from('people').update({ archived: true }).eq('id', id)
    reload()
  }

  const deletePerson = async (id: string, name: string) => {
    if (!confirm(`¿Borrar "${name}" permanentemente? Si tiene tareas vinculadas, no se podrá borrar, en ese caso usa Archivar en su lugar.`)) return
    const { error } = await supabase.from('people').delete().eq('id', id)
    if (error) {
      if (error.message.includes('foreign key') || error.code === '23503') {
        alert('Esta persona tiene tareas vinculadas y no se puede borrar. Usa "Archivar" en su lugar.')
      } else {
        alert(error.message)
      }
    } else {
      reload()
    }
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
            onKeyDown={(e) => e.key === 'Enter' && addProject()}
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
          <button onClick={addProject} className="bg-gray-900 text-white rounded-lg px-4 text-sm">
            Agregar
          </button>
        </div>
        <div className="space-y-1">
          {projects.map((p) => (
            <div key={p.id} className="flex items-center justify-between text-sm py-1.5 border-b border-gray-100 gap-2">
              {editingProjectId === p.id ? (
                <>
                  <input
                    type="text"
                    value={editingProjectName}
                    onChange={(e) => setEditingProjectName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && saveProjectEdit()}
                    className="flex-1 border border-gray-300 rounded-lg px-2 py-1 text-sm"
                    autoFocus
                  />
                  <button onClick={saveProjectEdit} className="text-xs text-green-600 shrink-0">Guardar</button>
                  <button onClick={() => setEditingProjectId(null)} className="text-xs text-gray-400 shrink-0">Cancelar</button>
                </>
              ) : (
                <>
                  <span className="truncate">{p.name}</span>
                  <div className="flex gap-2 shrink-0">
                    <button onClick={() => startEditProject(p)} className="text-xs text-blue-600">Editar</button>
                    <button onClick={() => archiveProject(p.id)} className="text-xs text-gray-400">Archivar</button>
                    <button onClick={() => deleteProject(p.id, p.name)} className="text-xs text-red-500">Borrar</button>
                  </div>
                </>
              )}
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
            <div key={p.id} className="flex items-center justify-between text-sm py-1.5 border-b border-gray-100 gap-2">
              {editingPersonId === p.id ? (
                <>
                  <input
                    type="text"
                    value={editingPersonName}
                    onChange={(e) => setEditingPersonName(e.target.value)}
                    className="flex-1 border border-gray-300 rounded-lg px-2 py-1 text-sm"
                    autoFocus
                  />
                  <input
                    type="text"
                    placeholder="Rol"
                    value={editingPersonRole}
                    onChange={(e) => setEditingPersonRole(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && savePersonEdit()}
                    className="w-20 border border-gray-300 rounded-lg px-2 py-1 text-sm"
                  />
                  <button onClick={savePersonEdit} className="text-xs text-green-600 shrink-0">Guardar</button>
                  <button onClick={() => setEditingPersonId(null)} className="text-xs text-gray-400 shrink-0">Cancelar</button>
                </>
              ) : (
                <>
                  <span className="truncate">
                    {p.name} {p.role && <span className="text-gray-400">({p.role})</span>}
                  </span>
                  <div className="flex gap-2 shrink-0">
                    <button onClick={() => startEditPerson(p)} className="text-xs text-blue-600">Editar</button>
                    <button onClick={() => archivePerson(p.id)} className="text-xs text-gray-400">Archivar</button>
                    <button onClick={() => deletePerson(p.id, p.name)} className="text-xs text-red-500">Borrar</button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
