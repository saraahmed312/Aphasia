export type CueType = 'encouragement' | 'hint' | 'slow_down' | 'break'

export type TherapyCommonResponse = {
  emotion_detected: 'positive' | 'frustrated'
  severity_detected: 'mild' | 'moderate' | 'severe'
  adaptive_decision: {
    difficulty: number // 1..5
    cue_type: CueType | string
    cue_strength: number // 0..2
  }
  task_generated: {
    difficulty: string // starter/mild/moderate/severe
    prompt: string
  }
  cue: string
  frustration_streak: number
}

export type TherapyTextResponse = TherapyCommonResponse & {
  input_text: string
}

export type TherapyAudioResponse = TherapyCommonResponse & {
  transcribed_text: string
  // Text-only endpoint returns `input_text`; we treat it as a "transcribed" value for the chat UI.
  input_text?: string
}

function assertJson<T>(res: Response): Promise<T> {
  return res.json() as Promise<T>
}

export async function submitTherapyText(args: {
  text: string
  previousDifficulty: number
  frustrationStreak: number
}): Promise<TherapyTextResponse> {
  const res = await fetch('/therapy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: args.text,
      previous_difficulty: args.previousDifficulty,
      frustration_streak: args.frustrationStreak,
    }),
  })

  if (!res.ok) throw new Error(await res.text())
  return assertJson<TherapyTextResponse>(res)
}

export async function submitTherapyAudio(args: {
  file: File
  previousDifficulty: number
  frustrationStreak: number
}): Promise<TherapyAudioResponse> {
  const form = new FormData()
  form.append('file', args.file)
  form.append('previous_difficulty', String(args.previousDifficulty))
  form.append('frustration_streak', String(args.frustrationStreak))

  const res = await fetch('/therapy_audio', {
    method: 'POST',
    body: form,
  })

  if (!res.ok) throw new Error(await res.text())
  return assertJson<TherapyAudioResponse>(res)
}

