import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { WebSocket, WebSocketServer } from 'ws'
import { createServer } from 'http'

function trackedWs(port) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`)
    const buffer = []
    ws.on('message', (data) => buffer.push(JSON.parse(data.toString())))
    ws.on('open', () => {
      const next = (timeout = 3000) => {
        if (buffer.length) return Promise.resolve(buffer.shift())
        return new Promise((resolve, reject) => {
          if (buffer.length) { resolve(buffer.shift()); return }
          const t = setTimeout(() => reject(new Error('timeout')), timeout)
          const handler = () => {
            clearTimeout(t)
            ws.removeListener('message', handler)
            if (buffer.length) resolve(buffer.shift())
          }
          ws.on('message', handler)
        })
      }
      resolve({ ws, next, close: () => ws.close() })
    })
    ws.on('error', reject)
  })
}

function send(ws, msg) {
  ws.send(JSON.stringify(msg))
}

describe('UNO Server', () => {
  let server, port

  beforeEach(async () => {
    const httpServer = createServer()
    const wss = new WebSocketServer({ noServer: true })

    const clients = new Map()
    const lobbies = new Map()
    const startedLobbies = new Set()

    function createLobby(lobbyId) {
      return { id: lobbyId, players: [], game: { deck: [], discardPile: [], turn: 0, direction: 1, started: false } }
    }

    function findOrCreateLobby(lobbyId) {
      if (!lobbies.has(lobbyId)) lobbies.set(lobbyId, createLobby(lobbyId))
      return lobbies.get(lobbyId)
    }

    function broadcastToLobby(lobbyId, message, excludeClientId = null) {
      for (const [client, meta] of clients) {
        if (meta.lobbyId === lobbyId && meta.id !== excludeClientId) {
          client.send(JSON.stringify(message))
        }
      }
    }

    function broadcastPlayers(lobbyId) {
      const lobby = lobbies.get(lobbyId)
      if (!lobby) return
      broadcastToLobby(lobbyId, { action: 'players', players: lobby.players, turn: lobby.game.turn, lobbyId })
    }

    function checkStartGame(lobbyId) {
      const lobby = lobbies.get(lobbyId)
      if (lobby && lobby.players.length > 1 && lobby.players.every(p => p.ready)) {
        startGame(lobbyId)
      }
    }

    function createDeck(lobbyId) {
      const lobby = lobbies.get(lobbyId)
      if (!lobby) return
      const colors = ['red', 'yellow', 'green', 'blue']
      const types = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'skip', 'reverse', 'draw2']
      for (const color of colors) {
        for (const type of types) {
          lobby.game.deck.push({ color, type })
          if (type !== '0') lobby.game.deck.push({ color, type })
        }
      }
      for (let i = 0; i < 4; i++) {
        lobby.game.deck.push({ type: 'wild' })
        lobby.game.deck.push({ type: 'wild4' })
      }
    }

    function shuffleDeck(lobbyId) {
      const lobby = lobbies.get(lobbyId)
      if (!lobby) return
      for (let i = lobby.game.deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [lobby.game.deck[i], lobby.game.deck[j]] = [lobby.game.deck[j], lobby.game.deck[i]]
      }
    }

    function uuidv4() {
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8)
        return v.toString(16)
      })
    }

    function startGame(lobbyId) {
      const lobby = lobbies.get(lobbyId)
      if (!lobby) return
      lobby.game.started = true
      startedLobbies.add(lobbyId)
      createDeck(lobbyId)
      shuffleDeck(lobbyId)
      for (const player of lobby.players) {
        player.hand = lobby.game.deck.splice(0, 7)
        player.uno = false
      }
      let idx = lobby.game.deck.findIndex(c => c.type !== 'wild' && c.type !== 'wild4')
      if (idx === -1) { shuffleDeck(lobbyId); idx = lobby.game.deck.findIndex(c => c.type !== 'wild' && c.type !== 'wild4') }
      lobby.game.discardPile.push(lobby.game.deck.splice(idx, 1)[0])
      for (const [client, meta] of clients) {
        if (meta.lobbyId === lobbyId) {
          const player = lobby.players.find(p => p.id === meta.id)
          client.send(JSON.stringify({
            action: 'start', players: lobby.players, discardPile: lobby.game.discardPile,
            turn: lobby.game.turn, hand: player.hand, id: meta.id
          }))
        }
      }
    }

    function broadcastWin(lobbyId, winnerName) {
      const lobby = lobbies.get(lobbyId)
      if (!lobby) return
      broadcastToLobby(lobbyId, { action: 'win', winner: winnerName })
      for (const [, meta] of clients) {
        if (meta.lobbyId === lobbyId) meta.lobbyId = null
      }
      lobby.players.length = 0
      lobby.game = { deck: [], discardPile: [], turn: 0, direction: 1, started: false }
      startedLobbies.delete(lobbyId)
    }

    function broadcastGameAborted(lobbyId, excludePlayerId) {
      const lobby = lobbies.get(lobbyId)
      if (!lobby) return
      broadcastToLobby(lobbyId, { action: 'game_aborted' }, excludePlayerId)
      for (const [client, meta] of clients) {
        if (meta.lobbyId === lobbyId && meta.id !== excludePlayerId) meta.lobbyId = null
      }
      lobby.players = []
      lobby.game = { deck: [], discardPile: [], turn: 0, direction: 1, started: false }
      startedLobbies.delete(lobbyId)
    }

    function checkGameAborted(lobbyId, excludePlayerId) {
      const lobby = lobbies.get(lobbyId)
      if (lobby && lobby.game.started && lobby.players.length < 2) {
        broadcastGameAborted(lobbyId, excludePlayerId)
      }
    }

    function handlePlay(lobbyId, playerId, card) {
      const lobby = lobbies.get(lobbyId)
      if (!lobby) return
      const player = lobby.players.find(p => p.id === playerId)
      const playerIndex = lobby.players.indexOf(player)
      if (lobby.game.turn !== playerIndex) return
      let cardIndex = card.type === 'wild' || card.type === 'wild4'
        ? player.hand.findIndex(c => c.type === card.type)
        : player.hand.findIndex(c => c.color === card.color && c.type === card.type)
      if (cardIndex < 0) return
      player.hand.splice(cardIndex, 1)
      lobby.game.discardPile.push(card)
      if (card.type === 'skip') {
        lobby.game.turn = (lobby.game.turn + 2 * lobby.game.direction + lobby.players.length) % lobby.players.length
      } else if (card.type === 'reverse') {
        lobby.game.direction *= -1
        lobby.game.turn = (lobby.game.turn + lobby.game.direction + lobby.players.length) % lobby.players.length
      } else if (card.type === 'draw2') {
        const n = (lobby.game.turn + lobby.game.direction + lobby.players.length) % lobby.players.length
        lobby.players[n].hand.push(...lobby.game.deck.splice(0, 2))
        lobby.game.turn = (lobby.game.turn + 2 * lobby.game.direction + lobby.players.length) % lobby.players.length
      } else if (card.type === 'wild4') {
        const n = (lobby.game.turn + lobby.game.direction + lobby.players.length) % lobby.players.length
        lobby.players[n].hand.push(...lobby.game.deck.splice(0, 4))
        lobby.game.turn = (lobby.game.turn + 2 * lobby.game.direction + lobby.players.length) % lobby.players.length
      } else {
        lobby.game.turn = (lobby.game.turn + lobby.game.direction + lobby.players.length) % lobby.players.length
      }
      broadcastGameUpdate(lobbyId)
      if (player.hand.length === 0) broadcastWin(lobbyId, player.name)
    }

    function broadcastGameUpdate(lobbyId) {
      const lobby = lobbies.get(lobbyId)
      if (!lobby) return
      for (const [client, meta] of clients) {
        if (meta.lobbyId === lobbyId) {
          const player = lobby.players.find(p => p.id === meta.id)
          client.send(JSON.stringify({
            action: 'update', players: lobby.players, discardPile: lobby.game.discardPile,
            turn: lobby.game.turn, hand: player ? player.hand : []
          }))
        }
      }
    }

    function handleDraw(lobbyId, playerId) {
      const lobby = lobbies.get(lobbyId)
      if (!lobby) return
      const playerIndex = lobby.players.findIndex(p => p.id === playerId)
      if (lobby.game.turn !== playerIndex) return
      lobby.players[playerIndex].hand.push(lobby.game.deck.pop())
      lobby.game.turn = (lobby.game.turn + lobby.game.direction + lobby.players.length) % lobby.players.length
      broadcastGameUpdate(lobbyId)
    }

    function handleLeave(lobbyId, playerId) {
      const lobby = lobbies.get(lobbyId)
      if (!lobby) return
      const idx = lobby.players.findIndex(p => p.id === playerId)
      if (idx > -1) {
        lobby.players.splice(idx, 1)
        checkGameAborted(lobbyId, playerId)
        broadcastToLobby(lobbyId, { action: 'players', players: lobby.players, turn: lobby.game.turn, lobbyId }, playerId)
        if (lobby.players.length === 0) lobbies.delete(lobbyId)
      }
    }

    httpServer.on('upgrade', (req, socket, head) => {
      const { pathname } = new URL(req.url, `http://${req.headers.host}`)
      if (pathname === '/ws') {
        wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req))
      } else {
        socket.destroy()
      }
    })

    wss.on('connection', (ws) => {
      const id = uuidv4()
      clients.set(ws, { id })
      ws.send(JSON.stringify({ action: 'init', dev: false }))

      ws.on('message', (raw) => {
        let message
        try { message = JSON.parse(raw.toString()) } catch { ws.close(1002, 'invalid'); return }
        const meta = clients.get(ws)
        switch (message.action) {
          case 'join': {
            meta.name = message.name
            if (typeof message.lobbyId !== 'string' || !message.lobbyId.length) {
              ws.send(JSON.stringify({ action: 'error', message: '请提供大厅名称' }))
              return
            }
            meta.lobbyId = message.lobbyId
            let lobby = findOrCreateLobby(meta.lobbyId)
            if (startedLobbies.has(lobby.id)) {
              ws.send(JSON.stringify({ action: 'error', message: '大厅已开始对局, 请使用其他名称' }))
              return
            }
            if (lobby.players.some(p => p.name.toLowerCase() === message.name.toLowerCase())) {
              ws.send(JSON.stringify({ action: 'error', message: '该大厅中已存在同名玩家，请选择其他名称' }))
              return
            }
            lobby.players.push({ id: meta.id, name: meta.name, ready: false, isCreator: lobby.players.length === 0 })
            broadcastPlayers(meta.lobbyId)
            return
          }
          case 'ready': {
            const lobby = lobbies.get(meta.lobbyId)
            if (!lobby) { ws.send(JSON.stringify({ action: 'error', message: 'not in lobby' })); return }
            const player = lobby.players.find(p => p.id === meta.id)
            if (!player) { ws.send(JSON.stringify({ action: 'error', message: 'not in lobby' })); return }
            player.ready = !player.ready
            broadcastPlayers(meta.lobbyId)
            checkStartGame(meta.lobbyId)
            return
          }
          case 'play': handlePlay(meta.lobbyId, meta.id, message.card); return
          case 'draw': handleDraw(meta.lobbyId, meta.id); return
          case 'leave': handleLeave(meta.lobbyId, meta.id); return
        }
      })

      ws.on('close', () => {
        const meta = clients.get(ws)
        if (meta && meta.lobbyId) {
          const lobby = lobbies.get(meta.lobbyId)
          if (lobby) {
            const idx = lobby.players.findIndex(p => p.id === meta.id)
            if (idx > -1) {
              lobby.players.splice(idx, 1)
              checkGameAborted(meta.lobbyId, meta.id)
              broadcastPlayers(meta.lobbyId)
              if (lobby.players.length === 0) lobbies.delete(meta.lobbyId)
            }
          }
        }
        clients.delete(ws)
      })
    })

    await new Promise(r => httpServer.listen(0, r))
    port = httpServer.address().port
    server = httpServer
  })

  afterEach(() => { server.close() })

  it('connect and receive init', async () => {
    const c = await trackedWs(port)
    const msg = await c.next()
    expect(msg.action).toBe('init')
    expect(msg.dev).toBe(false)
    c.close()
  })

  it('reject join without lobbyId', async () => {
    const c = await trackedWs(port)
    await c.next()
    send(c.ws, { action: 'join', name: 'Alice' })
    const err = await c.next()
    expect(err.action).toBe('error')
    c.close()
  })

  it('reject join with empty lobbyId', async () => {
    const c = await trackedWs(port)
    await c.next()
    send(c.ws, { action: 'join', name: 'Alice', lobbyId: '' })
    const err = await c.next()
    expect(err.action).toBe('error')
    c.close()
  })

  it('join lobby with custom name', async () => {
    const c = await trackedWs(port)
    await c.next()
    send(c.ws, { action: 'join', name: 'Alice', lobbyId: 'myroom' })
    const msg = await c.next()
    expect(msg.action).toBe('players')
    expect(msg.players).toHaveLength(1)
    expect(msg.players[0].name).toBe('Alice')
    expect(msg.players[0].isCreator).toBe(true)
    expect(msg.lobbyId).toBe('myroom')
    c.close()
  })

  it('reject duplicate names in same lobby', async () => {
    const a = await trackedWs(port)
    await a.next()
    send(a.ws, { action: 'join', name: 'Alice', lobbyId: 'r' })
    await a.next()

    const b = await trackedWs(port)
    await b.next()
    send(b.ws, { action: 'join', name: 'Alice', lobbyId: 'r' })
    const err = await b.next()
    expect(err.action).toBe('error')
    expect(err.message).toContain('已存在同名')
    a.close()
    b.close()
  })

  it('two players in same lobby', async () => {
    const a = await trackedWs(port)
    await a.next()
    send(a.ws, { action: 'join', name: 'Alice', lobbyId: 'r' })
    await a.next()

    const b = await trackedWs(port)
    await b.next()
    send(b.ws, { action: 'join', name: 'Bob', lobbyId: 'r' })
    const bob = await b.next()
    expect(bob.players).toHaveLength(2)

    await a.next()
    a.close()
    b.close()
  })

  it('second joiner is non-creator', async () => {
    const a = await trackedWs(port)
    await a.next()
    send(a.ws, { action: 'join', name: 'Alice', lobbyId: 'r' })
    await a.next()

    const b = await trackedWs(port)
    await b.next()
    send(b.ws, { action: 'join', name: 'Bob', lobbyId: 'r' })
    const bob = await b.next()
    expect(bob.players[0].isCreator).toBe(true)
    expect(bob.players[1].isCreator).toBe(false)
    a.close()
    b.close()
  })

  it('leave removes player', async () => {
    const a = await trackedWs(port)
    await a.next()
    send(a.ws, { action: 'join', name: 'Alice', lobbyId: 'r' })
    await a.next()

    const b = await trackedWs(port)
    await b.next()
    send(b.ws, { action: 'join', name: 'Bob', lobbyId: 'r' })
    await b.next()
    await a.next()

    send(b.ws, { action: 'leave' })
    const aliceUpdate = await a.next()
    expect(aliceUpdate.players).toHaveLength(1)
    expect(aliceUpdate.players[0].name).toBe('Alice')
    a.close()
    b.close()
  })

  it('leaver not notified on leave', async () => {
    const a = await trackedWs(port)
    await a.next()
    send(a.ws, { action: 'join', name: 'Alice', lobbyId: 'r' })
    await a.next()

    const b = await trackedWs(port)
    await b.next()
    send(b.ws, { action: 'join', name: 'Bob', lobbyId: 'r' })
    await b.next()
    await a.next()

    let got = false
    b.ws.once('message', () => { got = true })
    send(b.ws, { action: 'leave' })
    await new Promise(r => setTimeout(r, 150))
    expect(got).toBe(false)
    await a.next()
    a.close()
    b.close()
  })

  it('start game when all ready', async () => {
    const a = await trackedWs(port)
    await a.next()
    send(a.ws, { action: 'join', name: 'Alice', lobbyId: 'r' })
    await a.next()

    const b = await trackedWs(port)
    await b.next()
    send(b.ws, { action: 'join', name: 'Bob', lobbyId: 'r' })
    await b.next()
    await a.next()

    send(a.ws, { action: 'ready' })
    await a.next()
    await b.next()
    send(b.ws, { action: 'ready' })

    await a.next() // players
    await b.next() // players
    const s1 = await a.next() // start
    const s2 = await b.next() // start
    expect(s1.action).toBe('start')
    expect(s2.action).toBe('start')
    expect(s1.hand).toHaveLength(7)
    a.close()
    b.close()
  })

  it('play a matching card', async () => {
    const a = await trackedWs(port)
    await a.next()
    send(a.ws, { action: 'join', name: 'Alice', lobbyId: 'r' })
    await a.next()

    const b = await trackedWs(port)
    await b.next()
    send(b.ws, { action: 'join', name: 'Bob', lobbyId: 'r' })
    await b.next()
    await a.next()

    send(a.ws, { action: 'ready' }); await a.next(); await b.next()
    send(b.ws, { action: 'ready' })
    await a.next(); await b.next()

    const s1 = await a.next()
    await b.next()

    const topCard = s1.discardPile[0]
    const matching = s1.hand.find(c => c.color === topCard.color || c.type === topCard.type)
    if (matching) {
      send(a.ws, { action: 'play', card: matching })
      const u = await a.next()
      expect(u.action).toBe('update')
      expect(u.hand.length).toBeLessThan(7)
    }
    a.close()
    b.close()
  })

  it('draw card', async () => {
    const a = await trackedWs(port)
    await a.next()
    send(a.ws, { action: 'join', name: 'Alice', lobbyId: 'r' })
    await a.next()

    const b = await trackedWs(port)
    await b.next()
    send(b.ws, { action: 'join', name: 'Bob', lobbyId: 'r' })
    await b.next()
    await a.next()

    send(a.ws, { action: 'ready' }); await a.next(); await b.next()
    send(b.ws, { action: 'ready' }); await a.next(); await b.next()
    await a.next(); await b.next()

    send(a.ws, { action: 'draw' })
    const u = await a.next()
    expect(u.action).toBe('update')
    expect(u.hand).toHaveLength(8)
    a.close()
    b.close()
  })

  it('abort game when opponent disconnects', async () => {
    const a = await trackedWs(port)
    await a.next()
    send(a.ws, { action: 'join', name: 'Alice', lobbyId: 'r' })
    await a.next()

    const b = await trackedWs(port)
    await b.next()
    send(b.ws, { action: 'join', name: 'Bob', lobbyId: 'r' })
    await b.next()
    await a.next()

    send(a.ws, { action: 'ready' }); await a.next(); await b.next()
    send(b.ws, { action: 'ready' }); await a.next(); await b.next()
    await a.next(); await b.next()

    b.close()
    const aborted = await a.next()
    expect(aborted.action).toBe('game_aborted')
    a.close()
  })

  it('abort game when opponent leaves', async () => {
    const a = await trackedWs(port)
    await a.next()
    send(a.ws, { action: 'join', name: 'Alice', lobbyId: 'r' })
    await a.next()

    const b = await trackedWs(port)
    await b.next()
    send(b.ws, { action: 'join', name: 'Bob', lobbyId: 'r' })
    await b.next()
    await a.next()

    send(a.ws, { action: 'ready' }); await a.next(); await b.next()
    send(b.ws, { action: 'ready' }); await a.next(); await b.next()
    await a.next(); await b.next()

    send(b.ws, { action: 'leave' })
    const aborted = await a.next()
    expect(aborted.action).toBe('game_aborted')
    a.close()
    b.close()
  })

  it('reject join to started lobby', async () => {
    const a = await trackedWs(port)
    await a.next()
    send(a.ws, { action: 'join', name: 'Alice', lobbyId: 'r' })
    await a.next()

    const b = await trackedWs(port)
    await b.next()
    send(b.ws, { action: 'join', name: 'Bob', lobbyId: 'r' })
    await b.next()
    await a.next()

    send(a.ws, { action: 'ready' }); await a.next(); await b.next()
    send(b.ws, { action: 'ready' }); await a.next(); await b.next()
    await a.next(); await b.next()

    const c = await trackedWs(port)
    await c.next()
    send(c.ws, { action: 'join', name: 'Eve', lobbyId: 'r' })
    const err = await c.next()
    expect(err.action).toBe('error')
    expect(err.message).toContain('已开始')
    a.close()
    b.close()
    c.close()
  })

  it('can rejoin ended lobby', async () => {
    const a = await trackedWs(port)
    await a.next()
    send(a.ws, { action: 'join', name: 'Alice', lobbyId: 'r' })
    await a.next()

    const b = await trackedWs(port)
    await b.next()
    send(b.ws, { action: 'join', name: 'Bob', lobbyId: 'r' })
    await b.next()
    await a.next()

    send(a.ws, { action: 'ready' }); await a.next(); await b.next()
    send(b.ws, { action: 'ready' }); await a.next(); await b.next()
    await a.next(); await b.next()

    // Bob leaves -> game aborted
    send(b.ws, { action: 'leave' })
    await a.next()

    // Now new player can join "r" since it's no longer started
    const c = await trackedWs(port)
    await c.next()
    send(c.ws, { action: 'join', name: 'Eve', lobbyId: 'r' })
    const msg = await c.next()
    expect(msg.action).toBe('players')
    expect(msg.lobbyId).toBe('r')
    expect(msg.players).toHaveLength(1)
    a.close()
    b.close()
    c.close()
  })
})
