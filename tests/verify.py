#!/usr/bin/env python3
"""校验所有报文的字节：不信任 JS 的编码结果，用独立实现重新算一遍。

  python3 tests/verify.py

1. 无头 Chrome 打开 tests/dump.html，导出每个场景每段链路上的字节
2. Python 重算 IP/TCP/UDP/ICMP 校验和，检查长度字段、字段覆盖、序号、TTL、NAT
3. 写成 pcap，交给 tcpdump 解码，检查校验和与截断报告
"""
import html, http.server, json, os, re, shutil, socketserver, struct, subprocess, sys, tempfile, threading

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
errors = []
stats = dict(scenarios=0, frames=0, views=0, ip=0, tcp=0, udp=0, icmp=0, arp=0)

def err(where, msg):
    errors.append(f"{where}: {msg}")

def csum(b):
    if len(b) % 2:
        b += b"\0"
    s = sum(struct.unpack(f"!{len(b)//2}H", b))
    while s >> 16:
        s = (s & 0xFFFF) + (s >> 16)
    return ~s & 0xFFFF

def dump():
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **k): super().__init__(*a, directory=ROOT, **k)
        def log_message(self, *a): pass
    srv = socketserver.TCPServer(("127.0.0.1", 0), Quiet)
    port = srv.server_address[1]
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    chrome = shutil.which("google-chrome") or shutil.which("chromium") or shutil.which("chromium-browser")
    with tempfile.TemporaryDirectory() as prof:
        out = subprocess.run([chrome, "--headless=new", "--disable-gpu", "--no-sandbox", f"--user-data-dir={prof}",
                              "--virtual-time-budget=8000", "--dump-dom", f"http://127.0.0.1:{port}/tests/dump.html"],
                             capture_output=True, text=True, timeout=90).stdout
    srv.shutdown()
    m = re.search(r'<pre id="out">(.*?)</pre>', out, re.S)
    text = html.unescape(m.group(1)) if m else "ERROR no output"
    if text.startswith(("ERROR", "pending")):
        sys.exit(f"导出失败：{text}")
    return json.loads(text)

def check_ip(where, b):
    stats["ip"] += 1
    ihl = (b[0] & 15) * 4
    if b[0] >> 4 != 4: err(where, "not IPv4")
    total = struct.unpack("!H", b[2:4])[0]
    if total != len(b): err(where, f"IP total length {total} != {len(b)}")
    if csum(b[:ihl]) != 0: err(where, "bad IP checksum")
    proto, src, dst = b[9], b[12:16], b[16:20]
    body = b[ihl:]
    pseudo = src + dst + bytes([0, proto]) + struct.pack("!H", len(body))
    if proto == 6:
        stats["tcp"] += 1
        if csum(pseudo + body) != 0: err(where, "bad TCP checksum")
        if (body[12] >> 4) * 4 < 20: err(where, "bad TCP data offset")
    elif proto == 17:
        stats["udp"] += 1
        if csum(pseudo + body) != 0: err(where, "bad UDP checksum")
        if struct.unpack("!H", body[4:6])[0] != len(body): err(where, "bad UDP length")
    elif proto == 1:
        stats["icmp"] += 1
        if csum(body) != 0: err(where, "bad ICMP checksum")
        if body[0] in (3, 11):
            inner = body[8:]
            if len(inner) != 28: err(where, f"ICMP error should quote 28 bytes, got {len(inner)}")
            if csum(inner[:20]) != 0: err(where, "bad quoted IP checksum")
    else:
        err(where, f"unknown IP proto {proto}")

def parse(b):
    t = struct.unpack("!H", b[12:14])[0]
    if t == 0x0806:
        stats["arp"] += 1
        if len(b) != 42: err("arp", f"bad ARP length {len(b)}")
        return None
    if t != 0x0800:
        return None
    return b[14:]

def check_fields(where, link, size):
    """字段必须首尾相接地铺满整个包，否则界面上会有“说不出来历”的字节"""
    pos = 0
    for l in link["layers"]:
        for label, off, ln in l["fields"]:
            if off != pos:
                err(where, f"field gap/overlap at {label}: {off} != {pos}")
            pos = off + ln
    if pos != size:
        err(where, f"fields cover {pos} of {size} bytes")

def check_hops(where, f):
    """路由器必须把 TTL 减 1；跨过 NAT 时才允许改地址；其他 IP 字段不变"""
    views = [bytes.fromhex(l["hex"]) for l in f["links"]]
    for i in range(1, len(views)):
        a, b = views[i - 1], views[i]
        if len(a) != len(b):
            err(where, f"length changes across link {i}")
            continue
        node = f["path"][i]
        if struct.unpack("!H", a[12:14])[0] != 0x0800:
            if a != b: err(where, f"ARP frame changed at {node}")
            continue
        if node == "switch":
            if a != b: err(where, "switch modified the frame")
            continue
        ia, ib = a[14:], b[14:]
        if ib[8] != ia[8] - 1: err(where, f"TTL {ia[8]} -> {ib[8]} at {node}")
        if a[0:12] == b[0:12]: err(where, f"MACs unchanged after router {node}")
        if ia[4:6] != ib[4:6]: err(where, "IP id changed")
        if node != "router" and (ia[12:20] != ib[12:20]):
            err(where, f"addresses changed at non-NAT {node}")

def check_tcp_stream(key, frames):
    """按相对序号回放：序号和确认号必须合乎 TCP 逻辑"""
    nxt = {}
    for f in frames:
        b = parse(bytes.fromhex(f["links"][f["capture"]]["hex"]))
        if b is None or b[9] != 6:
            continue
        ihl = (b[0] & 15) * 4
        t = b[ihl:]
        seq, ack = struct.unpack("!II", t[4:12])
        flags = t[13]
        side = f["path"][0]
        plen = len(t) - (t[12] >> 4) * 4
        if flags & 2 and not flags & 16:  # SYN
            pass
        elif side in nxt and seq != nxt[side] and not f["label"].startswith(("重传", "SYN")) and not flags & 4:
            err(f"{key}#{f['n']+1}", f"unexpected seq from {side}")
        end = seq + plen + (1 if flags & 3 else 0)
        nxt[side] = max(nxt.get(side, 0), end) & 0xFFFFFFFF
        peer = [k for k in nxt if k != side]
        if flags & 16 and peer and ack > nxt[peer[0]]:
            err(f"{key}#{f['n']+1}", f"ack beyond what peer sent")

def check_quotes(key, frames):
    """ICMP 差错引用的必须真的是上一个包：IP 标识和目的地址都要对得上"""
    for prev, f in zip(frames, frames[1:]):
        b = parse(bytes.fromhex(f["links"][f["capture"]]["hex"]))
        if b is None or b[9] != 1 or b[20] not in (3, 11):
            continue
        q = b[28:]
        orig = parse(bytes.fromhex(prev["links"][prev["capture"]]["hex"]))
        if q[4:6] != orig[4:6]:
            err(f"{key}#{f['n']+1}", "quoted IP id differs from original packet")
        if q[16:20] != orig[16:20]:
            err(f"{key}#{f['n']+1}", "quoted destination differs from original packet")
        if q[12:16] != orig[12:16]:
            err(f"{key}#{f['n']+1}", "quoted source differs from original packet")

def tcpdump(data):
    """把页面导出的 pcap 交给 tcpdump 这个第三方解码器挑错"""
    tool = shutil.which("tcpdump")
    if not tool:
        print("tcpdump 未安装，跳过第三方解码")
        return
    total = 0
    with tempfile.TemporaryDirectory() as d:
        for sc in data:
            path = os.path.join(d, "s.pcap")
            with open(path, "wb") as fh:
                fh.write(bytes.fromhex(sc["pcap"]))  # 用户点“.pcap”按钮下载到的就是这份
            r = subprocess.run([tool, "-r", path, "-nn", "-vv", "-e", "-S"], capture_output=True, text=True)
            lines = r.stdout
            packets = len(re.findall(r"^\d\d:\d\d:\d\d", lines, re.M))
            total += packets
            if packets != len(sc["frames"]):
                err(sc["key"], f"tcpdump read {packets} of {len(sc['frames'])}: {r.stderr[:120]}")
            for bad in re.findall(r".*(?:incorrect|bad cksum|bad udp cksum|bad tcp cksum|\[\|\w*\]|malformed|invalid).*", lines):
                err(sc["key"], "tcpdump: " + bad.strip()[:150])
            if os.environ.get("SHOW"):
                print(f"--- {sc['key']}\n{lines}")
    print(f"tcpdump 解码 {total} 个包")

def main():
    data = dump()
    for sc in data:
        key = sc["key"]
        stats["scenarios"] += 1
        if sc["emptySteps"]: err(key, f"steps with no packets: {sc['emptySteps']}")
        if not sc["outro"]: err(key, "missing outro")
        if not sc["frames"]: err(key, "no frames")
        last = -1
        for f in sc["frames"]:
            stats["frames"] += 1
            where = f"{key}#{f['n']+1}"
            if not f["caption"]: err(where, "missing caption")
            if f["time"] < last: err(where, f"time goes backwards {f['time']} < {last}")
            last = f["time"]
            for n in f["usedNodes"]:
                if n not in sc["positions"]: err(where, f"node {n} has no position")
            for i, link in enumerate(f["links"]):
                stats["views"] += 1
                b = bytes.fromhex(link["hex"])
                check_fields(f"{where}@{i}", link, len(b))
                ip = parse(b)
                if ip is not None:
                    check_ip(f"{where}@{i}", ip)
            check_hops(where, f)
        check_tcp_stream(key, sc["frames"])
        check_quotes(key, sc["frames"])
    tcpdump(data)
    print(stats)
    if errors:
        print(f"\n{len(errors)} 个问题：")
        for e in errors[:60]:
            print(" ✗", e)
        sys.exit(1)
    print("全部通过 ✓")

if __name__ == "__main__":
    main()
