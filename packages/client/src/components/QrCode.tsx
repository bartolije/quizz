import { useEffect, useState } from 'react'
import QRCode from 'qrcode'

interface Props {
  value: string
  size?: number
}

export function QrCode({ value, size = 240 }: Props) {
  const [dataUrl, setDataUrl] = useState('')

  useEffect(() => {
    let active = true
    if (!value) {
      setDataUrl('')
      return
    }
    QRCode.toDataURL(value, { width: size, margin: 1 })
      .then((url) => { if (active) setDataUrl(url) })
      .catch(() => { if (active) setDataUrl('') })
    return () => { active = false }
  }, [value, size])

  if (!dataUrl) {
    return (
      <div
        style={{ width: size, height: size }}
        className="bg-gray-700 rounded-xl animate-pulse"
      />
    )
  }

  return (
    <img
      src={dataUrl}
      width={size}
      height={size}
      alt={`QR code pour rejoindre : ${value}`}
      className="rounded-xl"
    />
  )
}
