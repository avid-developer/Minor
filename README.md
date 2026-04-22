# Decentralized P2P Key Management Starter

This project is a working starter for the minor synopsis: peers connect over `libp2p`, create their own identities, exchange DID-like documents, derive a shared key with ECDH, and send AES-GCM encrypted chat messages.

Tailscale is only a testing workaround when two student laptops are on different networks. The project identity, key exchange, trust check, and encrypted chat are implemented inside this codebase.

## What Is Implemented

- `libp2p` TCP peer-to-peer communication
- persistent ECDSA identity keys per peer
- persistent libp2p network key per peer
- app peer id = SHA-256 hash of the ECDSA public key
- DID-like JSON document containing peer id, public keys, libp2p id, and addresses
- signed DID document verification during connection setup
- `peers.json` registry for basic custom peer discovery
- automatic LAN peer discovery with libp2p mDNS
- discovery-only bootstrap protocol for fetching known peers
- ECDH P-256 key agreement between peers
- AES-256-GCM encryption for chat messages
- ECDSA signatures on encrypted message envelopes

## Setup

```bash
npm install
```

## Run On One Machine Or LAN

Terminal 1:

```bash
npm run peer -- --port 4100 --name peer-a --identity peer-a
```

Terminal 2:

```bash
npm run peer -- --port 4101 --name peer-b --identity peer-b
```

On the same machine or LAN, peers should discover each other automatically through mDNS. You do not need to copy the `/p2p/...` address for the normal LAN demo.

After discovery, both terminals should print that the remote DID was verified and ECDH completed. Then type messages in either terminal.

## Manual Dial Fallback

If automatic LAN discovery is blocked, manually dial one peer:

```bash
npm run peer -- --port 4101 --name peer-b --identity peer-b --dial /ip4/<peer-a-lan-ip>/tcp/4100/p2p/<peer-a-libp2p-id>
```

Manual dial is only a fallback or bootstrap step, not the main discovery design.

## Run On Different Networks For Testing

If you cannot control router port forwarding, use Tailscale only as the network path.

On Peer A, get its Tailscale IP:

```bash
tailscale ip -4
```

Start Peer A:

```bash
npm run peer -- --port 4100 --name peer-a --identity peer-a --announce /ip4/<peer-a-tailscale-ip>/tcp/4100
```

On Peer B, use Peer A as a discovery-only bootstrap seed. You do not need to paste the `/p2p/<libp2p-id>` part for bootstrap:

```bash
npm run peer -- --port 4101 --name peer-b --identity peer-b --bootstrap /ip4/<peer-a-tailscale-ip>/tcp/4100
```

Tailscale does not provide the project identity or key exchange here. It only makes the devices reachable while you are on different networks. The bootstrap peer only returns known peer documents from `peers.json`; chat messages still use direct libp2p streams and the app's own ECDH/AES-GCM secure channel.

## Discovery Modes

The project now has three discovery paths:

- LAN auto-discovery: enabled by default with libp2p mDNS, so peers on the same LAN can join without copying addresses.
- Bootstrap discovery: `--bootstrap <addr>` contacts one known peer, registers this peer's DID document, receives known peer documents, stores them in `peers.json`, then dials discovered peers directly.
- Manual fallback: `--dial <addr>` still exists for debugging or when discovery is blocked.

You can disable LAN mDNS when testing bootstrap behavior:

```bash
npm run peer -- --port 4101 --name peer-b --identity peer-b --no-mdns --bootstrap /ip4/<seed-ip>/tcp/4100
```

## Peer Registry

Each peer stores local project data in `.data/`:

- `.data/identities/<identity>.identity.json` stores private keys for that peer
- `.data/identities/<identity>.did.json` stores the public DID-like document
- `.data/peers.json` stores known peers discovered after successful handshakes

Do not commit `.data/`. It contains private keys.

After a peer has been saved in `.data/peers.json`, you can dial by app peer id or DID:

```bash
npm run peer -- --port 4101 --name peer-b --identity peer-b --dial-peer <app-peer-id-or-did>
```

## Current Trust Model

This currently uses trust-on-first-use. When a peer connects, its DID document must verify cryptographically, and then it is stored in `peers.json`.

Next possible improvements:

- reject changed keys for a previously seen DID
- add public-key gossip across peers
- add revocation announcements
- add libp2p relay or hole punching for non-LAN networking without Tailscale
