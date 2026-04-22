import net from 'node:net'

const [host, portText = '4100'] = process.argv.slice(2)

if (host == null) {
  console.error('Usage: npm run tcp-check -- <host> <port>')
  process.exit(1)
}

const port = Number(portText)

if (!Number.isInteger(port) || port <= 0) {
  console.error('Port must be a positive integer.')
  process.exit(1)
}

const socket = net.createConnection({ host, port })
const timeout = setTimeout(() => {
  socket.destroy()
  console.error(`TCP failed: timed out connecting to ${host}:${port}`)
  process.exit(1)
}, 5000)

socket.on('connect', () => {
  clearTimeout(timeout)
  console.log(`TCP OK: connected to ${host}:${port}`)
  socket.end()
})

socket.on('error', (error) => {
  clearTimeout(timeout)
  console.error(`TCP failed: ${error.message}`)
  process.exit(1)
})
