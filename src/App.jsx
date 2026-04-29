import { useEffect, useState } from 'react'
import PastePreview from './PastePreview'
import './App.css'

function App() {
  const handleCommandVKeystroke = (event) => {
    // TODO: Add paste parsing/scheduling logic here
    // .
    console.log('Paste shortcut detected:', event)
  }
//fugaze
  useEffect(() => {
    const onKeyDown = (event) => {
      const isVKey = event.key.toLowerCase() === 'v'
      const isPasteModifier = event.metaKey || event.ctrlKey

      if (!isPasteModifier || !isVKey) return

      handleCommandVKeystroke(event)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <>
      <section id="center">
        <div className="hero">
    
        </div>
        <div>
          <h1>Scheduled.</h1>
          <p>
            Remembering to schedule stuff is hard. Paste text or images and we'll schedule it for you. Works with (pretty much) any calendar. Created by <a href="https://www.linkedin.com/in/ali-zia-columbia" target="_blank" rel="noopener noreferrer">Ali Zia</a>.
          </p>
        </div>
        <PastePreview />
      </section>

    </>
  )
}


export default App
