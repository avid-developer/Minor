import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  createSign,
  createVerify,
  generateKeyPairSync
} from 'node:crypto'

import {
  generateKeyPair,
  privateKeyFromProtobuf,
  privateKeyToProtobuf
} from '@libp2p/crypto/keys'

import { stableStringify } from './canonical-json.js'

const CURVE = 'prime256v1'
const DID_METHOD = 'did:minor'

export async function loadOrCreateIdentity ({ name, baseDir = '.data/identities' }) {
  const safeName = sanitizeFileName(name)
  const identityFile = path.join(baseDir, `${safeName}.identity.json`)
  const didFile = path.join(baseDir, `${safeName}.did.json`)

  await fs.mkdir(baseDir, { recursive: true })

  if (existsSync(identityFile)) {
    const identity = await ensureLibp2pKey(
      JSON.parse(await fs.readFile(identityFile, 'utf8')),
      identityFile
    )

    return {
      ...identity,
      safeName,
      identityFile,
      didFile
    }
  }

  const identity = await createIdentity(name)

  await fs.writeFile(identityFile, `${JSON.stringify(identity, null, 2)}\n`, {
    mode: 0o600
  })

  return {
    ...identity,
    safeName,
    identityFile,
    didFile
  }
}

export async function saveDidDocument (identity, document) {
  await fs.writeFile(identity.didFile, `${JSON.stringify(document, null, 2)}\n`)
}

export function createDidDocument ({ identity, libp2pPeerId, addresses }) {
  const now = new Date().toISOString()
  const document = {
    '@context': ['https://www.w3.org/ns/did/v1'],
    id: identity.did,
    peerId: identity.peerId,
    libp2pPeerId,
    addresses,
    verificationMethod: [
      {
        id: `${identity.did}#signing-key-1`,
        type: 'JsonWebKey2020',
        controller: identity.did,
        publicKeyJwk: identity.signingPublicKeyJwk
      }
    ],
    keyAgreement: [
      {
        id: `${identity.did}#ecdh-key-1`,
        type: 'JsonWebKey2020',
        controller: identity.did,
        publicKeyJwk: identity.ecdhPublicKeyJwk
      }
    ],
    updatedAt: now
  }

  return {
    ...document,
    proof: {
      type: 'EcdsaSecp256r1Signature2026',
      created: now,
      verificationMethod: `${identity.did}#signing-key-1`,
      signature: signPayload(identity, document)
    }
  }
}

export function verifyDidDocument (document) {
  const signingPublicKeyJwk = document.verificationMethod?.[0]?.publicKeyJwk
  const ecdhPublicKeyJwk = document.keyAgreement?.[0]?.publicKeyJwk

  if (signingPublicKeyJwk == null || ecdhPublicKeyJwk == null) {
    throw new Error('DID document is missing public keys.')
  }

  const expectedPeerId = computePeerId(signingPublicKeyJwk)

  if (document.peerId !== expectedPeerId) {
    throw new Error('DID document peer id does not match its public signing key.')
  }

  if (document.id !== `${DID_METHOD}:${document.peerId}`) {
    throw new Error('DID document id does not match the peer id.')
  }

  const { proof, ...unsignedDocument } = document

  if (proof?.signature == null) {
    throw new Error('DID document is missing its signature proof.')
  }

  if (!verifyPayload(signingPublicKeyJwk, unsignedDocument, proof.signature)) {
    throw new Error('DID document signature verification failed.')
  }

  return {
    did: document.id,
    peerId: document.peerId,
    libp2pPeerId: document.libp2pPeerId,
    addresses: document.addresses ?? [],
    signingPublicKeyJwk,
    ecdhPublicKeyJwk,
    document
  }
}

export function signPayload (identity, payload) {
  const signer = createSign('SHA256')
  signer.update(stableStringify(payload))
  signer.end()

  return signer
    .sign(createPrivateKey({ key: identity.signingPrivateKeyJwk, format: 'jwk' }))
    .toString('base64url')
}

export function verifyPayload (publicKeyJwk, payload, signature) {
  const verifier = createVerify('SHA256')
  verifier.update(stableStringify(payload))
  verifier.end()

  return verifier.verify(
    createPublicKey({ key: publicKeyJwk, format: 'jwk' }),
    Buffer.from(signature, 'base64url')
  )
}

export function getEcdhPrivateKey (identity) {
  return createPrivateKey({
    key: identity.ecdhPrivateKeyJwk,
    format: 'jwk'
  })
}

export function getEcdhPublicKey (publicKeyJwk) {
  return createPublicKey({
    key: publicKeyJwk,
    format: 'jwk'
  })
}

export function getLibp2pPrivateKey (identity) {
  return privateKeyFromProtobuf(Buffer.from(identity.libp2pPrivateKey, 'base64url'))
}

async function createIdentity (name) {
  const signingKeys = generateKeyPairSync('ec', { namedCurve: CURVE })
  const ecdhKeys = generateKeyPairSync('ec', { namedCurve: CURVE })
  const libp2pPrivateKey = await generateLibp2pPrivateKey()
  const signingPublicKeyJwk = signingKeys.publicKey.export({ format: 'jwk' })
  const peerId = computePeerId(signingPublicKeyJwk)

  return {
    name,
    peerId,
    did: `${DID_METHOD}:${peerId}`,
    curve: CURVE,
    createdAt: new Date().toISOString(),
    libp2pPrivateKey,
    signingPublicKeyJwk,
    signingPrivateKeyJwk: signingKeys.privateKey.export({ format: 'jwk' }),
    ecdhPublicKeyJwk: ecdhKeys.publicKey.export({ format: 'jwk' }),
    ecdhPrivateKeyJwk: ecdhKeys.privateKey.export({ format: 'jwk' })
  }
}

async function ensureLibp2pKey (identity, identityFile) {
  if (identity.libp2pPrivateKey != null) {
    return identity
  }

  const updatedIdentity = {
    ...identity,
    libp2pPrivateKey: await generateLibp2pPrivateKey()
  }

  await fs.writeFile(identityFile, `${JSON.stringify(updatedIdentity, null, 2)}\n`, {
    mode: 0o600
  })

  return updatedIdentity
}

async function generateLibp2pPrivateKey () {
  return Buffer.from(
    privateKeyToProtobuf(await generateKeyPair('Ed25519'))
  ).toString('base64url')
}

function computePeerId (publicKeyJwk) {
  return createHash('sha256')
    .update(stableStringify(publicKeyJwk))
    .digest('hex')
}

function sanitizeFileName (value) {
  return String(value)
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'peer'
}
