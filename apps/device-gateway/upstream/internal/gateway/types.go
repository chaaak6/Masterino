package gateway

import "encoding/json"

type DeviceCapabilities struct {
	ExecutionContextValidation bool           `json:"executionContextValidation,omitempty"`
	LocalSystemAPIVersions      map[string]int `json:"localSystemApiVersions,omitempty"`
}

type DeviceAttachment struct {
	Authenticated   bool               `json:"authenticated"`
	Capabilities    DeviceCapabilities `json:"capabilities,omitempty"`
	Channel         string             `json:"channel,omitempty"`
	ConnectedAt     int64              `json:"connectedAt"`
	ConnectionID    string             `json:"connectionId"`
	DeviceID        string             `json:"deviceId"`
	Hostname        string             `json:"hostname"`
	LastHeartbeat   int64              `json:"lastHeartbeat"`
	Platform        string             `json:"platform"`
	ProtocolVersion int                `json:"protocolVersion,omitempty"`
}

type DeviceConnection struct {
	Capabilities    DeviceCapabilities `json:"capabilities,omitempty"`
	Channel         string             `json:"channel,omitempty"`
	ConnectedAt     int64              `json:"connectedAt"`
	ConnectionID    string             `json:"connectionId"`
	ProtocolVersion int                `json:"protocolVersion,omitempty"`
}

type GatewayDevice struct {
	Channels    []DeviceConnection `json:"channels"`
	ConnectedAt int64              `json:"connectedAt"`
	DeviceID    string             `json:"deviceId"`
	Hostname    string             `json:"hostname"`
	Platform    string             `json:"platform"`
}

type authMessage struct {
	Capabilities    DeviceCapabilities `json:"capabilities,omitempty"`
	ProtocolVersion int                `json:"protocolVersion,omitempty"`
	ServerURL       string             `json:"serverUrl,omitempty"`
	Token           string             `json:"token"`
	TokenType       string             `json:"tokenType,omitempty"`
	Type            string             `json:"type"`
}

type authSuccessMessage struct {
	Type   string `json:"type"`
	UserID string `json:"userId"`
}

type rpcEnvelope struct {
	OperationID string          `json:"operationId,omitempty"`
	Reason      string          `json:"reason,omitempty"`
	RequestID   string          `json:"requestId,omitempty"`
	Result      json.RawMessage `json:"result,omitempty"`
	Status      string          `json:"status,omitempty"`
	Type        string          `json:"type"`
}

type deviceHTTPBody struct {
	AgentType        string            `json:"agentType,omitempty"`
	API              json.RawMessage   `json:"api,omitempty"`
	CWD              string            `json:"cwd,omitempty"`
	DeviceID         string            `json:"deviceId,omitempty"`
	Env              map[string]string `json:"env,omitempty"`
	ExecutionContext json.RawMessage   `json:"executionContext,omitempty"`
	ImageList        json.RawMessage   `json:"imageList,omitempty"`
	JWT              string            `json:"jwt,omitempty"`
	Method           string            `json:"method,omitempty"`
	ModelRef         json.RawMessage   `json:"modelRef,omitempty"`
	OperationID      string            `json:"operationId,omitempty"`
	Params           json.RawMessage   `json:"params,omitempty"`
	Prompt           string            `json:"prompt,omitempty"`
	ResumeSessionID  string            `json:"resumeSessionId,omitempty"`
	SkillPolicy      string            `json:"skillPolicy,omitempty"`
	Skills           json.RawMessage   `json:"skills,omitempty"`
	SystemContext    string            `json:"systemContext,omitempty"`
	Timeout          int               `json:"timeout,omitempty"`
	ToolCall         json.RawMessage   `json:"toolCall,omitempty"`
	ToolCallID       string            `json:"toolCallId,omitempty"`
	TopicID          string            `json:"topicId,omitempty"`
	UserID           string            `json:"userId"`
}
