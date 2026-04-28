import { useState, useEffect, useCallback } from 'react'
import { createWorker } from 'tesseract.js';

async function getTextFromImage(imageUrl) {
  const worker = await createWorker('eng');
  try {
    const ret = await worker.recognize(imageUrl);
    return ret.data.text;
  } catch (error) {
    console.error('OCR error:', error);
    return '';
  } finally {
    await worker.terminate();
  }
}

const MAX_TEXT_CHARS = 2000

export default function PastePreview() {
  const [text, setText] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [eventDraft, setEventDraft] = useState(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')
  const hasPastedContent = Boolean(text || imageUrl)

  const applyPastedImage = useCallback((file) => {
    setImageUrl(URL.createObjectURL(file))
    setText('')
    setEventDraft(null)
    setError('')
  }, [])

  const applyPastedText = useCallback((pastedText) => {
    const trimmedText = pastedText.slice(0, MAX_TEXT_CHARS)
    setText(trimmedText)
    setImageUrl('')
    setEventDraft(null)
    setError(
      pastedText.length > MAX_TEXT_CHARS
        ? `Pasted text was trimmed to ${MAX_TEXT_CHARS.toLocaleString()} characters.`
        : '',
    )
  }, [])

  const handlePaste = useCallback((e) => {
    const items = e.clipboardData.items

    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile()
        if (file) {
          applyPastedImage(file)
          return
        }
      }
    }

    const pastedText = e.clipboardData.getData('text')
    if (pastedText) {
      applyPastedText(pastedText)
    }
  }, [applyPastedImage, applyPastedText])

  const handlePasteButtonClick = async () => {
    try {
      if (!navigator.clipboard) {
        throw new Error('Clipboard access is not available in this browser.')
      }

      if (navigator.clipboard.read) {
        const items = await navigator.clipboard.read()
        for (const item of items) {
          const imageType = item.types.find((type) => type.startsWith('image/'))
          if (imageType) {
            const blob = await item.getType(imageType)
            applyPastedImage(blob)
            return
          }
        }
      }

      const pastedText = await navigator.clipboard.readText()
      if (!pastedText) {
        throw new Error('Clipboard is empty. Copy text/image and try again.')
      }
      applyPastedText(pastedText)
    } catch {
      setError('Tap + hold and use Paste on mobile, or press Ctrl/Command + V.')
    }
  }

  useEffect(() => {
    const onPaste = (pasteEvent) => handlePaste(pasteEvent)
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [handlePaste])

  const handleSubmit = async () => {
    setError('')
    setIsSubmitting(true)

    try {
      if (text) {
        if (!text.trim()) {
          throw new Error('Please enter event text before submitting.')
        }
        const parsedEvent = await getCalEventFromText(text)
        setEventDraft(buildEditableDraft(parsedEvent))
      } else if (imageUrl) {
        const parsedEvent = await getCalEventFromImage(imageUrl)
        setEventDraft(buildEditableDraft(parsedEvent))
      }
    } catch (submitError) {
      setError(submitError.message || 'Could not create event from paste.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const getCalEventFromText = async (pastedText) => {
    const apiKey = import.meta.env.VITE_GEMINI_API_KEY
    if (!apiKey) {
      throw new Error('Missing VITE_GEMINI_API_KEY in your .env file.')
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text:
                    'Extract one calendar event from this text. Return ONLY JSON with keys: title, description, location, start_iso, end_iso. start_iso and end_iso must be valid ISO datetime strings. If no year is given, use the current year. If no timezone is given, use the current timezone. If no event details are given, return an empty response.\n\nText:\n' +
                    pastedText,
                },
              ],
            },
          ],
          generationConfig: {
            responseMimeType: 'application/json',
          },
        }),
      },
    )

    if (!response.ok) {
      const failed = await response.json().catch(() => null)
      throw new Error(failed?.error?.message || 'Gemini request failed.')
    }

    const data = await response.json()
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text
    if (!raw) {
      throw new Error('Gemini returned an empty response.')
    }

    let parsed
    try {
      parsed = JSON.parse(raw)
    } catch {
      throw new Error('Gemini response was not valid JSON.')
    }

    if (!parsed.title || !parsed.start_iso || !parsed.end_iso) {
      throw new Error('Gemini response is missing required event fields.')
    }

    return parsed
  }

  const getCalEventFromImage = async (pastedImageUrl) => {
    const text = await getTextFromImage(pastedImageUrl)
    if (!text) {
      throw new Error('No text found in image.')
    }
    return getCalEventFromText(text)
  }

  const buildEditableDraft = (parsedEvent) => ({
    title: parsedEvent.title || '',
    description: parsedEvent.description || '',
    location: parsedEvent.location || '',
    startLocal: toLocalDateTimeInput(parsedEvent.start_iso),
    endLocal: toLocalDateTimeInput(parsedEvent.end_iso),
  })

  const toLocalDateTimeInput = (isoString) => {
    const date = new Date(isoString)
    if (Number.isNaN(date.getTime())) return ''
    const tzOffsetMs = date.getTimezoneOffset() * 60000
    return new Date(date.getTime() - tzOffsetMs).toISOString().slice(0, 16)
  }

  const fromLocalInputToIso = (localValue) => {
    const date = new Date(localValue)
    if (Number.isNaN(date.getTime())) {
      throw new Error('Invalid local date/time.')
    }
    return date.toISOString()
  }

  const escapeIcs = (value = '') =>
    String(value)
      .replace(/\\/g, '\\\\')
      .replace(/\n/g, '\\n')
      .replace(/,/g, '\\,')
      .replace(/;/g, '\\;')

  const toIcsDateTime = (isoString) => {
    const date = new Date(isoString)
    if (Number.isNaN(date.getTime())) {
      throw new Error('Invalid event date returned by Gemini.')
    }

    const pad = (n) => String(n).padStart(2, '0')
    return (
      date.getUTCFullYear() +
      pad(date.getUTCMonth() + 1) +
      pad(date.getUTCDate()) +
      'T' +
      pad(date.getUTCHours()) +
      pad(date.getUTCMinutes()) +
      pad(date.getUTCSeconds()) +
      'Z'
    )
  }

  const buildIcs = (calEvent) => {
    const uid = `${Date.now()}@scheduled.local`
    const dtstamp = toIcsDateTime(new Date().toISOString())
    const dtstart = toIcsDateTime(fromLocalInputToIso(calEvent.startLocal))
    const dtend = toIcsDateTime(fromLocalInputToIso(calEvent.endLocal))

    return [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Scheduled//Paste to Calendar//EN',
      'CALSCALE:GREGORIAN',
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART:${dtstart}`,
      `DTEND:${dtend}`,
      `SUMMARY:${escapeIcs(calEvent.title || '')}`,
      `DESCRIPTION:${escapeIcs(calEvent.description || '')}`,
      `LOCATION:${escapeIcs(calEvent.location || '')}`,
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n')
  }

  const getGoogleCalendarUrl = (calEvent) => {
    const start = toIcsDateTime(fromLocalInputToIso(calEvent.startLocal))
    const end = toIcsDateTime(fromLocalInputToIso(calEvent.endLocal))
    const params = new URLSearchParams({
      action: 'TEMPLATE',
      text: calEvent.title || '',
      dates: `${start}/${end}`,
      details: calEvent.description || '',
      location: calEvent.location || '',
    })
    return `https://calendar.google.com/calendar/render?${params.toString()}`
  }

  const getOutlookCalendarUrl = (calEvent) => {
    const params = new URLSearchParams({
      path: '/calendar/action/compose',
      subject: calEvent.title || '',
      body: calEvent.description || '',
      location: calEvent.location || '',
      startdt: fromLocalInputToIso(calEvent.startLocal),
      enddt: fromLocalInputToIso(calEvent.endLocal),
    })
    return `https://outlook.live.com/calendar/0/deeplink/compose?${params.toString()}`
  }

  const handleDownloadIcs = () => {
    if (!eventDraft) return
    const ics = buildIcs(eventDraft)
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'event.ics'
    link.click()
    URL.revokeObjectURL(url)
  }

  const updateEventField = (field, value) => {
    setEventDraft((current) => {
      if (!current) return current
      return { ...current, [field]: value }
    })
  }

  const handleTextInputChange = (e) => {
    setText(e.target.value.slice(0, MAX_TEXT_CHARS))
    setEventDraft(null)
  }

  return (
    <div className="paste-preview" style={{ outline: 'none' }}>
      <button type="button" className="counter" onClick={handlePasteButtonClick}>
        Paste with Ctrl/Command + V (or tap this button on mobile)
      </button>
      <div className={`pasted-content ${hasPastedContent ? 'pasted-content-enter' : 'pasted-content-exit'}`}>
          {text && (
            <>
              <textarea
                className="pasted-text-input"
                value={text}
                onChange={handleTextInputChange}
                maxLength={MAX_TEXT_CHARS}
                readOnly={Boolean(imageUrl)}
              />
              <p className="pasted-count">
                {text.length.toLocaleString()} / {MAX_TEXT_CHARS.toLocaleString()} chars since apis aren't cheap 
              </p>
            </>
          )}
          {imageUrl && <img src={imageUrl} alt="Pasted content" />}
      </div>
      {error && <p>{error}</p>}
      <br></br>
      {hasPastedContent && (
        <button type="button" className="counter" onClick={handleSubmit} disabled={isSubmitting}>
          {isSubmitting ? 'Converting...' : 'Submit'}
        </button>
      )}
      {eventDraft && (
        <div className="calendar-event-preview">
          <h2>Review event</h2>
          <label>
            Title
            <input
              type="text"
              value={eventDraft.title}
              onChange={(e) => updateEventField('title', e.target.value)}
            />
          </label>
          <label>
            Description
            <textarea
              value={eventDraft.description}
              onChange={(e) => updateEventField('description', e.target.value)}
            />
          </label>
          <label>
            Location
            <input
              type="text"
              value={eventDraft.location}
              onChange={(e) => updateEventField('location', e.target.value)}
            />
          </label>
          <div className="datetime-row">
            <label>
              Start
              <input
                type="datetime-local"
                value={eventDraft.startLocal}
                onChange={(e) => updateEventField('startLocal', e.target.value)}
              />
            </label>
            <label>
              End
              <input
                type="datetime-local"
                value={eventDraft.endLocal}
                onChange={(e) => updateEventField('endLocal', e.target.value)}
              />
            </label>
          </div>
          <div className="calendar-actions">
            <button type="button" className="counter" onClick={handleDownloadIcs}>
              Download .ics
            </button>
            <a className="counter" href={getGoogleCalendarUrl(eventDraft)} target="_blank" rel="noreferrer">
              Add to Google Calendar
            </a>
            <a className="counter" href={getOutlookCalendarUrl(eventDraft)} target="_blank" rel="noreferrer">
              Add to Outlook
            </a>
          </div>
        
        </div>
        
      )}
    </div>
  )
}