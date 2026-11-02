import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PlayerForm } from '../PlayerForm'

vi.mock('../crop', () => ({
  cropImageToDataUrl: vi.fn().mockResolvedValue('data:image/jpeg;base64,cropped-avatar'),
}))

beforeEach(() => {
  // @ts-expect-error -- only the fields this test touches matter
  window.api = {
    openFile: vi.fn(),
    players: {
      readImportedPhoto: vi.fn(),
    },
  } as Window['api']
})

describe('PlayerForm', () => {
  it('lets the user type a name and pick one of the player accent colors', async () => {
    const onSubmit = vi.fn()
    render(<PlayerForm onSubmit={onSubmit} />)

    await userEvent.type(screen.getByLabelText('Name'), 'Alex')
    await userEvent.click(screen.getAllByRole('button', { name: /color/i })[1])
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ name: 'Alex' }))
  })

  it('choosing a photo via the native dialog reads its bytes over IPC and opens the crop modal', async () => {
    vi.mocked(window.api!.openFile).mockResolvedValue('/Users/me/photo.jpg')
    vi.mocked(window.api!.players.readImportedPhoto).mockResolvedValue('data:image/jpeg;base64,source-photo')

    render(<PlayerForm onSubmit={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Choose photo' }))

    expect(window.api!.openFile).toHaveBeenCalledOnce()
    await waitFor(() => expect(window.api!.players.readImportedPhoto).toHaveBeenCalledWith('/Users/me/photo.jpg'))
    await waitFor(() => expect(screen.getByTestId('avatar-crop-modal')).toBeInTheDocument())
  })

  it('submitting after confirming a crop includes the cropped avatarDataUrl', async () => {
    vi.mocked(window.api!.openFile).mockResolvedValue('/Users/me/photo.jpg')
    vi.mocked(window.api!.players.readImportedPhoto).mockResolvedValue('data:image/jpeg;base64,source-photo')

    const onSubmit = vi.fn()
    render(<PlayerForm onSubmit={onSubmit} />)

    await userEvent.type(screen.getByLabelText('Name'), 'Alex')
    await userEvent.click(screen.getByRole('button', { name: 'Choose photo' }))
    await waitFor(() => expect(screen.getByTestId('avatar-crop-modal')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: 'Use photo' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Alex', avatarDataUrl: 'data:image/jpeg;base64,cropped-avatar' }),
    )
  })

  it('submitting with no photo omits avatarDataUrl entirely', async () => {
    const onSubmit = vi.fn()
    render(<PlayerForm onSubmit={onSubmit} />)

    await userEvent.type(screen.getByLabelText('Name'), 'Alex')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    const call = onSubmit.mock.calls[0][0]
    expect('avatarDataUrl' in call).toBe(false)
  })
})
