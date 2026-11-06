package main

import (
	"bufio"
	"context"
	"crypto/sha1"
	"encoding/base64"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

const testProxySecret = "0123456789abcdef0123456789abcdef"

func TestProxyAuthenticatesLoopbackWebSocketAndDialsOnlyTheRequestedTailnetTarget(t *testing.T) {
	remote, upstream := net.Pipe()
	var dialed string
	listener, err := startOutboundProxy(testProxySecret, func(_ context.Context, target string) (net.Conn, error) {
		dialed = target
		return remote, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()

	upstreamDone := make(chan error, 1)
	go func() {
		request, err := http.ReadRequest(bufio.NewReader(upstream))
		if err != nil {
			upstreamDone <- err
			return
		}
		if request.Host != "host.tailnet.ts.net:18957" {
			upstreamDone <- fmt.Errorf("upstream Host = %q", request.Host)
			return
		}
		if request.URL.Path != "/jagentchill/v1/ws" {
			upstreamDone <- fmt.Errorf("upstream path = %q", request.URL.Path)
			return
		}
		if request.Header.Get("Sec-WebSocket-Protocol") != "jagentchill.password.fixture" {
			upstreamDone <- fmt.Errorf("upstream protocols = %q", request.Header.Get("Sec-WebSocket-Protocol"))
			return
		}
		accept := websocketAccept(request.Header.Get("Sec-WebSocket-Key"))
		_, err = fmt.Fprintf(upstream, "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: %s\r\n\r\n", accept)
		if err != nil {
			upstreamDone <- err
			return
		}
		frame := make([]byte, len("client-frame"))
		if _, err = io.ReadFull(upstream, frame); err != nil {
			upstreamDone <- err
			return
		}
		if string(frame) != "client-frame" {
			upstreamDone <- fmt.Errorf("client tunnel data = %q", frame)
			return
		}
		_, err = io.WriteString(upstream, "server-frame")
		upstreamDone <- err
	}()

	client, err := net.Dial("tcp", listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	key := "dGhlIHNhbXBsZSBub25jZQ=="
	_, err = fmt.Fprintf(client, "GET %s HTTP/1.1\r\nHost: 127.0.0.1\r\nOrigin: app://jagentchill\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Key: %s\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Protocol: %s, jagentchill.password.fixture\r\n\r\n", proxyPathPrefix+"host.tailnet.ts.net%3A18957/jagentchill/v1/ws", key, proxyProtocolPrefix+testProxySecret)
	if err != nil {
		t.Fatal(err)
	}
	response, err := http.ReadResponse(bufio.NewReader(client), &http.Request{Method: "GET"})
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusSwitchingProtocols {
		t.Fatalf("status = %d", response.StatusCode)
	}
	if got := response.Header.Get("Sec-WebSocket-Protocol"); got != proxyProtocolPrefix+testProxySecret {
		t.Fatalf("client protocol = %q", got)
	}
	if dialed != "host.tailnet.ts.net:18957" {
		t.Fatalf("dial target = %q", dialed)
	}
	if _, err := io.WriteString(client, "client-frame"); err != nil {
		t.Fatal(err)
	}
	_ = client.SetReadDeadline(time.Now().Add(time.Second))
	frame := make([]byte, len("server-frame"))
	if _, err := io.ReadFull(client, frame); err != nil {
		t.Fatal(err)
	}
	if string(frame) != "server-frame" {
		t.Fatalf("server tunnel data = %q", frame)
	}
	if err := <-upstreamDone; err != nil {
		t.Fatal(err)
	}
}

func TestProxyRefusesMissingSecretAndNonTailnetTargetsWithoutDialing(t *testing.T) {
	dials := 0
	listener, err := startOutboundProxy(testProxySecret, func(context.Context, string) (net.Conn, error) {
		dials++
		return nil, fmt.Errorf("unexpected dial")
	})
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()

	for _, test := range []struct{ path, header string }{
		{path: proxyPathPrefix + "host.tailnet.ts.net%3A18957/jagentchill/v1/pair/challenge"},
		{path: proxyPathPrefix + "example.com%3A80/jagentchill/v1/pair/challenge", header: testProxySecret},
	} {
		request, _ := http.NewRequest(http.MethodPost, "http://"+listener.Addr().String()+test.path, strings.NewReader("{}"))
		request.Header.Set("Origin", "app://jagentchill")
		if test.header != "" {
			request.Header.Set(proxySecretHeader, test.header)
		}
		response, err := http.DefaultClient.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		_ = response.Body.Close()
		if response.StatusCode != http.StatusForbidden {
			t.Fatalf("status for %q = %d", test.path, response.StatusCode)
		}
	}
	if dials != 0 {
		t.Fatalf("dial count = %d", dials)
	}
	if _, err := startOutboundProxy("short", func(context.Context, string) (net.Conn, error) { return nil, nil }); err == nil {
		t.Fatal("short secret was accepted")
	}
}

func TestProxyRelaysAuthenticatedPairingHTTPOverLoopbackOnly(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Host != "remote.tailnet.ts.net:18957" || request.URL.Path != "/jagentchill/v1/pair/challenge" {
			t.Errorf("upstream request = %s %s", request.Host, request.URL.Path)
		}
		if request.Header.Get(proxySecretHeader) != "" {
			t.Error("proxy credential leaked to the tailnet host")
		}
		writer.Header().Set("content-type", "application/json")
		_, _ = writer.Write([]byte(`{"challenge":"fixture"}`))
	}))
	defer upstream.Close()
	listener, err := startOutboundProxy(testProxySecret, func(_ context.Context, target string) (net.Conn, error) {
		if target != "remote.tailnet.ts.net:18957" {
			return nil, fmt.Errorf("unexpected tailnet target: %s", target)
		}
		return net.Dial("tcp", strings.TrimPrefix(upstream.URL, "http://"))
	})
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()

	url := "http://" + listener.Addr().String() + proxyPathPrefix + "remote.tailnet.ts.net%3A18957/jagentchill/v1/pair/challenge"
	request, _ := http.NewRequest(http.MethodPost, url, strings.NewReader(`{"device":"fixture"}`))
	request.Header.Set(proxySecretHeader, testProxySecret)
	request.Header.Set("Origin", "app://jagentchill")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", response.StatusCode)
	}
	body, err := io.ReadAll(response.Body)
	if err != nil || string(body) != `{"challenge":"fixture"}` {
		t.Fatalf("body = %q, err = %v", body, err)
	}
}

func websocketAccept(key string) string {
	sum := sha1.Sum([]byte(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"))
	return base64.StdEncoding.EncodeToString(sum[:])
}
