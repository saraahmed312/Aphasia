import { useMemo } from 'react'

export type PipelineStageKey =
  | 'transcription'
  | 'sentiment'
  | 'severity'
  | 'adaptive_task_engine'
  | 'response_generation'

export type PipelineStageView = {
  key: PipelineStageKey
  title: string
  functionName: string
  codeSnippet: string
  input: unknown
  output: unknown
  logs?: string[]
  json?: unknown
}

function formatValue(value: unknown): string {
  if (value === null) return 'null'
  if (value === undefined) return '—'
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export default function TechnicalPanel(props: {
  stages: PipelineStageView[]
  activeStageIndex: number
  isRunning: boolean
  onSelectStageIndex?: (index: number) => void
}) {
  const { stages, activeStageIndex, isRunning, onSelectStageIndex } = props

  const active = stages[activeStageIndex] ?? null

  const header = useMemo(() => {
    if (!stages.length) return 'Code panel'
    if (!isRunning) return 'Code panel'
    if (active) return `Code panel (running: ${active.title})`
    return 'Code panel (running)'
  }, [active, isRunning, stages.length])

  return (
    <aside className="techPanel" aria-label="Technical pipeline panel">
      <div className="techHeader">
        <div className="techTitle">{header}</div>
      </div>

      <div className="techBody">
        <div className="techStageList" role="list" aria-label="Pipeline stages list">
          {stages.map((s, idx) => {
            const isActive = idx === activeStageIndex
            const status =
              isRunning && idx < activeStageIndex ? 'done' : isActive ? 'active' : 'pending'
            return (
              <button
                key={s.key}
                type="button"
                className={['techStageItem', status].join(' ')}
                aria-current={isActive ? 'step' : undefined}
                onClick={() => onSelectStageIndex?.(idx)}
              >
                <div className="techStageDot" aria-hidden="true" />
                <div className="techStageText">
                  <div className="techStageName">{s.title}</div>
                  <div className="techStageFn">{s.functionName}</div>
                </div>
              </button>
            )
          })}
        </div>

        <div className="techDetail" aria-label="Active stage detail">
          {!active ? (
            <div className="techEmpty">
              Press <strong>Press to Speak</strong> to start a run.
            </div>
          ) : (
            <>
              <div className="techDetailHeader">
                <div className="techDetailTitle">{active.title}</div>
                <div className="techDetailFn">{active.functionName}</div>
              </div>

              <div className="techSection">
                <div className="techSectionTitle">Function / code snippet</div>
                <pre className="techCode" aria-label="Code snippet">
                  {active.codeSnippet}
                </pre>
              </div>

              <div className="techSection">
                <div className="techSectionTitle">Input</div>
                <pre className="techPre">{formatValue(active.input)}</pre>
              </div>

              <div className="techSection">
                <div className="techSectionTitle">Output / result</div>
                <pre className="techPre">{formatValue(active.output)}</pre>
              </div>

              {active.logs?.length ? (
                <div className="techSection">
                  <div className="techSectionTitle">Logs</div>
                  <pre className="techPre">{active.logs.join('\n')}</pre>
                </div>
              ) : null}

              {active.json !== undefined ? (
                <details className="techDetails">
                  <summary>Optional JSON response</summary>
                  <pre className="techPre">{formatValue(active.json)}</pre>
                </details>
              ) : null}
            </>
          )}
        </div>
      </div>
    </aside>
  )
}

