import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PermissionErrorState } from '../PermissionErrorState'
import { usePitchStore } from '../pitchStore'

describe('PermissionErrorState', () => {
  beforeEach(() => {
    usePitchStore.setState({ permissionStatus: 'denied', requestPermission: vi.fn() })
  })

  it('renders the error state and a retry action', () => {
    render(<PermissionErrorState />)
    expect(screen.getByRole('heading', { name: 'Mic access needed' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('clicking retry calls requestPermission again', () => {
    render(<PermissionErrorState />)
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(usePitchStore.getState().requestPermission).toHaveBeenCalled()
  })
})
