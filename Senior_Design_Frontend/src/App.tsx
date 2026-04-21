import { useEffect, useMemo, useRef, useState } from 'react'
import ModuleStepper from './components/ModuleStepper'
import ChatBubble, { type ChatMessage } from './components/ChatBubble'
import { submitTherapyAudio, type TherapyAudioResponse } from './lib/api'
import TechnicalPanel, { type PipelineStageView } from './components/TechnicalPanel'
import './patientApp.css'

type RecorderState = 'idle' | 'recording' | 'processing'

export default function App() {
  const steps = useMemo(
    () => [
      'Transcribing',
      'Detecting sentiment',
      'Detecting severity',
      'Adjusting difficulty by ATE',
      'Generating response',
      'DONE',
    ],
    []
  )

  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    // Initial prompt for the patient.
    const firstPrompt = 'Tell me about something you did today.'
    return [
      {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: firstPrompt,
        meta: 'System',
      },
    ]
  })

  const [previousDifficulty, setPreviousDifficulty] = useState(3)
  const [frustrationStreak, setFrustrationStreak] = useState(0)

  const [activeStep, setActiveStep] = useState(-1)
  const [recorderState, setRecorderState] = useState<RecorderState>('idle')
  const [error, setError] = useState<string | null>(null)

  const [techActiveStageIndex, setTechActiveStageIndex] = useState(0)
  const [techIsRunning, setTechIsRunning] = useState(false)
  const [techStages, setTechStages] = useState<PipelineStageView[]>(() => [
    {
      key: 'transcription',
      title: 'Transcription',
      functionName: 'transcribe_audio(file_path)',
      codeSnippet:
        `# backend/services/transcription_service.py\n` +
        `def transcribe_audio(file_path: str) -> str:\n` +
        `    result = model.transcribe(file_path)\n` +
        `    return result["text"]`,
      input: '—',
      output: '—',
      logs: [],
    },
    {
      key: 'sentiment',
      title: 'Sentiment Detection',
      functionName: 'predict_emotion(text, audio_file=None)',
      codeSnippet:
        `# backend/services/sentiment_service.py\n` +
        `def predict_emotion(text: str, audio_file: str = None) -> EmotionState | None:\n` +
        `    try:\n` +
        `        models = _load_models()\n` +
        `        if models is None:\n` +
        `            return None\n` +
        `        processor, distilbert, tokenizer, audio_model, fusion_model = models\n` +
        `        text_probs = softmax(distilbert(tokenize(text)))\n` +
        `        if audio_file is not None:\n` +
        `            audio_emb = audio_model(load_audio(audio_file))\n` +
        `            probs = softmax(fusion_model(audio_emb, text_probs))\n` +
        `            is_positive = probs[0, 1] > probs[0, 0]\n` +
        `        else:\n` +
        `            is_positive = text_probs[0, 1] > text_probs[0, 0]\n` +
        `        return EmotionState.POSITIVE if is_positive else EmotionState.FRUSTRATED\n` +
        `    except Exception:\n` +
        `        return None`,
      input: '—',
      output: '—',
      logs: [],
    },
    {
      key: 'severity',
      title: 'Severity Detection',
      functionName: 'predict_severity(audio_file=None, text=None)',
      codeSnippet:
        `# backend/services/severity_service.py\n` +
        `def predict_severity(audio_file: str = None, text: str = None) -> SeverityLevel | None:\n` +
        `    # fuse audio MFCC + text TF-IDF, then classify\n` +
        `    return SeverityLevel.MILD | SeverityLevel.MODERATE | SeverityLevel.SEVERE`,
      input: '—',
      output: '—',
      logs: [],
    },
    {
      key: 'adaptive_task_engine',
      title: 'Adaptive Task Engine',
      functionName: 'run_adaptive_engine(severity, emotion, previous_difficulty, frustration_streak)',
      codeSnippet:
        `# backend/services/adaptive_service.py\n` +
        `def run_adaptive_engine(severity, emotion, previous_difficulty: int = 3, frustration_streak: int = 0):\n` +
        `    engine_input = EngineInput(\n` +
        `        severity=severity,\n` +
        `        emotion=emotion,\n` +
        `        previous_difficulty=previous_difficulty,\n` +
        `        frustration_streak=frustration_streak,\n` +
        `    )\n` +
        `    return decide_next_step(engine_input)`,
      input: '—',
      output: '—',
      logs: [],
    },
    {
      key: 'response_generation',
      title: 'Response Generation',
      functionName: 'generate_task(difficulty) + cue_module(curr_task, curr_sentiment, difficulty)',
      codeSnippet:
        `# backend/services/task_service.py\n` +
        `task_text = generate_task(str_difficulty)\n` +
        `cue_output = cue_module(curr_task=task_text, curr_sentiment=cue_sentiment, difficulty=str_difficulty)`,
      input: '—',
      output: '—',
      logs: [],
    },
  ])

  const chatEndRef = useRef<HTMLDivElement | null>(null)
  const timeoutsRef = useRef<number[]>([])

  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<BlobPart[]>([])

  const pendingTranscriptIdRef = useRef<string | null>(null)
  const techRunIdRef = useRef<string | null>(null)

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages])

  useEffect(() => {
    return () => {
      timeoutsRef.current.forEach((t) => window.clearTimeout(t))
      timeoutsRef.current = []
      try {
        recorderRef.current?.stop()
      } catch {
        // ignore
      }
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  function clearStepTimers() {
    timeoutsRef.current.forEach((t) => window.clearTimeout(t))
    timeoutsRef.current = []
  }

  function resetTechPanelForNewRun() {
    const runId = crypto.randomUUID()
    techRunIdRef.current = runId
    setTechIsRunning(true)
    setTechActiveStageIndex(0)
    setTechStages((prev) =>
      prev.map((s) => ({
        ...s,
        input: '—',
        output: '—',
        logs: [`run_id=${runId}`, 'status=initialized'],
        json: undefined,
      }))
    )
  }

  function markTechStageActive(stageIndex: number) {
    setTechActiveStageIndex(stageIndex)
    setTechStages((prev) =>
      prev.map((s, idx) => {
        if (idx !== stageIndex) return s
        const line = `active_at=${new Date().toLocaleTimeString()}`
        return { ...s, logs: [...(s.logs ?? []), line] }
      })
    )
  }

  function startPipelineAnimation() {
    clearStepTimers()
    setActiveStep(0)
    markTechStageActive(0)

    // Backend doesn't stream intermediate outputs; we animate the pipeline steps
    // while the request is running so it matches the professor's requested UI.
    // Faster animation so the user sees progress even if backend takes time.
    const schedule = [450, 900, 1350, 1800]
    schedule.forEach((ms, idx) => {
      const stepIndex = idx + 1
      const t = window.setTimeout(() => {
        setActiveStep(stepIndex)
        // Technical panel only shows the 5 stages (no "DONE" step).
        markTechStageActive(Math.min(stepIndex, 4))
      }, ms)
      timeoutsRef.current.push(t)
    })
  }

  function stopStream() {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }

  function bufferToWavFile(buffer: AudioBuffer, fileName: string): File {
    const numChannels = buffer.numberOfChannels
    const sampleRate = buffer.sampleRate
    const length = buffer.length

    // Encode as 16-bit PCM WAV.
    const bytesPerSample = 2
    const blockAlign = numChannels * bytesPerSample
    const byteRate = sampleRate * blockAlign
    const dataSize = length * blockAlign

    const bufferSize = 44 + dataSize
    const arrayBuffer = new ArrayBuffer(bufferSize)
    const view = new DataView(arrayBuffer)

    let offset = 0
    const writeString = (s: string) => {
      for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i))
      offset += s.length
    }

    // RIFF header
    writeString('RIFF')
    view.setUint32(offset, 36 + dataSize, true)
    offset += 4
    writeString('WAVE')

    // fmt chunk
    writeString('fmt ')
    view.setUint32(offset, 16, true)
    offset += 4
    view.setUint16(offset, 1, true) // PCM
    offset += 2
    view.setUint16(offset, numChannels, true)
    offset += 2
    view.setUint32(offset, sampleRate, true)
    offset += 4
    view.setUint32(offset, byteRate, true)
    offset += 4
    view.setUint16(offset, blockAlign, true)
    offset += 2
    view.setUint16(offset, 16, true) // bitsPerSample
    offset += 2

    // data chunk
    writeString('data')
    view.setUint32(offset, dataSize, true)
    offset += 4

    // Interleave channels
    const channelData = Array.from({ length: numChannels }, (_, ch) =>
      buffer.getChannelData(ch)
    )
    for (let i = 0; i < length; i++) {
      for (let ch = 0; ch < numChannels; ch++) {
        const sample = channelData[ch][i] // [-1, 1]
        const clamped = Math.max(-1, Math.min(1, sample))
        const intSample = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff
        view.setInt16(offset, intSample, true)
        offset += 2
      }
    }

    const wavBlob = new Blob([arrayBuffer], { type: 'audio/wav' })
    return new File([wavBlob], fileName, { type: 'audio/wav' })
  }

  async function convertBlobToWavFile(blob: Blob): Promise<File> {
    // Convert whatever MediaRecorder produced into WAV so librosa + Whisper both
    // have the best chance of decoding it reliably.
    const arrayBuffer = await blob.arrayBuffer()
    const audioCtx = new AudioContext()
    const decoded = await audioCtx.decodeAudioData(arrayBuffer.slice(0))

    const targetSampleRate = 16000
    const offline = new OfflineAudioContext(
      decoded.numberOfChannels,
      Math.ceil(decoded.duration * targetSampleRate),
      targetSampleRate
    )

    const src = offline.createBufferSource()
    src.buffer = decoded
    src.connect(offline.destination)
    src.start(0)

    const rendered = await offline.startRendering()
    await audioCtx.close()

    return bufferToWavFile(rendered, 'recording.wav')
  }

  async function startRecording() {
    if (recorderState === 'recording') return
    if (recorderState === 'processing') return

    setError(null)
    resetTechPanelForNewRun()
    setActiveStep(0)
    setTechActiveStageIndex(0)
    setTechStages((prev) =>
      prev.map((s) => {
        if (s.key !== 'transcription') return s
        return {
          ...s,
          input: { source: 'microphone', status: 'recording' },
          output: 'waiting for audio…',
          logs: [...(s.logs ?? []), 'mic=on', 'capturing_audio=true'],
        }
      })
    )

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream

      chunksRef.current = []

      const preferredMimeTypes = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/ogg;codecs=opus',
        'audio/ogg',
      ]
      const mimeType =
        preferredMimeTypes.find((t) => MediaRecorder.isTypeSupported(t)) ??
        ''

      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      recorderRef.current = recorder

      recorder.ondataavailable = (ev: BlobEvent) => {
        if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data)
      }

      recorder.onstop = async () => {
        stopStream()
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || 'audio/webm',
        })

        // If user stopped without recording anything, avoid calling backend.
        if (!blob.size) {
          setTechIsRunning(false)
          setRecorderState('idle')
          return
        }

        setRecorderState('processing')
        const pendingId = crypto.randomUUID()
        pendingTranscriptIdRef.current = pendingId

        // Start the pipeline UI immediately (before wav conversion + backend call),
        // so it doesn't look stuck at "Transcribing".
        setError(null)
        setMessages((prev) => [
          ...prev,
          { id: pendingId, role: 'patient', content: 'Transcribing', meta: 'Transcript module' },
        ])
        startPipelineAnimation()
        setTechStages((prev) =>
          prev.map((s) => {
            if (s.key !== 'transcription') return s
            return {
              ...s,
              input: {
                source: 'recorded_audio_blob',
                mimeType: blob.type || 'unknown',
                sizeBytes: blob.size,
              },
              logs: [...(s.logs ?? []), `blob_bytes=${blob.size}`, `blob_mime=${blob.type}`],
            }
          })
        )

        try {
          const wavFile = await convertBlobToWavFile(blob)
          setTechStages((prev) =>
            prev.map((s) => {
              if (s.key !== 'transcription') return s
              return {
                ...s,
                input: {
                  source: 'wav_file',
                  name: wavFile.name,
                  mimeType: wavFile.type,
                  sizeBytes: wavFile.size,
                  sampleRateHz: 16000,
                },
                logs: [...(s.logs ?? []), 'converted_to_wav=true', 'target_sample_rate_hz=16000'],
              }
            })
          )
          await runTherapy(wavFile, pendingId)
        } catch {
          // If conversion fails for any reason, fall back to original blob.
          const ext = blob.type.includes('ogg') ? 'ogg' : 'webm'
          const fallbackFile = new File([blob], `recording.${ext}`, {
            type: blob.type,
          })
          setTechStages((prev) =>
            prev.map((s) => {
              if (s.key !== 'transcription') return s
              return {
                ...s,
                input: {
                  source: 'fallback_file',
                  name: fallbackFile.name,
                  mimeType: fallbackFile.type,
                  sizeBytes: fallbackFile.size,
                },
                logs: [...(s.logs ?? []), 'converted_to_wav=false', 'fallback_upload=true'],
              }
            })
          )
          await runTherapy(fallbackFile, pendingId)
        }
      }

      recorder.start()
      setRecorderState('recording')
    } catch (e) {
      setRecorderState('idle')
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  function endRecording() {
    const recorder = recorderRef.current
    if (!recorder) return
    if (recorder.state === 'inactive') return
    recorder.stop()
  }

  async function runTherapy(file: File, pendingId: string) {
    if (recorderState === 'processing') {
      // Prevent double-submit, but allow this call to continue.
    }

    try {
      const response: TherapyAudioResponse = await submitTherapyAudio({
        file,
        previousDifficulty,
        frustrationStreak,
      })

      clearStepTimers()
      setActiveStep(5)
      setTechActiveStageIndex(4)

      // Fill the technical panel step-by-step with real data.
      setTechStages((prev) => {
        const transcript = response.transcribed_text ?? response.input_text ?? ''
        const emotion = response.emotion_detected
        const severity = response.severity_detected
        const decision = response.adaptive_decision
        const generated = { task_generated: response.task_generated, cue: response.cue }

        return prev.map((s) => {
          if (s.key === 'transcription') {
            return {
              ...s,
              output: transcript || '(empty transcript)',
              logs: [...(s.logs ?? []), 'transcription=done'],
              json: { transcribed_text: transcript },
            }
          }
          if (s.key === 'sentiment') {
            return {
              ...s,
              input: { text: transcript },
              output: emotion,
              logs: [...(s.logs ?? []), 'sentiment=done'],
              json: { emotion_detected: emotion },
            }
          }
          if (s.key === 'severity') {
            return {
              ...s,
              input: { text: transcript, emotion },
              output: severity,
              logs: [...(s.logs ?? []), 'severity=done'],
              json: { severity_detected: severity },
            }
          }
          if (s.key === 'adaptive_task_engine') {
            return {
              ...s,
              input: {
                previous_difficulty: previousDifficulty,
                frustration_streak: frustrationStreak,
                emotion,
                severity,
              },
              output: decision,
              logs: [...(s.logs ?? []), 'ate=done'],
              json: { adaptive_decision: decision, frustration_streak: response.frustration_streak },
            }
          }
          if (s.key === 'response_generation') {
            return {
              ...s,
              input: { text: transcript, decision },
              output: generated,
              logs: [...(s.logs ?? []), 'response_generation=done'],
              json: response,
            }
          }
          return s
        })
      })

      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        meta: `Sentiment: ${response.emotion_detected} | Severity: ${response.severity_detected} | Difficulty: ${previousDifficulty}→${response.adaptive_decision.difficulty}`,
        content: `Next prompt: ${response.task_generated.prompt}`,
      }

      const cueMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        variant: 'cue',
        meta: 'Cue',
        content: response.cue,
      }

      setMessages((prev) => {
        const updated = prev.map((m) => {
          if (m.id !== pendingId) return m
          return {
            ...m,
            content: response.transcribed_text,
            meta: 'Transcribed',
          }
        })

        return [...updated, cueMsg, assistantMsg]
      })

      setPreviousDifficulty(response.adaptive_decision.difficulty)
      setFrustrationStreak(response.frustration_streak)
    } catch (e) {
      clearStepTimers()
      setActiveStep(-1)
      setTechIsRunning(false)
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
      setMessages((prev) => {
        const updated = prev.map((m) =>
          m.id === pendingId
            ? {
                ...m,
                content: 'Transcription failed',
                meta: msg,
              }
            : m
        )
        return updated
      })
    } finally {
      pendingTranscriptIdRef.current = null
      setRecorderState('idle')
      setTechIsRunning(false)
    }
  }

  const canStop = recorderState === 'recording'

  return (
    <div className="demoLayout">
      <div className="page patientPage">
        <main className="chatWrap" aria-live="polite">
          {messages.map((m) => (
            <ChatBubble key={m.id} message={m} />
          ))}
          <div ref={chatEndRef} />
        </main>

        <section className="controls" aria-label="Patient recording controls">
          <div className="recordPanel">
            <div className="mainRow">
              <button
                className="speakBtn"
                type="button"
                disabled={recorderState !== 'idle'}
                onClick={startRecording}
              >
                {recorderState === 'recording' ? 'Listening...' : 'Press to Speak'}
              </button>

              <button
                className="stopBtn"
                type="button"
                disabled={!canStop}
                onClick={endRecording}
              >
                Stop
              </button>
            </div>

            {error ? <div className="errorBox">{error}</div> : null}
          </div>
        </section>

        <ModuleStepper steps={steps} activeStep={activeStep} />
      </div>

      <TechnicalPanel
        stages={techStages}
        activeStageIndex={techActiveStageIndex}
        isRunning={techIsRunning}
        onSelectStageIndex={(idx) => setTechActiveStageIndex(idx)}
      />
    </div>
  )
}
