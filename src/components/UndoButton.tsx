export default function UndoButton(props: { canUndo: boolean; label: string; busy: boolean; onUndo: () => void }) {
  if (!props.canUndo && !props.busy) return null
  return (
    <button
      onClick={props.onUndo}
      disabled={props.busy}
      className="fixed bottom-20 left-4 z-20 max-w-[60vw] flex items-center gap-2 rounded-full bg-gray-200 text-gray-600 border border-gray-300 pl-3 pr-4 py-2 text-xs shadow-sm disabled:opacity-60"
      aria-label={`Deshacer: ${props.label}`}
    >
      <span className="text-sm leading-none">↩</span>
      <span className="truncate">{props.busy ? 'Deshaciendo...' : `Deshacer · ${props.label}`}</span>
    </button>
  )
}
