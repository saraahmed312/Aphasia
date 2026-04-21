export default function ModuleStepper(props: {
  steps: string[]
  activeStep: number
}) {
  const { steps, activeStep } = props

  return (
    <div className="stepperBar" aria-label="Therapy pipeline status">
      <div className="stepperInner">
        {steps.map((label, i) => {
          const isActive = i === activeStep
          const isLast = i === steps.length - 1

          let status: 'pending' | 'active' | 'done' = 'pending'
          if (activeStep >= 0) {
            if (i < activeStep) status = 'done'
            else if (isActive) status = isLast ? 'done' : 'active'
          }

          const className = ['stepperStep', status].join(' ')

          return (
            <div key={label} className={className}>
              <div className="stepperDot" aria-hidden="true" />
              <div className="stepperLabel">{label}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

