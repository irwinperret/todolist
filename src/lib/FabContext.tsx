import { createContext, useContext, useState, type ReactNode } from 'react'

type FabConfig = { label: string; color: string; onClick: () => void } | null

type FabContextType = { fab: FabConfig; setFab: (f: FabConfig) => void }

const FabContext = createContext<FabContextType | undefined>(undefined)

export function FabProvider({ children }: { children: ReactNode }) {
  const [fab, setFab] = useState<FabConfig>(null)
  return <FabContext.Provider value={{ fab, setFab }}>{children}</FabContext.Provider>
}

export function useFab() {
  const ctx = useContext(FabContext)
  if (!ctx) throw new Error('useFab must be used within FabProvider')
  return ctx
}
