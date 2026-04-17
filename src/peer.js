import { multiaddr } from '@multiformats/multiaddr'

import { createChatConsole } from './chat.js'
import { CHAT_PROTOCOL, createChatPeer } from './libp2p.js'

function parseArgs (argv) {
  const options = {
    port: 4001,
    dial: null,
    announce: null,
    name: null,
    help: false
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const next = argv[index + 1]

    switch (arg) {
      case '--port':
        options.port = Number(next)
        index += 1
        break
      case '--dial':
        options.dial = next
        index += 1
        break
      case '--announce':
        options.announce = next
        index += 1
        break
      case '--name':
        options.name = next
        index += 1
        break
      case '--help':
      case '-h':
        options.help = true
        break
      default:
        throw new Error(`Unknown argument: ${arg}`)
    }
  }

  if (!Number.isInteger(options.port) || options.port <= 0) {
    throw new Error('`--port` must be a positive integer.')
  }

  return options
}

function printHelp () {
  console.log(`Usage:
  npm run peer -- --port 4001 --name peer-1
  npm run peer -- --port 4002 --name peer-2 --dial /ip4/127.0.0.1/tcp/4001/p2p/<peer-id>

Options:
  --port <number>       TCP port to listen on. Default: 4001
  --dial <multiaddr>    Full multiaddr of the remote peer to connect to
  --announce <addr>     Public address to advertise, for example /ip4/203.0.113.10/tcp/4001
  --name <label>        Friendly label for logs
  --help                Show this help
`)
}

function formatShareAddress (address, peerId) {
  const text = address.toString()
  return text.includes('/p2p/') ? text : `${text}/p2p/${peerId.toString()}`
}

async function main () {
  const options = parseArgs(process.argv.slice(2))

  if (options.help) {
    printHelp()
    return
  }

  const peer = await createChatPeer({
    port: options.port,
    announce: options.announce == null ? [] : [options.announce]
  })

  const peerSuffix = peer.peerId.toString().slice(-6)
  const localName = options.name ?? `peer-${peerSuffix}`
  const chat = createChatConsole({ localName })

  peer.addEventListener('peer:connect', (event) => {
    console.log(`[${localName}] connected to ${event.detail.toString()}`)
  })

  await peer.handle(CHAT_PROTOCOL, async (stream) => {
    chat.attachStream(stream, 'incoming-peer')
  })

  console.log(`[${localName}] ready`)
  console.log(`[${localName}] protocol: ${CHAT_PROTOCOL}`)
  console.log(`[${localName}] share one of these addresses with the other peer:`)
  peer.getMultiaddrs().forEach((address) => {
    console.log(formatShareAddress(address, peer.peerId))
  })

  if (options.dial == null) {
    console.log(`[${localName}] waiting for another peer to dial in...`)
  } else {
    console.log(`[${localName}] dialing ${options.dial}`)
    const stream = await peer.dialProtocol(multiaddr(options.dial), CHAT_PROTOCOL)
    chat.attachStream(stream, 'outgoing-peer')
    console.log(`[${localName}] chat connected. Type a line and press enter.`)
  }

  const shutdown = async () => {
    console.log(`\n[${localName}] shutting down...`)
    chat.close()
    await peer.stop()
    process.exit(0)
  }

  process.on('SIGINT', () => {
    void shutdown()
  })
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
