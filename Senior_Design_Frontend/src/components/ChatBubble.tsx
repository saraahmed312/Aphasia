export type ChatRole = 'patient' | 'assistant'

export type ChatMessage = {
  id: string
  role: ChatRole
  content: string
  meta?: string
  variant?: 'default' | 'cue'
}

export default function ChatBubble(props: { message: ChatMessage }) {
  const { message } = props

  return (
    <div
      className={[
        'chatRow',
        message.role,
        message.variant === 'cue' ? 'cue' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div
        className={[
          'chatBubble',
          message.role,
          message.variant === 'cue' ? 'cue' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {message.meta ? <div className="chatMeta">{message.meta}</div> : null}
        <div className="chatText">{message.content}</div>
      </div>
    </div>
  )
}

