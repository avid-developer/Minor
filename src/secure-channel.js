import {
  createCipheriv,
  createDecipheriv,
  createHash,
  diffieHellman,
  hkdfSync,
  randomBytes
} from 'node:crypto'

import { lpStream } from '@libp2p/utils'

import {
  createDidDocument,
  getEcdhPrivateKey,
  getEcdhPublicKey,
  signPayload,
  verifyDidDocument,
  verifyPayload
} from './identity.js'

export async function createSecureChannel ({
  stream,
  localIdentity,
  libp2pPeerId,
  getLocalAddresses
}) {
  const framedStream = lpStream(stream)
  const remoteHelloPromise = readJson(framedStream)
  const localDocument = createDidDocument({
    identity: localIdentity,
    libp2pPeerId,
    addresses: getLocalAddresses()
  })

  await writeJson(framedStream, {
    type: 'hello',
    document: localDocument
  })

  const remoteHello = await remoteHelloPromise

  if (remoteHello.type !== 'hello') {
    throw new Error('Expected identity hello from remote peer.')
  }

  const remote = verifyDidDocument(remoteHello.document)
  const aesKey = deriveSharedKey(localIdentity, remote)
  let sequence = 0

  async function sendText (text) {
    const encrypted = encryptText(aesKey, text)
    const payload = {
      type: 'ciphertext',
      from: localIdentity.did,
      to: remote.did,
      sequence: ++sequence,
      sentAt: new Date().toISOString(),
      ...encrypted
    }

    await writeJson(framedStream, {
      ...payload,
      signature: signPayload(localIdentity, payload)
    })
  }

  async function readLoop (onMessage, onClose) {
    try {
      while (true) {
        const message = await readJson(framedStream)

        if (message.type !== 'ciphertext') {
          throw new Error(`Unsupported secure-channel message type: ${message.type}`)
        }

        if (message.from !== remote.did) {
          throw new Error('Encrypted message sender did not match the verified remote DID.')
        }

        const { signature, ...signedPayload } = message

        if (!verifyPayload(remote.signingPublicKeyJwk, signedPayload, signature)) {
          throw new Error('Encrypted message signature verification failed.')
        }

        onMessage(decryptText(aesKey, signedPayload), signedPayload)
      }
    } catch (error) {
      onClose(error)
    }
  }

  return {
    localDocument,
    remote,
    sendText,
    readLoop
  }
}

function deriveSharedKey (localIdentity, remote) {
  const sharedSecret = diffieHellman({
    privateKey: getEcdhPrivateKey(localIdentity),
    publicKey: getEcdhPublicKey(remote.ecdhPublicKeyJwk)
  })
  const salt = createHash('sha256')
    .update([localIdentity.peerId, remote.peerId].sort().join(':'))
    .digest()

  return Buffer.from(
    hkdfSync(
      'sha256',
      sharedSecret,
      salt,
      Buffer.from('minor-chat-ecdh-aes-gcm-v1'),
      32
    )
  )
}

function encryptText (key, text) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([
    cipher.update(text, 'utf8'),
    cipher.final()
  ])

  return {
    alg: 'AES-256-GCM',
    kdf: 'ECDH-P256-HKDF-SHA256',
    iv: iv.toString('base64url'),
    ciphertext: ciphertext.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url')
  }
}

function decryptText (key, payload) {
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(payload.iv, 'base64url')
  )

  decipher.setAuthTag(Buffer.from(payload.tag, 'base64url'))

  return Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, 'base64url')),
    decipher.final()
  ]).toString('utf8')
}

async function writeJson (framedStream, value) {
  await framedStream.write(Buffer.from(JSON.stringify(value)))
}

async function readJson (framedStream) {
  const message = await framedStream.read()
  return JSON.parse(Buffer.from(message.subarray()).toString('utf8'))
}
