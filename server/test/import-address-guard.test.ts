// The guard that keeps a URL import away from this machine and its networks (server-side request forgery): an address
// is turned into BYTES and the bytes are judged, so every way of writing a refused address is refused. The table below
// writes each refused range in its equivalent spellings; `net.BlockList` (Node's own byte-level matcher) is used as a
// second opinion on every row. No network is touched: the resolver of `vetAddress` is a function of this file.
import assert from "node:assert/strict";
import { BlockList, isIP } from "node:net";
import { test } from "node:test";
import { addressBytes, canonicalAddress, importUrl, isBlockedAddress, vetAddress, type ImportNet } from "../src/tools/import.ts";
import { ToolFailure } from "../src/tools/kit.ts";

const hex = (value: number) => value.toString(16);
/** Every spelling of one IPv6 address this file can think of, from its eight groups. */
function spellings6(groups: number[]): string[] {
  const full = groups.map(hex).join(":"), padded = groups.map((group) => hex(group).padStart(4, "0")).join(":");
  const out = new Set<string>([full, padded, full.toUpperCase(), padded.toUpperCase()]);
  // `::` over every run of zero groups, including runs of one and runs that are not the longest.
  for (let from = 0; from < 8; from++) for (let to = from + 1; to <= 8; to++) {
    if (groups.slice(from, to).some((group) => group !== 0)) continue;
    for (const pad of [false, true]) {
      const write = (group: number) => (pad ? hex(group).padStart(4, "0") : hex(group));
      const text = `${groups.slice(0, from).map(write).join(":")}::${groups.slice(to).map(write).join(":")}`;
      out.add(text); out.add(text.toUpperCase());
    }
  }
  // The dotted tail, on every form made so far.
  const tail = `${groups[6] >> 8}.${groups[6] & 255}.${groups[7] >> 8}.${groups[7] & 255}`;
  for (const pad of [false, true]) {
    const write = (group: number) => (pad ? hex(group).padStart(4, "0") : hex(group));
    out.add(`${groups.slice(0, 6).map(write).join(":")}:${tail}`);
    for (let from = 0; from < 6; from++) for (let to = from + 1; to <= 6; to++) {
      if (groups.slice(from, to).some((group) => group !== 0)) continue;
      const rest = groups.slice(to, 6).map(write).join(":");
      const text = `${groups.slice(0, from).map(write).join(":")}::${rest}${rest ? ":" : ""}${tail}`;
      out.add(text); out.add(text.toUpperCase());
    }
  }
  return [...out];
}
const groupsOf = (text: string): number[] => { const bytes = addressBytes(text)!; assert.equal(bytes.length, 16, text); return Array.from({ length: 8 }, (_, index) => (bytes[index * 2] << 8) | bytes[index * 2 + 1]); };
const v4 = (text: string) => text.split(".").map(Number);
/** The IPv6 forms that carry an IPv4 address: mapped, compatible (deprecated), translated (SIIT), NAT64, local NAT64, 6to4, Teredo. */
const carriers = (text: string): [string, number[]][] => {
  const [a, b, c, d] = v4(text), high = (a << 8) | b, low = (c << 8) | d;
  return [
    ["mapped ::ffff:0:0/96", [0, 0, 0, 0, 0, 0xffff, high, low]], ["compatible ::/96", [0, 0, 0, 0, 0, 0, high, low]], ["translated ::ffff:0:0:0/96", [0, 0, 0, 0, 0xffff, 0, high, low]],
    ["NAT64 64:ff9b::/96", [0x64, 0xff9b, 0, 0, 0, 0, high, low]], ["local NAT64 64:ff9b:1::/48", [0x64, 0xff9b, 1, 0, 0, 0, high, low]],
    ["6to4 2002::/16", [0x2002, high, low, 0, 0, 0, 0, 1]], ["Teredo 2001::/32", [0x2001, 0, high, low, 0, 0, high ^ 0xffff, low ^ 0xffff]],
  ];
};

// Each refused IPv4 range with its first address, its last, and one inside.
const REFUSED_V4: [string, string, string[]][] = [
  ["unspecified / this network 0.0.0.0/8", "0.0.0.0/8", ["0.0.0.0", "0.1.2.3", "0.255.255.255"]],
  ["private 10.0.0.0/8", "10.0.0.0/8", ["10.0.0.0", "10.1.2.3", "10.255.255.255"]],
  ["carrier NAT 100.64.0.0/10", "100.64.0.0/10", ["100.64.0.0", "100.100.1.1", "100.127.255.255"]],
  ["loopback 127.0.0.0/8", "127.0.0.0/8", ["127.0.0.0", "127.0.0.1", "127.1.2.3", "127.255.255.255"]],
  ["link-local 169.254.0.0/16 (cloud metadata)", "169.254.0.0/16", ["169.254.0.0", "169.254.169.254", "169.254.255.255"]],
  ["private 172.16.0.0/12", "172.16.0.0/12", ["172.16.0.0", "172.20.0.1", "172.31.255.255"]],
  ["protocol assignments 192.0.0.0/24", "192.0.0.0/24", ["192.0.0.0", "192.0.0.8", "192.0.0.255"]],
  ["documentation 192.0.2.0/24", "192.0.2.0/24", ["192.0.2.0", "192.0.2.55", "192.0.2.255"]],
  ["6to4 relay 192.88.99.0/24", "192.88.99.0/24", ["192.88.99.0", "192.88.99.1", "192.88.99.255"]],
  ["private 192.168.0.0/16", "192.168.0.0/16", ["192.168.0.0", "192.168.1.10", "192.168.255.255"]],
  ["benchmarking 198.18.0.0/15", "198.18.0.0/15", ["198.18.0.0", "198.19.3.4", "198.19.255.255"]],
  ["documentation 198.51.100.0/24", "198.51.100.0/24", ["198.51.100.0", "198.51.100.9", "198.51.100.255"]],
  ["documentation 203.0.113.0/24", "203.0.113.0/24", ["203.0.113.0", "203.0.113.7", "203.0.113.255"]],
  ["multicast 224.0.0.0/4", "224.0.0.0/4", ["224.0.0.0", "224.0.0.251", "239.255.255.255"]],
  ["reserved 240.0.0.0/4 and broadcast", "240.0.0.0/4", ["240.0.0.0", "250.1.2.3", "255.255.255.255"]],
];
// Each refused IPv6 range likewise.
const REFUSED_V6: [string, string, string[]][] = [
  ["unspecified ::", "::/128", ["::"]],
  ["loopback ::1", "::1/128", ["::1"]],
  ["rest of ::/8 (reserved)", "::/8", ["::2", "0:0:0:1::", "00ff:ffff::1"]],
  ["NAT64 64:ff9b::/96 with a public address inside", "64:ff9b::/96", ["64:ff9b::808:808", "64:ff9b::5db8:d822"]],
  ["local NAT64 64:ff9b:1::/48", "64:ff9b:1::/48", ["64:ff9b:1::1", "64:ff9b:1:ffff:ffff:ffff:808:808"]],
  ["discard 100::/64", "100::/64", ["100::", "100::1", "100::ffff:ffff:ffff:ffff"]],
  ["protocol assignments 2001::/23 with Teredo", "2001::/23", ["2001::", "2001::1", "2001:0:4136:e378:8000:63bf:3fff:fdd2", "2001:1ff:ffff::1", "2001:20::1"]],
  ["documentation 2001:db8::/32", "2001:db8::/32", ["2001:db8::", "2001:db8::1", "2001:db8:ffff:ffff:ffff:ffff:ffff:ffff"]],
  ["6to4 2002::/16", "2002::/16", ["2002::", "2002:808:808::1", "2002:ffff:ffff:ffff:ffff:ffff:ffff:ffff"]],
  ["documentation 3fff::/20", "3fff::/20", ["3fff::", "3fff:abc::1", "3fff:fff:ffff::1"]],
  ["above global unicast 4000::/2 … (unassigned)", "4000::/2", ["4000::1", "5f00::1", "7fff::1"]],
  ["unassigned 8000::/1 below unique local", "8000::/2", ["8000::1", "a000::1", "bfff::1"]],
  ["unassigned c000::/3, e000::/4, f000::/5, f800::/6", "c000::/3", ["c000::1", "dfff::1"]],
  ["unique local fc00::/7", "fc00::/7", ["fc00::", "fc00::1", "fd00::1", "fd12:3456:789a::1", "fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff"]],
  ["link-local fe80::/10", "fe80::/10", ["fe80::", "fe80::1", "fe9a::1", "febf:ffff::1"]],
  ["site-local fec0::/10 (deprecated)", "fec0::/10", ["fec0::", "fec0::1", "feff::1"]],
  ["multicast ff00::/8", "ff00::/8", ["ff00::", "ff02::1", "ff05::1:3", "ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff"]],
];
const PUBLIC = ["1.1.1.1", "8.8.8.8", "93.184.216.34", "100.63.255.255", "100.128.0.0", "126.255.255.255", "128.0.0.1", "169.253.255.255", "169.255.0.0", "172.15.255.255", "172.32.0.0", "192.0.1.1", "192.0.3.0", "192.0.77.2", "192.167.255.255", "192.169.0.0", "198.17.255.255", "198.20.0.0", "223.255.255.255",
  "2606:2800:220:1::1", "2a00:1450:4001:81b::200e", "2001:200::1", "2001:4860:4860::8888", "2003::1", "3ffe::1", "2000::1"];

// Node's own matcher, told the same ranges: a second opinion on the bytes of every row.
// Two lists, because Node's matcher reads an IPv4 address as its mapped IPv6 form too (it would find 1.1.1.1 in ::/8).
const oracle4 = new BlockList(), oracle = new BlockList();
for (const [, cidr] of REFUSED_V4) { const [net, bits] = cidr.split("/"); oracle4.addSubnet(net, Number(bits), "ipv4"); }
for (const [, cidr] of REFUSED_V6) { const [net, bits] = cidr.split("/"); oracle.addSubnet(net, Number(bits), "ipv6"); }
for (const cidr of ["8000::/1", "e000::/4", "f000::/5", "f800::/6", "::ffff:0:0:0/96"]) { const [net, bits] = cidr.split("/"); oracle.addSubnet(net, Number(bits), "ipv6"); }

test("URL import guard: every refused IPv4 range is refused at its first, last and an inner address, and Node's matcher agrees", () => {
  for (const [range, , addresses] of REFUSED_V4) for (const address of addresses) {
    assert.equal(isBlockedAddress(address), true, `${range}: ${address}`);
    assert.equal(oracle4.check(address, "ipv4"), true, `oracle ${address}`);
  }
});

test("URL import guard: a refused IPv4 address is refused in every IPv6 form that carries it — mapped, compatible, translated, NAT64, 6to4, Teredo — in every spelling (expanded, zero-padded, upper case, `::` anywhere, dotted tail)", () => {
  let rows = 0;
  for (const [range, , addresses] of REFUSED_V4) for (const address of addresses) for (const [form, groups] of carriers(address)) for (const text of spellings6(groups)) {
    assert.equal(isBlockedAddress(text), true, `${range}: ${address} as ${form}: ${text}`);
    rows++;
  }
  assert.ok(rows > 5000, `rows ${rows}`);
  // The reviewer's reproductions, spelled out.
  for (const text of ["0:0:0:0:0:0:0:1", "0000:0000:0000:0000:0000:0000:0000:0001", "0:0:0:0:0:ffff:7f00:1", "0:0:0:0:0:FFFF:7F00:0001", "::ffff:7f00:1", "0::ffff:127.0.0.1", "0:0:0:0:0:ffff:127.0.0.1", "::FFFF:10.0.0.1", "0:0::ffff:a9fe:a9fe", "::ffff:0a00:0001", "::0:ffff:c0a8:10a", "0:0:0:0:0:0:127.0.0.1", "::127.0.0.1", "::7f00:1"])
    assert.equal(isBlockedAddress(text), true, text);
});

test("URL import guard: every refused IPv6 range is refused in every spelling of its addresses, and Node's matcher agrees", () => {
  for (const [range, , addresses] of REFUSED_V6) for (const address of addresses) {
    assert.equal(oracle.check(address, "ipv6"), true, `oracle ${range}: ${address}`);
    for (const text of spellings6(groupsOf(address))) {
      assert.equal(isIP(text), 6, `the spelling is one Node takes as IPv6: ${text}`);
      assert.equal(isBlockedAddress(text), true, `${range}: ${text}`);
    }
  }
});

test("URL import guard: public addresses pass in every spelling, also carried as IPv4-mapped, and are connected to in one canonical spelling", () => {
  for (const address of PUBLIC) {
    assert.equal(isBlockedAddress(address), false, address);
    assert.equal(isIP(address) === 4 ? oracle4.check(address, "ipv4") : oracle.check(address, "ipv6"), false, `oracle ${address}`);
    if (isIP(address) === 4) {
      const [a, b, c, d] = v4(address);
      for (const text of spellings6([0, 0, 0, 0, 0, 0xffff, (a << 8) | b, (c << 8) | d])) {
        assert.equal(isBlockedAddress(text), false, text);
        assert.equal(canonicalAddress(text), address, text);
      }
    } else {
      const canonical = canonicalAddress(address);
      for (const text of spellings6(groupsOf(address))) { assert.equal(isBlockedAddress(text), false, text); assert.equal(canonicalAddress(text), canonical, text); }
    }
  }
});

test("URL import guard: text that is not exactly one address is refused — zone ids, octal / hex / short IPv4 forms, brackets, ports, blanks, wrong group counts", () => {
  for (const text of ["", " ", "localhost", "fe80::1%lo0", "::1%lo0", "2606:2800:220:1::1%en0", "8.8.8.8%1", "0177.0.0.1", "127.0.0.01", "010.0.0.1", "0x7f.0.0.1", "0x7f000001", "2130706433", "127.1", "127.0.1", "1.2.3.4.5", "1.2.3.256", "1.2.3.-4", "1.2.3.4 ", " 1.2.3.4", "1.2.3.4:443", "[::1]", "[2606:2800:220:1::1]",
    "::1::", ":::1", "1:2:3:4:5:6:7", "1:2:3:4:5:6:7:8:9", "1:2:3:4:5:6:7::8", "::12345", "::g", "1.2.3.4::", "::1.2.3.4:5", "::ffff:1.2.3", "::ffff:0127.0.0.1", "::ffff:1.2.3.4.5", ":", "::ffff:8.8.8.8/96", "８.８.８.８", "1.2.3.4\n", "\t::1"]) {
    assert.equal(addressBytes(text), null, JSON.stringify(text));
    assert.equal(isBlockedAddress(text), true, JSON.stringify(text));
  }
});

const refusal = async (promise: Promise<unknown>): Promise<string> => {
  try { await promise; } catch (error) { assert.ok(error instanceof ToolFailure, String(error)); return error.code; }
  return "accepted";
};
const never: ImportNet = { resolve: async (host) => { throw new Error(`looked up ${host}`); }, download: async () => { throw new Error("downloaded"); } };

test("URL import guard: a URL whose host is a refused address is refused however the URL writes it, without a lookup and without a request", async () => {
  const hosts = ["127.0.0.1", "127.1", "2130706433", "0x7f000001", "0x7f.0.0.1", "0177.0.0.1", "017700000001", "127.0.0.1.", "0", "0.0.0.0", "10.0.0.1", "169.254.169.254", "0xa9fea9fe", "192.168.1.1", "100.64.0.1", "224.0.0.1", "255.255.255.255",
    "[::1]", "[0:0:0:0:0:0:0:1]", "[0000:0000:0000:0000:0000:0000:0000:0001]", "[::]", "[0:0:0:0:0:ffff:7f00:1]", "[0:0:0:0:0:FFFF:7F00:1]", "[::ffff:127.0.0.1]", "[::ffff:7f00:1]", "[::ffff:a00:1]", "[::ffff:169.254.169.254]", "[::127.0.0.1]", "[64:ff9b::7f00:1]", "[64:ff9b::808:808]",
    "[fc00::1]", "[FD00::1]", "[fe80::1]", "[FE80:0:0:0:0:0:0:1]", "[fec0::1]", "[ff02::1]", "[2002:7f00:1::1]", "[2001:db8::1]", "[2001::1]", "[100::1]",
    "localhost", "LOCALHOST", "localhost.", "a.localhost", "printer.local", "db.internal", "DB.Internal."];
  for (const host of hosts) assert.equal(await refusal(vetAddress(never, importUrl(`https://${host}/a.jpg`))), "EGRESS_BLOCKED", host);
  // A zone id cannot be written in a URL at all.
  assert.equal(await refusal((async () => vetAddress(never, importUrl("https://[fe80::1%25lo0]/a.jpg")))()), "INVALID_PARAMS");
});

test("URL import guard: a name is refused when ANY address it resolves to is refused in any spelling; a public one is connected to by its judged bytes", async () => {
  const answering = (addresses: string[]): ImportNet => ({ resolve: async () => addresses, download: async () => { throw new Error("downloaded"); } });
  const url = importUrl("https://pictures.example/a.jpg");
  for (const addresses of [["0:0:0:0:0:ffff:7f00:1"], ["0:0:0:0:0:0:0:1"], ["93.184.216.34", "0:0:0:0:0:FFFF:0A00:0001"], ["2606:2800:220:1::1", "FE80:0000:0000:0000:0000:0000:0000:0001"], ["fe80::1%en0"], ["0177.0.0.1"], ["93.184.216.34", "not an address"], ["64:ff9b::a9fe:a9fe"]])
    assert.equal(await refusal(vetAddress(answering(addresses), url)), "EGRESS_BLOCKED", addresses.join(" + "));
  assert.equal(await vetAddress(answering(["93.184.216.34"]), url), "93.184.216.34");
  assert.equal(await vetAddress(answering(["0:0:0:0:0:FFFF:5DB8:D822"]), url), "93.184.216.34");
  assert.equal(await vetAddress(answering(["2606:2800:0220:0001:0000:0000:0000:0001"]), url), "2606:2800:220:1:0:0:0:1");
  assert.equal(await vetAddress(never, importUrl("https://[2606:2800:220:1::1]/a.jpg")), "2606:2800:220:1:0:0:0:1");
  assert.equal(await vetAddress(never, importUrl("https://93.184.216.34/a.jpg")), "93.184.216.34");
});
