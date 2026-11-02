import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Roster } from '../Roster'
import { reorderedIds } from '../reorder'
import { usePlayersStore } from '../store'

const PLAYER_A = { id: 'p1', name: 'Alex', color: 'oklch(0.78 0.19 195)', avatarUrl: '' }
const PLAYER_B = { id: 'p2', name: 'Sam', color: 'oklch(0.78 0.19 320)', avatarUrl: '' }

beforeEach(() => {
  usePlayersStore.setState({
    players: [PLAYER_A, PLAYER_B],
    load: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    reorder: vi.fn(),
  })
})

describe('Roster', () => {
  it('renders a PlayerBadge (initials) for each player', () => {
    render(<Roster />)
    expect(screen.getByText('A')).toBeInTheDocument()
    expect(screen.getByText('S')).toBeInTheDocument()
  })

  it('a create-player action opens the PlayerForm', async () => {
    render(<Roster />)
    await userEvent.click(screen.getByRole('button', { name: 'Add player' }))
    expect(screen.getByLabelText('Name')).toBeInTheDocument()
  })

  it('a delete action calls usePlayersStore.delete(id)', async () => {
    render(<Roster />)
    await userEvent.click(screen.getByRole('button', { name: 'Delete Alex' }))
    expect(usePlayersStore.getState().delete).toHaveBeenCalledWith('p1')
  })

  it('an edit action opens PlayerForm pre-filled with that player, and saving calls usePlayersStore.update', async () => {
    render(<Roster />)
    await userEvent.click(screen.getByRole('button', { name: 'Edit Alex' }))

    const nameInput = screen.getByLabelText('Name') as HTMLInputElement
    expect(nameInput.value).toBe('Alex')

    await userEvent.clear(nameInput)
    await userEvent.type(nameInput, 'Alexandra')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(usePlayersStore.getState().update).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1', name: 'Alexandra' }))
  })

  it('loads players on mount', async () => {
    render(<Roster />)
    await waitFor(() => expect(usePlayersStore.getState().load).toHaveBeenCalledOnce())
  })

  // The roster is a self-headed scene (src/scenes/sceneChrome.ts): the shell
  // draws no bar above it, so Back has to lead the screen's own title row.
  // Losing it here strands the user on this screen.
  it('leads its own header row with Back, before the title', () => {
    render(<Roster />)

    const row = screen.getByTestId('scene-title-bar')
    const back = screen.getByRole('button', { name: 'Back' })

    expect(row).toContainElement(back)
    expect(row).toContainElement(screen.getByRole('heading', { level: 1, name: 'Players' }))
    expect(back.compareDocumentPosition(row.querySelector('h1')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  // The cards sit on the same gutter as the header, not centred in the window.
  it('is a full-width screen rather than a centred island', () => {
    render(<Roster />)

    const scene = screen.getByTestId('roster-scene')
    expect(scene.className).toContain('w-full')
    expect(scene.className).not.toContain('m-auto')
  })
})

// @dnd-kit's drag gestures can't be simulated under jsdom (like react-easy-crop),
// so the reorder math DndContext's onDragEnd calls into is tested directly.
describe('reorderedIds', () => {
  it('moves the active id to the position of the over id', () => {
    expect(reorderedIds(['p1', 'p2', 'p3'], 'p1', 'p3')).toEqual(['p2', 'p3', 'p1'])
    expect(reorderedIds(['p1', 'p2', 'p3'], 'p3', 'p1')).toEqual(['p3', 'p1', 'p2'])
  })

  it('returns the same order when active and over are the same id', () => {
    expect(reorderedIds(['p1', 'p2'], 'p1', 'p1')).toEqual(['p1', 'p2'])
  })
})
