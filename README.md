# Minimal P2P Chat Starter

This is the first milestone for your minor project: two peers can connect directly and exchange messages over `libp2p`.

What this does right now:
- each laptop runs as a peer
- one peer listens for incoming connections
- the other peer dials it using the printed multiaddr
- once connected, both terminals can send messages

What this does not do yet:
- no DID document handling
- no custom key exchange flow
- no public key gossip or revocation logic

## Setup

```bash
npm install
```

## Run It On One Machine First

Terminal 1:

```bash
npm run peer -- --port 4001 --name peer-1
```

Copy one of the printed addresses that ends in `/p2p/<peer-id>`.

Terminal 2:

```bash
npm run peer -- --port 4002 --name peer-2 --dial /ip4/127.0.0.1/tcp/4001/p2p/<peer-id>
```

Once peer 2 connects, type a line in either terminal and press enter.

## Run It On Two Devices On Different Networks

Peer 1, the device that accepts incoming connections, must have a reachable public address.

1. Pick a port, for example `4001`.
2. Forward that port on Peer 1's router to Peer 1's laptop.
3. Start Peer 1 with its public address announced:

```bash
npm run peer -- --port 4001 --name peer-1 --announce /ip4/<peer-1-public-ip>/tcp/4001
```

4. Copy the printed `/ip4/.../tcp/4001/p2p/...` address from Peer 1.
5. On Peer 2, dial that address:

```bash
npm run peer -- --port 4002 --name peer-2 --dial /ip4/<peer-1-public-ip>/tcp/4001/p2p/<peer-1-id>
```

If you do not have port forwarding or a public address, direct TCP across different networks usually will not work. In that case, the next step would be adding a relay, WebRTC, or NAT traversal support.

## If You Are On A University Network

If you cannot control the router or enable port forwarding, use an overlay network like Tailscale for this first milestone.

That keeps your app peer-to-peer at the application layer, but gives both laptops a stable private network path even behind campus NAT/firewalls.

### Recommended Flow

1. Install Tailscale on both laptops.
2. Log both laptops into the same tailnet.
3. On Peer 1, get its Tailscale IP.
4. Start Peer 1 and announce that IP:

```bash
npm run peer -- --port 4001 --name peer-1 --announce /ip4/<peer-1-tailscale-ip>/tcp/4001
```

5. Copy the printed `/ip4/.../tcp/4001/p2p/...` address.
6. On Peer 2, dial that address:

```bash
npm run peer -- --port 4002 --name peer-2 --dial /ip4/<peer-1-tailscale-ip>/tcp/4001/p2p/<peer-1-id>
```

### Why This Is The Best Short-Term Option

- no router access needed
- no public IP needed
- minimal code change
- still lets you demonstrate two real devices exchanging messages

### If Tailscale Is Not Allowed

Your next realistic options are:
- add a libp2p relay / hole-punching path
- use a small cloud VM as a bootstrap or relay node

Those are more "pure libp2p" solutions, but they are more work than you need for the very first basic messaging demo.

## Why This Fits Phase 1

This gives you the basic peer-to-peer communication layer first:
- no central application server
- peer identity already exists as a `libp2p` peer id
- bidirectional messaging works over a direct stream

That gives you a clean base to add DID mapping, signatures, and key exchange later.
