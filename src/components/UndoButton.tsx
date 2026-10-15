export default function UndoButton(props: { canUndo: boolean; label: string; busy: boolean; onUndo: () => void }) {
  if (!props.canUndo && !props.busy) return null
  return (
    <button
      onClick={props.onUndo}
      disabled={props.busy}
      className="fixed bottom-20 left-4 z-20 max-w-[60vw] flex items-center gap-2 rounded-full bg-gray-900 text-white pl-4 pr-5 py-3 text-sm font-medium shadow-lg disabled:opacity-60"
      aria-label={`Deshacer: ${props.label}`}
    >
      <span className="text-base leading-none">↩</span>
      <span className="truncate">{props.busy ? 'Deshaciendo...' : `Deshacer · ${props.label}`}</span>
    </button>
  )
}
