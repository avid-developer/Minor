import { multiaddr } from '@multiformats/multiaddr'

import { createChatConsole } from './chat.js'
import {
  discoverPeersFromBootstrap,
  handleDiscoveryStream
} from './discovery.js'
import {
  createDidDocument,
  getLibp2pPrivateKey,
  loadOrCreateIdentity,
  saveDidDocument
} from './identity.js'
import { CHAT_PROTOCOL, DISCOVERY_PROTOCOL, createChatPeer } from './libp2p.js'
import { PeerRegistry } from './peer-registry.js'

function parseArgs (argv) {
  const options = {
    port: 4001,
    dial: null,
    dialPeer: null,
    bootstrap: null,
    announce: null,
    identity: null,
    name: null,
    registry: '.data/peers.json',
    noMdns: false,
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
      case '--dial-peer':
        options.dialPeer = next
        index += 1
        break
      case '--bootstrap':
        options.bootstrap = next
        index += 1
        break
      case '--announce':
        options.announce = next
        index += 1
        break
      case '--identity':
        options.identity = next
        index += 1
        break
      case '--name':
        options.name = next
        index += 1
        break
      case '--registry':
        options.registry = next
        index += 1
        break
      case '--no-mdns':
        options.noMdns = true
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

  if (options.dial != null && options.dialPeer != null) {
    throw new Error('Use either `--dial` or `--dial-peer`, not both.')
  }

  return options
}

function printHelp () {
  console.log(`Usage:
  npm run peer -- --port 4001 --name peer-1
  npm run peer -- --port 4002 --name peer-2 --dial /ip4/127.0.0.1/tcp/4001/p2p/<peer-id>
  npm run peer -- --port 4002 --name peer-2 --dial-peer <app-peer-id>
  npm run peer -- --port 4002 --name peer-2 --bootstrap /ip4/127.0.0.1/tcp/4001

Options:
  --port <number>       TCP port to listen on. Default: 4001
  --dial <multiaddr>    Full multiaddr of the remote peer to connect to
  --dial-peer <id>      App peer id or DID from peers.json to connect to
  --bootstrap <addr>    Discovery-only seed peer used to fetch peers.json entries
  --announce <addr>     Public address to advertise, for example /ip4/203.0.113.10/tcp/4001
  --identity <name>     Persistent local identity name. Default: --name or peer-<port>
  --name <label>        Friendly label for logs
  --registry <file>     Peer registry file. Default: .data/peers.json
  --no-mdns             Disable automatic LAN peer discovery
  --help                Show this help
`)
}

function formatShareAddress (address, peerId) {
  const text = address.toString()
  return text.includes('/p2p/') ? text : `${text}/p2p/${peerId.toString()}`
}

function formatBootstrapAddress (address) {
  return address.toString().split('/p2p/')[0]
}

function pickDialAddress (addresses) {
  return addresses.find((address) => !address.startsWith('/ip4/127.')) ?? addresses[0]
}

function peerDiscoveryId (discoveredPeer) {
  return discoveredPeer.id?.toString() ?? discoveredPeer.peerId?.toString() ?? 'unknown-peer'
}

async function main () {
  const options = parseArgs(process.argv.slice(2))

  if (options.help) {
    printHelp()
    return
  }

  const identityName = options.identity ?? options.name ?? `peer-${options.port}`
  const localIdentity = await loadOrCreateIdentity({ name: identityName })
  const peerRegistry = await PeerRegistry.open(options.registry)
  const peer = await createChatPeer({
    port: options.port,
    announce: options.announce == null ? [] : [options.announce],
    privateKey: getLibp2pPrivateKey(localIdentity),
    enableMdns: !options.noMdns
  })

  const peerSuffix = peer.peerId.toString().slice(-6)
  const localName = options.name ?? `peer-${peerSuffix}`
  const getBootstrapAddresses = () => peer.getMultiaddrs().map(formatBootstrapAddress)
  const getLocalAddresses = () => peer.getMultiaddrs().map((address) => {
    return formatShareAddress(address, peer.peerId)
  })
  const localDidDocument = createDidDocument({
    identity: localIdentity,
    libp2pPeerId: peer.peerId.toString(),
    addresses: getLocalAddresses()
  })

  await saveDidDocument(localIdentity, localDidDocument)
  await peerRegistry.upsert(localDidDocument)

  const chat = createChatConsole({
    localName,
    localIdentity,
    libp2pPeerId: peer.peerId.toString(),
    getLocalAddresses,
    peerRegistry
  })
  const pendingDials = new Set()

  async function dialChatTarget (target, { label, key }) {
    if (pendingDials.has(key)) {
      return
    }

    pendingDials.add(key)

    try {
      console.log(`[${localName}] dialing ${label}`)
      const stream = await peer.dialProtocol(target, CHAT_PROTOCOL)
      await chat.attachStream(stream, 'outgoing-peer')
      console.log(`[${localName}] secure chat connected to ${label}. Type a line and press enter.`)
    } catch (error) {
      console.error(`[${localName}] failed to dial ${label}: ${error.message}`)
    } finally {
      pendingDials.delete(key)
    }
  }

  async function dialKnownPeerDocument (remote) {
    if (remote.peerId === localIdentity.peerId || remote.libp2pPeerId === peer.peerId.toString()) {
      return
    }

    const address = pickDialAddress(remote.addresses)

    if (address == null) {
      console.log(`[${localName}] no saved address for ${remote.did}`)
      return
    }

    await dialChatTarget(multiaddr(address), {
      label: `${remote.did} via peers.json`,
      key: `did:${remote.did}`
    })
  }

  peer.addEventListener('peer:connect', (event) => {
    console.log(`[${localName}] connected to ${event.detail.toString()}`)
  })

  peer.addEventListener('peer:discovery', (event) => {
    if (options.noMdns) {
      return
    }

    const discoveredPeer = event.detail
    const discoveredPeerId = peerDiscoveryId(discoveredPeer)

    if (discoveredPeerId === peer.peerId.toString()) {
      return
    }

    if (discoveredPeer.multiaddrs == null || discoveredPeer.multiaddrs.length === 0) {
      return
    }

    void dialChatTarget(discoveredPeer.multiaddrs, {
      label: `LAN-discovered libp2p peer ${discoveredPeerId}`,
      key: `libp2p:${discoveredPeerId}`
    })
  })

  await peer.handle(CHAT_PROTOCOL, async (stream) => {
    void chat.attachStream(stream, 'incoming-peer')
  })

  await peer.handle(DISCOVERY_PROTOCOL, async (stream) => {
    try {
      await handleDiscoveryStream({
        stream,
        localDocument: localDidDocument,
        peerRegistry,
        localName
      })
    } catch (error) {
      console.error(`[${localName}] discovery request failed: ${error.message}`)
    }
  })

  console.log(`[${localName}] ready`)
  console.log(`[${localName}] protocol: ${CHAT_PROTOCOL}`)
  console.log(`[${localName}] discovery protocol: ${DISCOVERY_PROTOCOL}`)
  console.log(`[${localName}] app peer id: ${localIdentity.peerId}`)
  console.log(`[${localName}] DID: ${localIdentity.did}`)
  console.log(`[${localName}] LAN auto-discovery: ${options.noMdns ? 'off' : 'on'}`)
  console.log(`[${localName}] identity file: ${localIdentity.identityFile}`)
  console.log(`[${localName}] DID document: ${localIdentity.didFile}`)
  console.log(`[${localName}] peer registry: ${peerRegistry.file}`)
  console.log(`[${localName}] bootstrap seed addresses, no libp2p id needed:`)
  getBootstrapAddresses().forEach((address) => {
    console.log(address)
  })
  console.log(`[${localName}] full libp2p addresses, only needed for manual --dial fallback:`)
  getLocalAddresses().forEach((address) => {
    console.log(address)
  })

  if (options.bootstrap != null) {
    const discovered = await discoverPeersFromBootstrap({
      peer,
      bootstrapAddress: options.bootstrap,
      localDocument: localDidDocument,
      peerRegistry,
      localName
    })

    for (const remote of discovered) {
      await dialKnownPeerDocument(remote)
    }
  }

  let dialAddress = options.dial

  if (options.dialPeer != null) {
    const knownPeer = peerRegistry.find(options.dialPeer)

    if (knownPeer == null || knownPeer.addresses.length === 0) {
      throw new Error(`No saved address found in ${peerRegistry.file} for ${options.dialPeer}`)
    }

    dialAddress = pickDialAddress(knownPeer.addresses)
    console.log(`[${localName}] loaded ${dialAddress} from peers.json`)
  }

  if (dialAddress != null) {
    await dialChatTarget(multiaddr(dialAddress), {
      label: dialAddress,
      key: `manual:${dialAddress}`
    })
  }

  console.log(`[${localName}] waiting for peer discovery or incoming dials...`)

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
