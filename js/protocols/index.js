import arp from './arp.js';
import icmp from './icmp.js';
import udp from './udp.js';
import tcp from './tcp.js';
import dhcp from './dhcp.js';
import dns from './dns.js';
import http from './http.js';
import tls from './tls.js';
import smtp from './smtp.js';
import { Script } from '../world.js';

// 顺序就是推荐的学习路线：从一根网线开始，一层层往上走
export const PROTOCOLS = [arp, icmp, udp, tcp, dhcp, dns, http, tls, smtp];

export const findProtocol = (id) => PROTOCOLS.find((p) => p.id === id);

const cache = new Map();

export function loadScript(protoId, scenarioId) {
  const key = `${protoId}/${scenarioId}`;
  if (!cache.has(key)) {
    const proto = findProtocol(protoId);
    const sc = proto.scenarios.find((x) => x.id === scenarioId);
    const s = new Script(key);
    sc.build(s);
    s.proto = proto;
    s.scenario = sc;
    s.nodes = Object.keys(sc.positions);
    cache.set(key, s);
  }
  return cache.get(key);
}
