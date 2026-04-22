import fs from 'node:fs/promises'
import path from 'node:path'

export class PeerRegistry {
  static async open (file = '.data/peers.json') {
    await fs.mkdir(path.dirname(file), { recursive: true })

    try {
      const data = JSON.parse(await fs.readFile(file, 'utf8'))
      return new PeerRegistry(file, data)
    } catch (error) {
      if (error.code === 'ENOENT') {
        return new PeerRegistry(file, { peers: {} })
      }

      if (error instanceof SyntaxError) {
        return recoverCorruptRegistry(file)
      }

      throw error
    }
  }

  constructor (file, data) {
    this.file = file
    this.data = {
      peers: data.peers ?? {}
    }
  }

  find (idOrDid) {
    return this.data.peers[idOrDid] ??
      Object.values(this.data.peers).find((peer) => peer.did === idOrDid) ??
      null
  }

  documents () {
    return Object.values(this.data.peers)
      .map((peer) => peer.document)
      .filter(Boolean)
  }

  async upsert (document) {
    const existing = this.data.peers[document.peerId]
    const now = new Date().toISOString()

    this.data.peers[document.peerId] = {
      did: document.id,
      peerId: document.peerId,
      libp2pPeerId: document.libp2pPeerId,
      addresses: document.addresses ?? [],
      document,
      firstSeenAt: existing?.firstSeenAt ?? now,
      lastSeenAt: now
    }

    await this.save()
  }

  async save () {
    const tempFile = `${this.file}.${process.pid}.${Date.now()}.tmp`

    await fs.writeFile(tempFile, `${JSON.stringify(this.data, null, 2)}\n`)
    await fs.rename(tempFile, this.file)
  }
}

async function recoverCorruptRegistry (file) {
  const raw = await fs.readFile(file, 'utf8')
  const backupFile = `${file}.corrupt-${Date.now()}`
  const recovered = recoverFirstJsonObject(raw)

  await fs.writeFile(backupFile, raw)

  if (recovered != null) {
    const registry = new PeerRegistry(file, recovered)
    await registry.save()
    console.warn(`Recovered ${file}; corrupt copy saved as ${backupFile}`)
    return registry
  }

  const registry = new PeerRegistry(file, { peers: {} })
  await registry.save()
  console.warn(`Reset ${file}; corrupt copy saved as ${backupFile}`)
  return registry
}

function recoverFirstJsonObject (raw) {
  let depth = 0
  let inString = false
  let escaped = false

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index]

    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        inString = false
      }

      continue
    }

    if (char === '"') {
      inString = true
    } else if (char === '{') {
      depth += 1
    } else if (char === '}') {
      depth -= 1

      if (depth === 0) {
        try {
          return JSON.parse(raw.slice(0, index + 1))
        } catch (error) {
          return null
        }
      }
    }
  }

  return null
}
