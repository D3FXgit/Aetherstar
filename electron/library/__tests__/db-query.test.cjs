// @vitest-environment node
// Pure query-building helpers from db.cjs -- no database connection needed.
const { toFtsPrefixQuery, pathOrDescendantsClause, buildSearchQuery } = require('../db.cjs')

describe('toFtsPrefixQuery', () => {
  it('quotes each word as its own prefix phrase', () => {
    expect(toFtsPrefixQuery('nova la')).toBe('"nova"* "la"*')
    expect(toFtsPrefixQuery('TX/RX')).toBe('"TX/RX"*')
  })

  it('doubles internal quotes and keeps FTS5 operators inert', () => {
    expect(toFtsPrefixQuery('don"t')).toBe('"don""t"*')
    expect(toFtsPrefixQuery('(rock NOT roll)')).toBe('"(rock"* "NOT"* "roll)"*')
  })

  it('drops words with nothing searchable in them, and returns null when none are left', () => {
    expect(toFtsPrefixQuery('a - b')).toBe('"a"* "b"*')
    expect(toFtsPrefixQuery(' - ')).toBeNull()
    expect(toFtsPrefixQuery('')).toBeNull()
    expect(toFtsPrefixQuery(undefined)).toBeNull()
  })

  it('keeps non-Latin letters', () => {
    expect(toFtsPrefixQuery('Ärzte 東京')).toBe('"Ärzte"* "東京"*')
  })
})

describe('buildSearchQuery', () => {
  it('only joins the FTS table when there is something to match', () => {
    expect(buildSearchQuery({ query: ' - ' }).sql).not.toContain('MATCH')
    expect(buildSearchQuery({ query: 'TX/RX' }).params.query).toBe('"TX/RX"*')
  })
})

describe('pathOrDescendantsClause', () => {
  it('matches the folder itself plus both separator styles beneath it', () => {
    const { clause, params } = pathOrDescendantsClause('path', '/m/x_y')
    const back = `/m/x_y${String.fromCharCode(92)}`
    // The prefix length is SQLite's own length(?), never JS .length (UTF-16
    // units disagree with SQLite characters for astral code points).
    expect(clause).toBe('path = ? OR substr(path, 1, length(?)) = ? OR substr(path, 1, length(?)) = ?')
    expect(params).toEqual(['/m/x_y', '/m/x_y/', '/m/x_y/', back, back])
  })

  it('does not add a second separator to a root that already ends in one', () => {
    const root = `D:${String.fromCharCode(92)}`
    const { params } = pathOrDescendantsClause('path', root)
    expect(params).toEqual([root, root, root])
  })
})
