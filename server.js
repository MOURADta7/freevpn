// ============================================================
// FreeVPN Proxy Server — Node.js
// يدعم: HTTP Proxy + HTTPS CONNECT Tunnel
// نشر: Glitch.com / Render.com / Oracle Cloud (مجاناً)
// ============================================================
const http = require("http");
const net  = require("net");
const url  = require("url");

const PORT = process.env.PORT || 3000;

// Rate limiting
const hits = new Map();
function limited(ip) {
  const k = ip + ":" + Math.floor(Date.now()/60000);
  const n = (hits.get(k)||0) + 1;
  hits.set(k, n);
  return n > 300;
}

const server = http.createServer((req, res) => {
  // Health check
  if (req.url === "/health" || req.url === "/") {
    res.writeHead(200, {"Content-Type":"application/json","Access-Control-Allow-Origin":"*"});
    res.end(JSON.stringify({ status:"ok", uptime: process.uptime() }));
    return;
  }

  const ip = req.socket.remoteAddress;
  if (limited(ip)) { res.writeHead(429); res.end("Rate limited"); return; }

  // HTTP Proxy
  const parsed = url.parse(req.url);
  if (!parsed.hostname) { res.writeHead(400); res.end("Bad Request"); return; }

  const opts = {
    hostname: parsed.hostname,
    port: parsed.port || 80,
    path: parsed.path,
    method: req.method,
    headers: { ...req.headers, host: parsed.hostname }
  };
  delete opts.headers["proxy-connection"];

  const pr = http.request(opts, pres => {
    res.writeHead(pres.statusCode, pres.headers);
    pres.pipe(res);
  });
  pr.on("error", () => { res.writeHead(502); res.end("Bad Gateway"); });
  req.pipe(pr);
});

// HTTPS CONNECT tunnel
server.on("connect", (req, sock, head) => {
  const ip = sock.remoteAddress;
  if (limited(ip)) { sock.write("HTTP/1.1 429 Too Many Requests\r\n\r\n"); sock.destroy(); return; }

  const [host, portStr] = req.url.split(":");
  const port = parseInt(portStr) || 443;

  console.log(`TUNNEL ${ip} → ${host}:${port}`);

  const target = net.connect(port, host, () => {
    sock.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    target.write(head);
    target.pipe(sock);
    sock.pipe(target);
  });

  target.on("error", () => { sock.write("HTTP/1.1 502 Bad Gateway\r\n\r\n"); sock.destroy(); });
  sock.on("error",   () => target.destroy());
  sock.setTimeout(60000, () => { sock.destroy(); target.destroy(); });
});

server.listen(PORT, () => console.log(`✅ FreeVPN Proxy running on port ${PORT}`));
