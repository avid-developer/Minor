import { lpStream } from '@libp2p/utils'
import { multiaddr } from '@multiformats/multiaddr'

import { verifyDidDocument } from './identity.js'
import { DISCOVERY_PROTOCOL } from './libp2p.js'

export async function handleDiscoveryStream ({
  stream,
  localDocument,
  peerRegistry,
  localName
}) {
  const framedStream = lpStream(stream)
  const request = await readJson(framedStream)

  if (request.type !== 'register') {
    throw new Error(`Unsupported discovery message type: ${request.type}`)
  }

  const remote = verifyDidDocument(request.document)
  await peerRegistry.upsert(request.document)

  const peers = peerRegistry
    .documents()
    .filter((document) => document.peerId !== remote.peerId)

  await writeJson(framedStream, {
    type: 'peers',
    from: localDocument,
    peers
  })

  console.log(`[${localName}] discovery request served for ${remote.did}; returned ${peers.length} peer(s).`)
}

export async function discoverPeersFromBootstrap ({
  peer,
  bootstrapAddress,
  localDocument,
  peerRegistry,
  localName
}) {
  console.log(`[${localName}] asking bootstrap peer for known peers: ${bootstrapAddress}`)

  const stream = await peer.dialProtocol(multiaddr(bootstrapAddress), DISCOVERY_PROTOCOL)
  const framedStream = lpStream(stream)

  await writeJson(framedStream, {
    type: 'register',
    document: localDocument
  })

  const response = await readJson(framedStream)

  if (response.type !== 'peers') {
    throw new Error(`Unexpected discovery response type: ${response.type}`)
  }

  const bootstrap = verifyDidDocument(response.from)
  await peerRegistry.upsert(response.from)

  const discovered = []

  for (const document of response.peers) {
    const remote = verifyDidDocument(document)

    if (remote.peerId !== localDocument.peerId) {
      await peerRegistry.upsert(document)
      discovered.push(remote)
    }
  }

  console.log(`[${localName}] bootstrap ${bootstrap.did} returned ${discovered.length} peer(s).`)
  return discovered
}

async function writeJson (framedStream, value) {
  await framedStream.write(Buffer.from(JSON.stringify(value)))
}

async function readJson (framedStream) {
  const message = await framedStream.read()
  return JSON.parse(Buffer.from(message.subarray()).toString('utf8'))
}
