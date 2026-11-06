package main

import (
	"bufio"
	"context"
	"crypto/subtle"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httputil"
	"net/netip"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const proxyPathPrefix = "/_jagentchill/tailnet/"
const proxySecretHeader = "X-JAgentChill-Tailnet-Proxy"
const proxyProtocolPrefix = "jagentchill.proxy."

type tailnetDial func(context.Context, string) (net.Conn, error)
type targetContextKey struct{}

func startOutboundProxy(secret string, dial tailnetDial) (net.Listener, error) {
	if len(secret) < 32 {
		return nil, fmt.Errorf("tailnet proxy secret must contain at least 32 characters")
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, fmt.Errorf("tailnet proxy listen: %w", err)
	}
	transport := &http.Transport{
		DialContext: func(ctx context.Context, network, _ string) (net.Conn, error) {
			target, ok := ctx.Value(targetContextKey{}).(string)
			if !ok || !tailnetAddress(target) {
				return nil, fmt.Errorf("refusing non-tailnet target")
			}
			return dial(ctx, target)
		},
		ForceAttemptHTTP2:     false,
		ResponseHeaderTimeout: 15 * time.Second,
	}
	proxy := &httputil.ReverseProxy{
		Transport: transport,
		Director: func(request *http.Request) {
			target := request.Context().Value(targetContextKey{}).(string)
			path := request.URL.Path
			request.URL.Scheme = "http"
			request.URL.Host = target
			request.URL.Path = strings.TrimPrefix(path, proxyPathPrefix+url.PathEscape(target))
			request.URL.RawPath = ""
			request.Host = target
			request.Header.Del(proxySecretHeader)
			request.Header.Del("X-Forwarded-Host")
			protocols := make([]string, 0, 2)
			for _, value := range strings.Split(request.Header.Get("Sec-WebSocket-Protocol"), ",") {
				value = strings.TrimSpace(value)
				if value != "" && !strings.HasPrefix(value, proxyProtocolPrefix) {
					protocols = append(protocols, value)
				}
			}
			if len(protocols) == 0 {
				request.Header.Del("Sec-WebSocket-Protocol")
			} else {
				request.Header.Set("Sec-WebSocket-Protocol", strings.Join(protocols, ", "))
			}
		},
		ErrorHandler: func(writer http.ResponseWriter, _ *http.Request, _ error) {
			http.Error(writer, "tailnet host unavailable", http.StatusBadGateway)
		},
	}
	server := &http.Server{
		Handler: http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
			if !loopbackRemote(request.RemoteAddr) || request.URL == nil {
				http.Error(writer, "forbidden", http.StatusForbidden)
				return
			}
			target, rest, ok := proxyTarget(request.URL.EscapedPath())
			if !ok || !tailnetAddress(target) {
				http.Error(writer, "tailnet targets only", http.StatusForbidden)
				return
			}
			if !proxyAuthorized(request, secret) {
				http.Error(writer, "forbidden", http.StatusForbidden)
				return
			}
			if request.Header.Get("Upgrade") != "websocket" && request.Header.Get("Origin") != "" && request.Header.Get("Origin") != "app://jagentchill" {
				http.Error(writer, "forbidden", http.StatusForbidden)
				return
			}
			request.URL.Path = rest
			request.URL.RawPath = ""
			if request.Header.Get("Upgrade") == "websocket" {
				proxyWebSocket(writer, request, target, secret, dial)
				return
			}
			request = request.WithContext(context.WithValue(request.Context(), targetContextKey{}, target))
			proxy.ServeHTTP(writer, request)
		}),
		ReadHeaderTimeout: 5 * time.Second,
	}
	go func() { _ = server.Serve(listener) }()
	return listener, nil
}

// proxyWebSocket terminates only the local HTTP upgrade. The WebSocket frames remain end-to-end between the
// renderer and the remote JAgentChill host. When the remote host selects no application protocol, select the
// loopback proxy credential offered by the renderer so the browser accepts the authenticated upgrade.
func proxyWebSocket(writer http.ResponseWriter, request *http.Request, target, secret string, dial tailnetDial) {
	upstream, err := dial(request.Context(), target)
	if err != nil {
		http.Error(writer, "tailnet host unavailable", http.StatusBadGateway)
		return
	}
	client, clientRW, err := writer.(http.Hijacker).Hijack()
	if err != nil {
		_ = upstream.Close()
		return
	}
	defer client.Close()
	defer upstream.Close()

	request.URL.Scheme = "http"
	request.URL.Host = target
	request.Host = target
	protocols := make([]string, 0, 2)
	for _, value := range strings.Split(request.Header.Get("Sec-WebSocket-Protocol"), ",") {
		value = strings.TrimSpace(value)
		if value != "" && !strings.HasPrefix(value, proxyProtocolPrefix) {
			protocols = append(protocols, value)
		}
	}
	if len(protocols) == 0 {
		request.Header.Del("Sec-WebSocket-Protocol")
	} else {
		request.Header.Set("Sec-WebSocket-Protocol", strings.Join(protocols, ", "))
	}
	request.Header.Del(proxySecretHeader)
	request.Header.Del("X-Forwarded-Host")
	if err := request.Write(upstream); err != nil {
		return
	}
	upstreamRW := bufio.NewReader(upstream)
	response, err := http.ReadResponse(upstreamRW, request)
	if err != nil {
		_, _ = io.WriteString(clientRW, "HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n")
		_ = clientRW.Flush()
		return
	}
	if response.StatusCode == http.StatusSwitchingProtocols && response.Header.Get("Sec-WebSocket-Protocol") == "" {
		response.Header.Set("Sec-WebSocket-Protocol", proxyProtocolPrefix+secret)
	}
	if err := response.Write(clientRW); err != nil {
		return
	}
	if err := clientRW.Flush(); err != nil {
		return
	}
	if response.StatusCode != http.StatusSwitchingProtocols {
		return
	}
	go func() { _, _ = io.Copy(upstream, clientRW); _ = upstream.Close() }()
	_, _ = io.Copy(client, upstreamRW)
}

func proxyTarget(path string) (target string, rest string, ok bool) {
	if !strings.HasPrefix(path, proxyPathPrefix) {
		return "", "", false
	}
	remaining := strings.TrimPrefix(path, proxyPathPrefix)
	slash := strings.IndexByte(remaining, '/')
	if slash <= 0 || slash == len(remaining)-1 {
		return "", "", false
	}
	decoded, err := url.PathUnescape(remaining[:slash])
	if err != nil {
		return "", "", false
	}
	return decoded, "/" + remaining[slash+1:], true
}

func proxyAuthorized(request *http.Request, secret string) bool {
	if request.Header.Get("Upgrade") == "websocket" {
		for _, value := range strings.Split(request.Header.Get("Sec-WebSocket-Protocol"), ",") {
			value = strings.TrimSpace(value)
			if strings.HasPrefix(value, proxyProtocolPrefix) {
				supplied := strings.TrimPrefix(value, proxyProtocolPrefix)
				if len(supplied) == len(secret) && subtle.ConstantTimeCompare([]byte(supplied), []byte(secret)) == 1 {
					return true
				}
			}
		}
		return false
	}
	supplied := request.Header.Get(proxySecretHeader)
	return len(supplied) == len(secret) && subtle.ConstantTimeCompare([]byte(supplied), []byte(secret)) == 1
}

func loopbackRemote(remote string) bool {
	host, _, err := net.SplitHostPort(remote)
	if err != nil {
		return false
	}
	address, err := netip.ParseAddr(host)
	return err == nil && address.IsLoopback()
}

func tailnetAddress(address string) bool {
	host, rawPort, err := net.SplitHostPort(address)
	if err != nil || host == "" {
		return false
	}
	port, err := strconv.Atoi(rawPort)
	if err != nil || port < 1 || port > 65535 {
		return false
	}
	if parsed, err := netip.ParseAddr(host); err == nil {
		return netip.MustParsePrefix("100.64.0.0/10").Contains(parsed) || netip.MustParsePrefix("fd7a:115c:a1e0::/48").Contains(parsed)
	}
	host = strings.TrimSuffix(strings.ToLower(host), ".")
	return strings.HasSuffix(host, ".ts.net") && len(host) > len(".ts.net")
}
