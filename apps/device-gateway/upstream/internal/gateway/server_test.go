package gateway

import (
	"bufio"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

func TestJWTConnectionDoesNotRequireUserIDQuery(t *testing.T) {
	srv, privateKey := newTestServer(t)
	httpServer := httptest.NewServer(srv.Routes())
	defer httpServer.Close()

	conn, reader := dialTestWebSocket(t, httpServer.URL, url.Values{
		"connectionId": {"conn-1"},
		"deviceId":     {"device-1"},
	})
	defer conn.Close()

	if count := srv.hub("user-1").deviceCount(); count != 0 {
		t.Fatalf("unauthenticated connection was visible: %d", count)
	}
	writeTestJSON(t, conn, authMessage{Token: signTestJWT(t, privateKey, "user-1"), Type: "auth"})

	var success authSuccessMessage
	readTestJSON(t, reader, &success)
	if success.Type != "auth_success" || success.UserID != "user-1" {
		t.Fatalf("unexpected auth response: %#v", success)
	}
	if count := srv.hub("user-1").deviceCount(); count != 1 {
		t.Fatalf("authenticated connection count = %d, want 1", count)
	}
}

func TestAuthenticationPublishesExecutionContextCapability(t *testing.T) {
	srv, privateKey := newTestServer(t)
	httpServer := httptest.NewServer(srv.Routes())
	defer httpServer.Close()

	conn, reader := dialTestWebSocket(t, httpServer.URL, url.Values{
		"connectionId": {"capable-connection"},
		"deviceId":     {"capable-device"},
	})
	defer conn.Close()
	writeTestJSON(t, conn, authMessage{
		Capabilities: DeviceCapabilities{
			ExecutionContextValidation: true,
			LocalSystemAPIVersions: map[string]int{
				"createPresentation": 1,
				"validatePresentation": 1,
			},
		},
		ProtocolVersion: 2,
		Token:           signTestJWT(t, privateKey, "capability-user"),
		Type:            "auth",
	})

	var success authSuccessMessage
	readTestJSON(t, reader, &success)
	devices := srv.hub("capability-user").devices()
	if len(devices) != 1 || len(devices[0].Channels) != 1 {
		t.Fatalf("unexpected device capability inventory: %#v", devices)
	}
	channel := devices[0].Channels[0]
	if channel.ProtocolVersion != 2 || !channel.Capabilities.ExecutionContextValidation {
		t.Fatalf("capability envelope was lost: %#v", channel)
	}
	if channel.Capabilities.LocalSystemAPIVersions["createPresentation"] != 1 ||
		channel.Capabilities.LocalSystemAPIVersions["validatePresentation"] != 1 {
		t.Fatalf("local system API versions were lost: %#v", channel.Capabilities)
	}
}

func TestExecutionContextValidationNegotiatesLegacyAndHard(t *testing.T) {
	context := json.RawMessage(`{"cwd":"/workspace"}`)
	localTool := json.RawMessage(`{"apiName":"readFile","identifier":"lobe-local-system","type":"tool"}`)
	missingTypeTool := json.RawMessage(`{"apiName":"readFile","identifier":"lobe-local-system"}`)
	mcpTool := json.RawMessage(`{"apiName":"readFile","identifier":"filesystem-mcp","type":"mcp"}`)
	legacy := &connection{att: DeviceAttachment{}}
	capable := &connection{att: DeviceAttachment{
		Capabilities:    DeviceCapabilities{ExecutionContextValidation: true},
		ProtocolVersion: 2,
	}}
	unknownProtocol := &connection{att: DeviceAttachment{
		Capabilities:    DeviceCapabilities{ExecutionContextValidation: true},
		ProtocolVersion: 99,
	}}

	if got := executionContextValidation(legacy, deviceHTTPBody{ExecutionContext: context, ToolCall: localTool}); got != "legacy" {
		t.Fatalf("legacy device reported %q", got)
	}
	if got := executionContextValidation(capable, deviceHTTPBody{ExecutionContext: context, ToolCall: localTool}); got != "hard" {
		t.Fatalf("capable device reported %q", got)
	}
	if got := executionContextValidation(unknownProtocol, deviceHTTPBody{ExecutionContext: context, ToolCall: localTool}); got != "legacy" {
		t.Fatalf("unknown protocol reported %q", got)
	}
	if got := executionContextValidation(capable, deviceHTTPBody{ExecutionContext: context, ToolCall: mcpTool}); got != "legacy" {
		t.Fatalf("MCP call reported %q", got)
	}
	if got := executionContextValidation(capable, deviceHTTPBody{ExecutionContext: context, ToolCall: missingTypeTool}); got != "legacy" {
		t.Fatalf("missing tool type reported %q", got)
	}
	if got := executionContextValidation(capable, deviceHTTPBody{ExecutionContext: context, ToolCall: json.RawMessage(`{`)}); got != "legacy" {
		t.Fatalf("malformed tool call reported %q", got)
	}
	if got := executionContextValidation(capable, deviceHTTPBody{ToolCall: localTool}); got != "" {
		t.Fatalf("context-free call reported %q", got)
	}
}

func TestGatewayValidationMetadataOverridesDeviceClaim(t *testing.T) {
	recorder := httptest.NewRecorder()
	writeMergedResultWithMetadata(
		recorder,
		http.StatusOK,
		true,
		json.RawMessage(`{"content":"ok","executionContextValidation":"hard"}`),
		map[string]any{"executionContextValidation": "legacy"},
	)

	var response map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if response["executionContextValidation"] != "legacy" {
		t.Fatalf("device overrode gateway validation metadata: %#v", response)
	}
}

func TestClaimedUserIDMustMatchVerifiedJWT(t *testing.T) {
	srv, privateKey := newTestServer(t)
	httpServer := httptest.NewServer(srv.Routes())
	defer httpServer.Close()

	conn, reader := dialTestWebSocket(t, httpServer.URL, url.Values{
		"connectionId": {"conn-mismatch"},
		"deviceId":     {"device-mismatch"},
		"userId":       {"claimed-user"},
	})
	defer conn.Close()
	writeTestJSON(t, conn, authMessage{Token: signTestJWT(t, privateKey, "verified-user"), Type: "auth"})

	var failure map[string]string
	readTestJSON(t, reader, &failure)
	if failure["type"] != "auth_failed" || failure["reason"] != "userId mismatch" {
		t.Fatalf("unexpected auth failure: %#v", failure)
	}
	if count := srv.hub("claimed-user").deviceCount(); count != 0 {
		t.Fatalf("mismatched connection joined claimed hub: %d", count)
	}
	if count := srv.hub("verified-user").deviceCount(); count != 0 {
		t.Fatalf("mismatched connection joined verified hub: %d", count)
	}
}

func TestForgedJWTIsRejected(t *testing.T) {
	srv, _ := newTestServer(t)
	rogueKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	httpServer := httptest.NewServer(srv.Routes())
	defer httpServer.Close()

	conn, reader := dialTestWebSocket(t, httpServer.URL, nil)
	defer conn.Close()
	writeTestJSON(t, conn, authMessage{Token: signTestJWT(t, rogueKey, "forged-user"), Type: "auth"})

	var failure map[string]string
	readTestJSON(t, reader, &failure)
	if failure["type"] != "auth_failed" {
		t.Fatalf("forged JWT returned %#v", failure)
	}
	if count := srv.hub("forged-user").deviceCount(); count != 0 {
		t.Fatalf("forged JWT joined a hub: %d", count)
	}
}

func TestAPIKeyConnectionUsesVerifiedUserID(t *testing.T) {
	appServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/users/me" || r.Header.Get("Authorization") != "Bearer api-key" {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"data":    map[string]string{"id": "api-user"},
			"success": true,
		})
	}))
	defer appServer.Close()

	srv, _ := newTestServer(t)
	httpServer := httptest.NewServer(srv.Routes())
	defer httpServer.Close()
	conn, reader := dialTestWebSocket(t, httpServer.URL, nil)
	defer conn.Close()
	writeTestJSON(t, conn, authMessage{
		ServerURL: appServer.URL,
		Token:     "api-key",
		TokenType: "apiKey",
		Type:      "auth",
	})

	var success authSuccessMessage
	readTestJSON(t, reader, &success)
	if success.UserID != "api-user" {
		t.Fatalf("API key authenticated as %q", success.UserID)
	}
}

func TestServiceTokenStillRequiresUserID(t *testing.T) {
	srv, _ := newTestServer(t)
	httpServer := httptest.NewServer(srv.Routes())
	defer httpServer.Close()

	missingConn, missingReader := dialTestWebSocket(t, httpServer.URL, nil)
	writeTestJSON(t, missingConn, authMessage{Token: "service-token", Type: "auth"})
	var failure map[string]string
	readTestJSON(t, missingReader, &failure)
	_ = missingConn.Close()
	if failure["reason"] != "Missing userId" {
		t.Fatalf("service token without userId returned %#v", failure)
	}

	conn, reader := dialTestWebSocket(t, httpServer.URL, url.Values{"userId": {"service-user"}})
	defer conn.Close()
	writeTestJSON(t, conn, authMessage{Token: "service-token", Type: "auth"})
	var success authSuccessMessage
	readTestJSON(t, reader, &success)
	if success.UserID != "service-user" {
		t.Fatalf("service token authenticated as %q", success.UserID)
	}
}

func TestBuildAgentRunRequestForwardsFrozenAuthority(t *testing.T) {
	body := deviceHTTPBody{
		AgentType:        "codex",
		CWD:              "/workspace",
		Env:              map[string]string{"TOKEN": "secret"},
		ExecutionContext: json.RawMessage(`{"cwd":"/workspace","operationId":"op-1"}`),
		ImageList:        json.RawMessage(`[{"url":"https://example.test/image.png"}]`),
		JWT:              "jwt",
		ModelRef:         json.RawMessage(`{"modelId":"gpt","operationId":"op-1"}`),
		OperationID:      "op-1",
		Prompt:           "run",
		SkillPolicy:      "user",
		Skills:           json.RawMessage(`[{"key":"user:test","content":"body"}]`),
		TopicID:          "topic-1",
	}

	payload, err := json.Marshal(buildAgentRunRequest(body))
	if err != nil {
		t.Fatal(err)
	}
	var forwarded map[string]any
	if err := json.Unmarshal(payload, &forwarded); err != nil {
		t.Fatal(err)
	}

	for _, key := range []string{"cwd", "env", "executionContext", "imageList", "modelRef", "skills", "skillPolicy"} {
		if _, ok := forwarded[key]; !ok {
			t.Fatalf("frozen authority field %q was dropped: %#v", key, forwarded)
		}
	}
	executionContext := forwarded["executionContext"].(map[string]any)
	if executionContext["operationId"] != "op-1" {
		t.Fatalf("wrong execution context: %#v", executionContext)
	}
}

func TestBuildToolCallRequestForwardsFrozenAuthority(t *testing.T) {
	body := deviceHTTPBody{
		DeviceID:         "device-1",
		ExecutionContext: json.RawMessage(`{"cwd":"/workspace","operationId":"op-1"}`),
		OperationID:      "op-1",
		ToolCall:         json.RawMessage(`{"apiName":"readFile","arguments":"{}"}`),
		ToolCallID:       "tool-call-1",
		TopicID:          "topic-1",
	}

	payload, err := json.Marshal(buildToolCallRequest(body, "request-1", 30*time.Second))
	if err != nil {
		t.Fatal(err)
	}
	var forwarded map[string]any
	if err := json.Unmarshal(payload, &forwarded); err != nil {
		t.Fatal(err)
	}

	for _, key := range []string{"deviceId", "executionContext", "operationId", "toolCallId", "topicId"} {
		if _, ok := forwarded[key]; !ok {
			t.Fatalf("tool-call authority field %q was dropped: %#v", key, forwarded)
		}
	}
	executionContext := forwarded["executionContext"].(map[string]any)
	if executionContext["operationId"] != "op-1" {
		t.Fatalf("wrong execution context: %#v", executionContext)
	}
}

func TestUnauthenticatedConnectionCannotReplaceAuthenticatedConnection(t *testing.T) {
	srv, privateKey := newTestServer(t)
	httpServer := httptest.NewServer(srv.Routes())
	defer httpServer.Close()

	query := url.Values{
		"connectionId": {"shared-connection"},
		"deviceId":     {"device-1"},
	}
	first, firstReader := dialTestWebSocket(t, httpServer.URL, query)
	defer first.Close()
	writeTestJSON(t, first, authMessage{Token: signTestJWT(t, privateKey, "user-1"), Type: "auth"})
	var success authSuccessMessage
	readTestJSON(t, firstReader, &success)

	second, _ := dialTestWebSocket(t, httpServer.URL, query)
	defer second.Close()
	if count := srv.hub("user-1").deviceCount(); count != 1 {
		t.Fatalf("unauthenticated replacement changed device count: %d", count)
	}

	writeTestJSON(t, first, map[string]string{"type": "heartbeat"})
	var heartbeat map[string]string
	readTestJSON(t, firstReader, &heartbeat)
	if heartbeat["type"] != "heartbeat_ack" {
		t.Fatalf("original connection was replaced: %#v", heartbeat)
	}
}

func TestAuthenticationTimeoutDoesNotExposeConnection(t *testing.T) {
	srv, _ := newTestServer(t)
	srv.authTimeout = 20 * time.Millisecond
	httpServer := httptest.NewServer(srv.Routes())
	defer httpServer.Close()

	conn, reader := dialTestWebSocket(t, httpServer.URL, url.Values{"deviceId": {"timed-out"}})
	defer conn.Close()
	var failure map[string]string
	readTestJSON(t, reader, &failure)
	if failure["type"] != "auth_failed" || failure["reason"] != "Authentication timeout" {
		t.Fatalf("unexpected timeout response: %#v", failure)
	}
	if count := srv.hub("unknown").deviceCount(); count != 0 {
		t.Fatalf("timed-out connection became visible: %d", count)
	}
}

func TestHeartbeatTimeoutRemovesAuthenticatedConnection(t *testing.T) {
	srv, privateKey := newTestServer(t)
	srv.heartbeatTimeout = 20 * time.Millisecond
	httpServer := httptest.NewServer(srv.Routes())
	defer httpServer.Close()

	conn, reader := dialTestWebSocket(t, httpServer.URL, url.Values{"deviceId": {"heartbeat-device"}})
	defer conn.Close()
	writeTestJSON(t, conn, authMessage{Token: signTestJWT(t, privateKey, "heartbeat-user"), Type: "auth"})
	var success authSuccessMessage
	readTestJSON(t, reader, &success)
	if count := srv.hub("heartbeat-user").deviceCount(); count != 1 {
		t.Fatalf("authenticated connection count = %d, want 1", count)
	}

	deadline := time.Now().Add(time.Second)
	for srv.hub("heartbeat-user").deviceCount() != 0 && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}
	if count := srv.hub("heartbeat-user").deviceCount(); count != 0 {
		t.Fatalf("heartbeat timeout left connection visible: %d", count)
	}
}

func newTestServer(t *testing.T) (*Server, *rsa.PrivateKey) {
	t.Helper()
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	e := make([]byte, 4)
	binary.BigEndian.PutUint32(e, uint32(privateKey.PublicKey.E))
	e = []byte{e[1], e[2], e[3]}
	jwks, err := json.Marshal(map[string]any{"keys": []map[string]string{{
		"alg": "RS256",
		"e":   base64.RawURLEncoding.EncodeToString(e),
		"kty": "RSA",
		"n":   base64.RawURLEncoding.EncodeToString(privateKey.PublicKey.N.Bytes()),
		"use": "sig",
	}}})
	if err != nil {
		t.Fatal(err)
	}
	return NewServer(Config{JWKSPublicKey: string(jwks), ServiceToken: "service-token"}), privateKey
}

func signTestJWT(t *testing.T, key *rsa.PrivateKey, subject string) string {
	t.Helper()
	header := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"RS256","typ":"JWT"}`))
	payloadBytes, err := json.Marshal(map[string]any{
		"exp": time.Now().Add(time.Hour).Unix(),
		"sub": subject,
	})
	if err != nil {
		t.Fatal(err)
	}
	payload := base64.RawURLEncoding.EncodeToString(payloadBytes)
	signed := header + "." + payload
	digest := sha256.Sum256([]byte(signed))
	signature, err := rsa.SignPKCS1v15(rand.Reader, key, crypto.SHA256, digest[:])
	if err != nil {
		t.Fatal(err)
	}
	return signed + "." + base64.RawURLEncoding.EncodeToString(signature)
}

func dialTestWebSocket(t *testing.T, serverURL string, query url.Values) (net.Conn, *bufio.Reader) {
	t.Helper()
	parsed, err := url.Parse(serverURL)
	if err != nil {
		t.Fatal(err)
	}
	conn, err := net.Dial("tcp", parsed.Host)
	if err != nil {
		t.Fatal(err)
	}
	path := "/ws"
	if encoded := query.Encode(); encoded != "" {
		path += "?" + encoded
	}
	key := base64.StdEncoding.EncodeToString([]byte("masterino-test-key"))
	_, err = fmt.Fprintf(
		conn,
		"GET %s HTTP/1.1\r\nHost: %s\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: %s\r\n\r\n",
		path,
		parsed.Host,
		key,
	)
	if err != nil {
		conn.Close()
		t.Fatal(err)
	}
	reader := bufio.NewReader(conn)
	status, err := reader.ReadString('\n')
	if err != nil {
		conn.Close()
		t.Fatal(err)
	}
	if !strings.Contains(status, " 101 ") {
		conn.Close()
		t.Fatalf("websocket upgrade failed: %s", strings.TrimSpace(status))
	}
	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			conn.Close()
			t.Fatal(err)
		}
		if line == "\r\n" {
			break
		}
	}
	return conn, reader
}

func writeTestJSON(t *testing.T, conn net.Conn, value any) {
	t.Helper()
	payload, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	mask := [4]byte{1, 2, 3, 4}
	header := []byte{0x81}
	switch {
	case len(payload) < 126:
		header = append(header, 0x80|byte(len(payload)))
	case len(payload) <= 0xffff:
		header = append(header, 0x80|126, byte(len(payload)>>8), byte(len(payload)))
	default:
		header = append(header, 0x80|127)
		length := make([]byte, 8)
		binary.BigEndian.PutUint64(length, uint64(len(payload)))
		header = append(header, length...)
	}
	header = append(header, mask[:]...)
	masked := make([]byte, len(payload))
	for i := range payload {
		masked[i] = payload[i] ^ mask[i%4]
	}
	if _, err := conn.Write(append(header, masked...)); err != nil {
		t.Fatal(err)
	}
}

func readTestJSON(t *testing.T, reader *bufio.Reader, value any) {
	t.Helper()
	header := make([]byte, 2)
	if _, err := io.ReadFull(reader, header); err != nil {
		t.Fatal(err)
	}
	length := uint64(header[1] & 0x7f)
	if length == 126 {
		buf := make([]byte, 2)
		if _, err := io.ReadFull(reader, buf); err != nil {
			t.Fatal(err)
		}
		length = uint64(binary.BigEndian.Uint16(buf))
	} else if length == 127 {
		buf := make([]byte, 8)
		if _, err := io.ReadFull(reader, buf); err != nil {
			t.Fatal(err)
		}
		length = binary.BigEndian.Uint64(buf)
	}
	payload := make([]byte, length)
	if _, err := io.ReadFull(reader, payload); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(payload, value); err != nil {
		t.Fatalf("decode websocket payload %q: %v", string(payload), err)
	}
}
