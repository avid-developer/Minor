import readline from 'node:readline'

import { createSecureChannel } from './secure-channel.js'

export function createChatConsole ({
  localName,
  localIdentity,
  libp2pPeerId,
  getLocalAddresses,
  peerRegistry
}) {
  const channels = new Map()
  let counter = 0

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true
  })

  rl.on('SIGINT', () => {
    process.emit('SIGINT')
  })

  rl.on('line', async (line) => {
    const message = line.trim()

    if (message.length === 0) {
      return
    }

    if (channels.size === 0) {
      console.log('No peer is connected yet.')
      return
    }

    await Promise.all(Array.from(channels.values(), async ({ channel, label }) => {
      try {
        await channel.sendText(message)
      } catch (error) {
        console.error(`Failed to send to ${label}: ${error.message}`)
      }
    }))
  })

  async function attachStream (stream, label = null) {
    const channelLabel = `${label ?? 'peer'}-${++counter}`

    console.log(`[${localName}] starting identity handshake with ${channelLabel}`)

    try {
      const channel = await createSecureChannel({
        stream,
        localIdentity,
        libp2pPeerId,
        getLocalAddresses
      })
      const remoteShortId = channel.remote.peerId.slice(0, 12)
      const fullLabel = `${channelLabel}:${remoteShortId}`

      channels.set(channelLabel, {
        label: fullLabel,
        channel
      })

      await peerRegistry.upsert(channel.remote.document)

      console.log(`[${localName}] verified remote DID ${channel.remote.did}`)
      console.log(`[${localName}] ECDH complete; chat messages are AES-GCM encrypted.`)

      void channel.readLoop(
        (message) => {
          console.log(`[${fullLabel}] ${message}`)
        },
        (error) => {
          channels.delete(channelLabel)
          console.log(`[${fullLabel}] disconnected: ${error.message}`)
        }
      )

      return fullLabel
    } catch (error) {
      channels.delete(channelLabel)
      console.error(`[${localName}] secure channel failed with ${channelLabel}: ${error.message}`)
      return null
    }
  }

  return {
    attachStream,
    close () {
      rl.close()
    }
  }
}
