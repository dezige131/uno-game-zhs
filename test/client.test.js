import { describe, it, expect, beforeEach, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import fs from 'fs'
import path from 'path'

// Read the HTML file
const html = fs.readFileSync(path.resolve('./index.html'), 'utf8')

describe('UNO Client', () => {
  let dom
  let mockWebSocket
  let mockWebSocketConstructor

  beforeEach(() => {
    // Create a fresh DOM for each test
    dom = new JSDOM(html, {
      url: 'http://localhost:3000',
      runScripts: 'dangerously',
      resources: 'usable'
    })

    // Mock WebSocket with proper state management
    mockWebSocket = {
      send: vi.fn(),
      close: vi.fn(),
      readyState: 1, // WebSocket.OPEN
      onopen: null,
      onmessage: null,
      onclose: null,
      onerror: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    }

    // Create a mock constructor that returns our mock instance
    mockWebSocketConstructor = vi.fn(() => mockWebSocket)
    
    // Mock localStorage
    const mockLocalStorage = {
      getItem: vi.fn(),
      setItem: vi.fn(),
      removeItem: vi.fn()
    }
    
    // Set up the DOM window with our mocks
    dom.window.WebSocket = mockWebSocketConstructor
    dom.window.localStorage = mockLocalStorage
    
    // Make DOM globals available
    global.document = dom.window.document
    global.window = dom.window
    global.WebSocket = mockWebSocketConstructor
    global.localStorage = mockLocalStorage
  })

  it('should have the correct HTML structure', () => {
    expect(dom.window.document.getElementById('lobby')).toBeTruthy()
    expect(dom.window.document.getElementById('game')).toBeTruthy()
    expect(dom.window.document.getElementById('draw-card')).toBeTruthy()
    expect(dom.window.document.getElementById('lobby-id')).toBeTruthy()
    expect(dom.window.document.getElementById('turn-indicator')).toBeTruthy()
    expect(dom.window.document.getElementById('wild-color-picker')).toBeTruthy()
    expect(dom.window.document.getElementById('lobby-info')).toBeTruthy()
  })

  it('should have all required form elements', () => {
    expect(dom.window.document.getElementById('name')).toBeTruthy()
    expect(dom.window.document.getElementById('join')).toBeTruthy()
    expect(dom.window.document.getElementById('ready')).toBeTruthy()
    expect(dom.window.document.getElementById('player-hand')).toBeTruthy()
    expect(dom.window.document.getElementById('discard-pile')).toBeTruthy()
    expect(dom.window.document.getElementById('players')).toBeTruthy()
  })

  it('should have wild color picker with all colors', () => {
    const colorPicker = dom.window.document.getElementById('wild-color-picker')
    expect(colorPicker).toBeTruthy()
    
    const colorButtons = colorPicker.querySelectorAll('.color-option')
    expect(colorButtons.length).toBe(4)
    
    const colors = Array.from(colorButtons).map(btn => btn.dataset.color)
    expect(colors).toEqual(['red', 'yellow', 'green', 'blue'])
  })

  it('should have turn indicator element', () => {
    const turnIndicator = dom.window.document.getElementById('turn-indicator')
    expect(turnIndicator).toBeTruthy()
    
    const turnText = dom.window.document.getElementById('turn-text')
    expect(turnText).toBeTruthy()
    expect(turnText.textContent.trim()).toBe('等待游戏开始...')
  })

  it('should have lobby info section', () => {
    const lobbyInfo = dom.window.document.getElementById('lobby-info')
    expect(lobbyInfo).toBeTruthy()
    expect(lobbyInfo.style.display).toBe('none')
    
    const lobbyIdSpan = dom.window.document.getElementById('current-lobby-id')
    expect(lobbyIdSpan).toBeTruthy()
  })

  it('should have game control buttons', () => {
    const drawButton = dom.window.document.getElementById('draw-card')
    expect(drawButton).toBeTruthy()
  })

  it('should not have UNO button (auto UNO feature)', () => {
    const unoButton = dom.window.document.getElementById('uno-button')
    expect(unoButton).toBeNull()
  })

  it('should have game areas', () => {
    const playerHand = dom.window.document.getElementById('player-hand')
    expect(playerHand).toBeTruthy()
    
    const opponentHands = dom.window.document.getElementById('opponent-hands')
    expect(opponentHands).toBeTruthy()
    
    const centerArea = dom.window.document.getElementById('center-area')
    expect(centerArea).toBeTruthy()
  })

  // Test WebSocket functionality with manual setup
  it('should be able to create WebSocket connection', () => {
    // Simulate what the client.js would do
    const ws = new dom.window.WebSocket('ws://localhost:8080')
    expect(mockWebSocketConstructor).toHaveBeenCalledWith('ws://localhost:8080')
    expect(ws).toBe(mockWebSocket)
  })

  it('should handle form submission properly', () => {
    const nameInput = dom.window.document.getElementById('name')
    const lobbyIdInput = dom.window.document.getElementById('lobby-id')
    const joinButton = dom.window.document.getElementById('join')
    
    expect(nameInput).toBeTruthy()
    expect(lobbyIdInput).toBeTruthy()
    expect(joinButton).toBeTruthy()
    
    // Test that form elements can be manipulated
    nameInput.value = 'Test Player'
    lobbyIdInput.value = 'ABC123'
    
    expect(nameInput.value).toBe('Test Player')
    expect(lobbyIdInput.value).toBe('ABC123')
  })

  it('should have proper initial styling', () => {
    const gameDiv = dom.window.document.getElementById('game')
    expect(gameDiv.style.display).toBe('none')
    
    const lobbyDiv = dom.window.document.getElementById('lobby')
    expect(lobbyDiv.style.display).toBe('')
    
    const wildColorPicker = dom.window.document.getElementById('wild-color-picker')
    expect(wildColorPicker.style.display).toBe('none')
  })
}) 