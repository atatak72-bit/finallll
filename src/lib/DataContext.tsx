import { createContext, useContext, type ReactNode } from 'react'
import { useData, type DataContextValue } from '../lib/useData'

const DataContext = createContext<DataContextValue | null>(null)

export function DataProvider({ children }: { children: ReactNode }) {
  const data = useData()
  return <DataContext.Provider value={data}>{children}</DataContext.Provider>
}

export function useStoreData(): DataContextValue {
  const ctx = useContext(DataContext)
  if (!ctx) throw new Error('useStoreData must be used within DataProvider')
  return ctx
}
