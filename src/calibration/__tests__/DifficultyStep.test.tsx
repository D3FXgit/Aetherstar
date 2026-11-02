import { describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DifficultyStep } from '../DifficultyStep'
import type { Difficulty } from '../types'

// A stateful harness -- a real controlled radio only fires onChange on an
// actual unchecked->checked transition, so the test needs the value prop to
// actually update between clicks, same as the real CalibrationWizard would.
function Harness({ onChange }: { onChange: (d: Difficulty) => void }) {
  const [value, setValue] = useState<Difficulty>('normal')
  return (
    <DifficultyStep
      value={value}
      onChange={(d) => {
        setValue(d)
        onChange(d)
      }}
    />
  )
}

describe('DifficultyStep', () => {
  it('calls onChange with the corresponding Difficulty when each option is selected', async () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)

    await userEvent.click(screen.getByRole('radio', { name: /easy/i }))
    expect(onChange).toHaveBeenLastCalledWith('easy')

    await userEvent.click(screen.getByRole('radio', { name: /hard/i }))
    expect(onChange).toHaveBeenLastCalledWith('hard')

    await userEvent.click(screen.getByRole('radio', { name: /normal/i }))
    expect(onChange).toHaveBeenLastCalledWith('normal')
  })
})
