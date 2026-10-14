import { useState } from 'react'

// Preview of the list as text, editable before sending. "Abrir WhatsApp"
// opens a chat with the text prefilled (straight to the person's chat when a
// single responsable with a phone number is selected).
export default function WhatsappExportModal(props: {
  initialText: string
  phone: string | null // digits only, with country code
  onClose: () => void
}) {
  const [text, setText] = useState(props.initialText)
  const [copied, setCopied] = useState(false)

  const isDesktop = !/Android|iPhone|iPad|iPod|Windows Phone/i.test(navigator.userAgent)
  const [triedApp, setTriedApp] = useState(false)

  const webUrl = () => {
    const base = props.phone ? `https://wa.me/${props.phone}` : 'https://wa.me/'
    return `${base}?text=${encodeURIComponent(text)}`
  }

  const openWhatsapp = () => {
    if (isDesktop) {
      // On a computer, open the WhatsApp Desktop app through its own link
      // instead of WhatsApp Web in the browser. The browser may ask once for
      // permission to open WhatsApp.
      const phoneParam = props.phone ? `phone=${props.phone}&` : ''
      window.location.href = `whatsapp://send?${phoneParam}text=${encodeURIComponent(text)}`
      setTriedApp(true)
      return
    }
    window.open(webUrl(), '_blank', 'noopener,noreferrer')
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      /* clipboard blocked: the text is still selectable in the box */
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4" onClick={props.onClose}>
      <div
        className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl p-4 space-y-3 max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <p className="font-medium text-gray-900">Enviar por WhatsApp</p>
          <button onClick={props.onClose} className="text-sm text-gray-500">Cerrar</button>
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="w-full flex-1 min-h-[40vh] border border-gray-300 rounded-lg p-3 text-sm font-mono"
        />
        <p className="text-xs text-gray-500">
          Puedes editar el texto antes de enviarlo. {props.phone ? 'Se abrirá el chat de ese responsable.' : 'En WhatsApp eliges a quién enviarlo.'}
        </p>
        {triedApp && (
          <p className="text-xs text-amber-700">
            Si no se abrió WhatsApp Desktop, revisa que lo tengas instalado, o{' '}
            <a href={webUrl()} target="_blank" rel="noopener noreferrer" className="underline">ábrelo en el navegador</a>.
          </p>
        )}
        <div className="flex gap-2">
          <button onClick={openWhatsapp} className="flex-1 bg-green-600 text-white rounded-lg py-2.5 text-sm font-medium">
            Abrir WhatsApp
          </button>
          <button onClick={copy} className="flex-1 border border-gray-300 rounded-lg py-2.5 text-sm font-medium bg-white">
            {copied ? '¡Copiado!' : 'Copiar'}
          </button>
        </div>
      </div>
    </div>
  )
}
