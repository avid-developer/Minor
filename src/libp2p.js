import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { tcp } from '@libp2p/tcp'
import { createLibp2p } from 'libp2p'

export const CHAT_PROTOCOL = '/minor/basic-chat/1.0.0'

export async function createChatPeer ({ port, announce = [] }) {
  return createLibp2p({
    addresses: {
      listen: [`/ip4/0.0.0.0/tcp/${port}`],
      ...(announce.length > 0 ? { announce } : {})
    },
    transports: [tcp()],
    streamMuxers: [yamux()],
    connectionEncrypters: [noise()]
  })
}
