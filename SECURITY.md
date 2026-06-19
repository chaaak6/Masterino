# Security Policy

## Supported Versions

MasterLion currently supports security fixes for the **latest 0.0.x release**.

| Version      | Supported |
| ------------ | --------- |
| 0.0.x latest | ✅        |
| older builds | ❌        |

If you are running an older internal build, upgrade to the latest MasterLion `0.0.x` release before reporting security issues.

## Reporting a Vulnerability

Please report security vulnerabilities through the GitHub Security Advisory ["Report a Vulnerability"](https://github.com/chaaak6/MasterLion/security/advisories/new) tab or through the internal MasterLion owner channel.

**Please do not report security vulnerabilities through public GitHub issues.**

### Response Timeline

- **Acknowledgement**: We aim to respond to all reports within **7 days**.
- **Fix**: Confirmed vulnerabilities will be addressed within **30 days**.
- **Urgent issues**: If you believe the vulnerability is critical and actively exploitable, contact the MasterLion project owner directly.

### What to Include

A good vulnerability report should include:

- A clear description of the issue and its potential impact
- The affected version (must be the latest supported MasterLion `0.0.x` release)
- Step-by-step reproduction instructions or a working PoC
- Any relevant logs, screenshots, or code references

## Scope

### In Scope

- Security issues affecting the **latest supported MasterLion 0.0.x release**
- Vulnerabilities in the **server-side deployment** (internal Docker deployment or self-hosted server mode)
- Issues that can be exploited **without requiring admin/owner access** to the deployment
- Server-side Aihub token, Aihub DB bridge, upload proxy, file download, auth, or permission boundary issues

### Out of Scope (Not a Vulnerability)

The following are considered **by design** or **out of scope** and will not be accepted as vulnerability reports:

#### 1. End-of-Life Builds

Any issue that only affects old local builds or experiments that are no longer deployed.

#### 2. File Proxy Public Access (`/f/:id`)

The file proxy endpoint `/f/:id` uses randomly generated, non-enumerable IDs as [capability URLs](https://www.w3.org/TR/capability-urls/). This is a deliberate design choice, similar to how S3 presigned URLs or Google Docs sharing links work. Knowing the URL grants access — this is by design, not an authorization bypass.

#### 3. Aihub Read-Only Bridge Access by Trusted Services

The `aihub-db-bridge` service is intentionally allowed to read selected Aihub account, token, model, quota, and usage data for server-side integration. Reports that only state the bridge can read configured Aihub data are not vulnerabilities unless they show unauthorized access, token disclosure to browser clients, privilege escalation, or data exposure outside the intended server-side boundary.

#### 4. User Enumeration on Login Flows

Endpoints such as `check-user` that indicate whether an account exists are part of the standard login UX. This is a common and intentional pattern used by most modern authentication flows.

#### 5. Self-Hosted Client-Side API Key Storage

In self-hosted client-side mode, users configure their own API keys which are stored in the browser's local storage. This is the expected behavior for client-side deployments where the user is both the operator and the consumer.

#### 6. Issues Requiring Admin or Owner Privileges

Actions that require administrative access to the deployment (e.g., environment variable configuration, server-side settings) are not considered security vulnerabilities, as the admin is already a trusted party.

#### 7. Theoretical Attacks Without Practical Impact

Reports based on theoretical attack scenarios without a working proof of concept against a realistic deployment, or issues that require unlikely preconditions (e.g., physical access to the server, pre-existing compromise of the host system).

## Disclosure Policy

- We follow [coordinated vulnerability disclosure](https://en.wikipedia.org/wiki/Coordinated_vulnerability_disclosure).
- We will credit reporters in the security advisory unless they prefer to remain anonymous.
- Please allow us reasonable time to address the issue before any public disclosure.

## Contact

- **Primary**: [GitHub Security Advisories](https://github.com/chaaak6/MasterLion/security/advisories/new)
- **Urgent**: Contact the MasterLion project owner directly.
