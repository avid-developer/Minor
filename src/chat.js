import readline from 'node:readline'

import { lpStream } from '@libp2p/utils'
import { toString as uint8ArrayToString } from 'uint8arrays/to-string'

export function createChatConsole ({ localName }) {
  const channels = new Map()
  let counter = 0

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true
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

    await Promise.all(Array.from(channels.values(), async ({ writer, label }) => {
      try {
        await writer.write(Buffer.from(message))
      } catch (error) {
        console.error(`Failed to send to ${label}: ${error.message}`)
      }
    }))
  })

  function attachStream (stream, label = null) {
    const channelLabel = label ?? `peer-${++counter}`
    const framedStream = lpStream(stream)

    channels.set(channelLabel, {
      label: channelLabel,
      writer: framedStream
    })

    console.log(`[${localName}] chat stream ready with ${channelLabel}`)

    void readLoop(framedStream, channelLabel)
    return channelLabel
  }

  async function readLoop (framedStream, channelLabel) {
    try {
      while (true) {
        const message = await framedStream.read()
        console.log(`[${channelLabel}] ${uint8ArrayToString(message.subarray())}`)
      }
    } catch (error) {
      console.log(`[${channelLabel}] disconnected`)
      channels.delete(channelLabel)
    }
  }

  return {
    attachStream,
    close () {
      rl.close()
    }
  }
}
